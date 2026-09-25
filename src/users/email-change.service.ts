import { HttpException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { MailService } from '../common/mail-service/mail.service';
import { EnvService } from '../common/env-service/env.service';
import { ErrorsService } from '../common/errors-service/errors.service';
import { RedisService } from '../common/redis-service/redis.service';
import { TokensService } from '../auth/tokens.service';
import { AuthService } from '../auth/auth.service';
import { EmailChangeRequestDto } from './dto/email-change-request.dto';
import { EmailChangeConfirmDto } from './dto/email-change-confirm.dto';
import {
  ID,
  EMAIL,
  IS_BLOCKED,
} from '../common/constants/user-select-fields.constants';
import { ErrMsg } from '../common/errors-service/error-messages.type';
import { TokenType } from '../common/types/token-type.type';

const EMAIL_CHANGE_LOCKOUT_PREFIX = 'email-change:lockout:';
const EMAIL_CHANGE_ACTIVE_PREFIX = 'email-change:active:';
const EMAIL_CHANGE_CODE_PREFIX = 'email-change:';
const EMAIL_CHANGE_LOCKOUT_MESSAGE =
  'Email change is temporarily locked after too many incorrect confirmation codes.';

@Injectable()
export class EmailChangeService {
  private readonly emailChangeTokenExpiresIn: number;
  private readonly emailChangeTokenTtl: number;
  private readonly emailChangeVerificationLockout: number;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly mailService: MailService,
    private readonly envService: EnvService,
    private readonly errorsService: ErrorsService,
    private readonly redisService: RedisService,
    private readonly tokensService: TokensService,
    private readonly authService: AuthService,
  ) {
    this.emailChangeTokenTtl = this.envService.get(
      'EMAIL_CHANGE_TOKEN_EXPIRES_IN',
      'number',
    );
    this.emailChangeTokenExpiresIn = this.emailChangeTokenTtl / 60;
    this.emailChangeVerificationLockout = this.envService.get(
      'EMAIL_CHANGE_VERIFICATION_LOCKOUT',
      'number',
    );
  }

  private getLockoutKey(userId: number) {
    return `${EMAIL_CHANGE_LOCKOUT_PREFIX}${userId}`;
  }

  private getActiveCodeKey(userId: number) {
    return `${EMAIL_CHANGE_ACTIVE_PREFIX}${userId}`;
  }

  private async invalidateActiveCode(userId: number) {
    const activeKey = this.getActiveCodeKey(userId);
    const activeCode = await this.redisService.get(activeKey);
    if (activeCode) {
      await this.redisService.del(`${EMAIL_CHANGE_CODE_PREFIX}${activeCode}`);
    }
    await this.redisService.del(activeKey);
  }

  private async getLockoutSeconds(userId: number) {
    const ttl = await this.redisService.ttl(this.getLockoutKey(userId));
    return typeof ttl === 'number' && ttl > 0 ? ttl : 0;
  }

  private async assertNotLocked(userId: number) {
    const retryAfter = await this.getLockoutSeconds(userId);
    if (retryAfter > 0) {
      this.errorsService.tooManyRequests(
        EMAIL_CHANGE_LOCKOUT_MESSAGE,
        retryAfter,
      );
    }
  }

  private async rejectInvalidCode(userId: number): Promise<never> {
    const attemptSubject = userId.toString();
    await this.tokensService.registerVerificationFailure(
      TokenType.EMAIL_CHANGE,
      attemptSubject,
    );
    const attemptsRemaining =
      await this.tokensService.getVerificationAttemptsRemaining(
        TokenType.EMAIL_CHANGE,
        attemptSubject,
      );

    let retryAfter: number | undefined;
    if (attemptsRemaining <= 0) {
      retryAfter = this.emailChangeVerificationLockout;
      await this.invalidateActiveCode(userId);
      await this.redisService.set(this.getLockoutKey(userId), '1', {
        EX: retryAfter,
      });
    }

    return this.errorsService.invalidTokenWithAttempts(
      TokenType.EMAIL_CHANGE,
      attemptsRemaining,
      retryAfter,
    );
  }

  async getStatus(userId: number) {
    const retryAfter = await this.getLockoutSeconds(userId);
    const maxAttempts = this.tokensService.getVerificationAttemptLimit(
      TokenType.EMAIL_CHANGE,
    );
    let attemptsRemaining =
      await this.tokensService.getVerificationAttemptsRemaining(
        TokenType.EMAIL_CHANGE,
        userId.toString(),
      );

    if (retryAfter === 0 && attemptsRemaining === 0) {
      await this.tokensService.clearVerificationFailures(
        TokenType.EMAIL_CHANGE,
        userId.toString(),
      );
      attemptsRemaining = maxAttempts;
    }

    return {
      locked: retryAfter > 0,
      retry_after: retryAfter,
      max_attempts: maxAttempts,
      attempts_remaining: retryAfter > 0 ? 0 : attemptsRemaining,
    };
  }

  async request(userId: number, dto: EmailChangeRequestDto) {
    await this.assertNotLocked(userId);
    await this.authService.verifyUserPassword(userId, dto.current_password);

    const user = await this.usersRepository
      .findOneOrFail({ where: { id: userId }, select: [ID, EMAIL, IS_BLOCKED] })
      .catch((err) => this.errorsService.userNotFound(err));
    const currentUser = user as User;
    const currentEmail = currentUser.email;
    const newEmail = dto.new_email.trim().toLowerCase();
    this.mailService.validateNotServiceEmail(newEmail);
    if (currentEmail === newEmail) {
      this.errorsService.forbidden(ErrMsg.NEW_EMAIL_MATCH_USER_EMAIL);
    }
    if (currentUser.is_blocked) {
      this.errorsService.badRequest(ErrMsg.CURRENT_USER_BLOCKED);
    }
    const existingUser = await this.usersRepository.findOne({
      where: { email: newEmail },
      select: [ID],
    });
    if (existingUser) {
      this.errorsService.conflict(ErrMsg.CONFLICT_USER_EXISTS);
    }

    const attemptSubject = userId.toString();
    const retryAfter = await this.tokensService.reserveVerificationCodeRequest(
      TokenType.EMAIL_CHANGE,
      attemptSubject,
    );
    let issuedCode: string | undefined;
    try {
      const activeKey = this.getActiveCodeKey(userId);
      const previousCode = await this.redisService.get(activeKey);
      const redisValue = { user_id: userId, new_email: newEmail };
      issuedCode = await this.tokensService.getEmailChangeCode(redisValue);
      await this.redisService.set(activeKey, issuedCode, {
        EX: this.emailChangeTokenTtl,
      });
      if (previousCode && previousCode !== issuedCode) {
        await this.redisService.del(
          `${EMAIL_CHANGE_CODE_PREFIX}${previousCode}`,
        );
      }

      const text =
        `You requested to change your account email to ${newEmail}.\n` +
        `To confirm, use the code below (within ${this.emailChangeTokenExpiresIn} min): ${issuedCode}\n\nIf it wasn't you, ignore this message.`;
      const html = `
        <p>You requested to change your account email to ${newEmail}.</p>
        <p>To confirm, use the code below (within ${this.emailChangeTokenExpiresIn} min): 
        <p style="font-weight: bold; font-size: 30px;">${issuedCode}</p>
        <p style="font-weight: bold; font-size: 17px;">If you didn’t request this, you can safely ignore this email.</p>`;
      await this.mailService.send(
        newEmail,
        'Confirm your new email',
        text,
        html,
      );
      await this.tokensService.clearVerificationFailures(
        TokenType.EMAIL_CHANGE,
        attemptSubject,
      );
      return {
        message: 'Confirmation code sent to your new email.',
        retry_after: retryAfter,
        max_attempts: this.tokensService.getVerificationAttemptLimit(
          TokenType.EMAIL_CHANGE,
        ),
      };
    } catch (err: unknown) {
      if (issuedCode) {
        await this.invalidateActiveCode(userId).catch(() => undefined);
      }
      await this.tokensService
        .releaseVerificationCodeRequest(TokenType.EMAIL_CHANGE, attemptSubject)
        .catch(() => undefined);
      if (err instanceof HttpException) throw err;
      this.errorsService.default(err);
    }
  }

  async confirm(
    currentUserId: number,
    dto: EmailChangeConfirmDto,
    currentSessionId: string,
  ) {
    await this.assertNotLocked(currentUserId);

    const attemptSubject = currentUserId.toString();
    await this.tokensService.assertVerificationAttemptsAvailable(
      TokenType.EMAIL_CHANGE,
      attemptSubject,
    );

    const data = await this.tokensService.getDataByEmailChangeCode(dto.code);
    if (
      !data ||
      typeof data.user_id !== 'number' ||
      typeof data.new_email !== 'string' ||
      data.user_id !== currentUserId
    ) {
      return this.rejectInvalidCode(currentUserId);
    }

    const newEmail = data.new_email.trim().toLowerCase();
    this.mailService.validateNotServiceEmail(newEmail);
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const user = await qr.manager.findOneOrFail(User, {
        where: { id: currentUserId },
        select: [ID, EMAIL, IS_BLOCKED],
        lock: { mode: 'pessimistic_write' },
      });
      if (user.is_blocked) {
        this.errorsService.badRequest(ErrMsg.CURRENT_USER_BLOCKED);
      }
      if (user.email?.trim().toLowerCase() === newEmail) {
        this.errorsService.forbidden(ErrMsg.NEW_EMAIL_MATCH_USER_EMAIL);
      }
      const isEmailTaken = await qr.manager.getRepository(User).exists({
        where: { email: newEmail },
      });
      if (isEmailTaken) {
        this.errorsService.conflict(ErrMsg.CONFLICT_USER_EXISTS);
      }

      const consumed = await this.tokensService.consumeEmailChangeCode(
        currentUserId,
        dto.code,
      );
      if (
        !consumed ||
        consumed.user_id !== currentUserId ||
        consumed.new_email.trim().toLowerCase() !== newEmail
      ) {
        await this.rejectInvalidCode(currentUserId);
      }

      user.email = newEmail;
      await qr.manager.save(User, user);
      await this.authService.revokeOtherSessions(
        user.id,
        currentSessionId,
        'email_changed',
        qr.manager,
      );
      await qr.commitTransaction();

      await this.tokensService
        .clearVerificationFailures(TokenType.EMAIL_CHANGE, attemptSubject)
        .catch(() => undefined);
      await this.redisService
        .del(this.getLockoutKey(currentUserId))
        .catch(() => undefined);
      return { message: 'Email changed successfully.' };
    } catch (err) {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      if (err instanceof HttpException) {
        throw err;
      }
      this.errorsService.userNotFound(err);
      this.errorsService.userConflict(err, [EMAIL]);
      this.errorsService.default(err);
    } finally {
      await qr.release();
    }
  }
}
