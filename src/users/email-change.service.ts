import { HttpException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { MailService } from '../common/mail-service/mail.service';
import { EnvService } from '../common/env-service/env.service';
import { ErrorsService } from '../common/errors-service/errors.service';
import { RedisService } from '../common/redis-service/redis.service';
import { EmailChangePayload, TokensService } from '../auth/tokens.service';
import { AuthService } from '../auth/auth.service';
import { EmailChangeRequestDto } from './dto/email-change-request.dto';
import { EmailChangeConfirmDto } from './dto/email-change-confirm.dto';
import { ContactEmailChangeRequestDto } from './dto/contact-email-change-request.dto';
import {
  ID,
  EMAIL,
  CONTACT_EMAIL,
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

    return this.sendConfirmation(
      userId,
      { user_id: userId, kind: 'login', new_email: newEmail },
      newEmail,
    );
  }

  async requestContact(userId: number, dto: ContactEmailChangeRequestDto) {
    await this.assertNotLocked(userId);
    if (dto.new_email === undefined) {
      this.errorsService.badRequest('Укажите контактную почту.');
    }
    const newEmail = dto.new_email?.trim().toLowerCase() ?? null;
    if (newEmail !== null) this.mailService.validateNotServiceEmail(newEmail);

    const user = (await this.usersRepository
      .findOneOrFail({
        where: { id: userId },
        select: [ID, CONTACT_EMAIL, IS_BLOCKED],
      })
      .catch((err) => this.errorsService.userNotFound(err))) as User;
    if (user.is_blocked) {
      this.errorsService.badRequest(ErrMsg.CURRENT_USER_BLOCKED);
    }
    const oldEmail = user.contact_email?.trim().toLowerCase() ?? null;
    if (newEmail === oldEmail) {
      this.errorsService.badRequest('Контактная почта уже указана.');
    }
    const recipient = newEmail ?? oldEmail;
    if (!recipient)
      this.errorsService.badRequest('Контактная почта не указана.');
    return this.sendConfirmation(
      userId,
      {
        user_id: userId,
        kind: 'contact',
        new_email: newEmail,
        old_email: oldEmail,
      },
      recipient,
    );
  }

  private async sendConfirmation(
    userId: number,
    payload: EmailChangePayload,
    recipient: string,
  ) {
    const attemptSubject = userId.toString();
    const retryAfter = await this.tokensService.reserveVerificationCodeRequest(
      TokenType.EMAIL_CHANGE,
      attemptSubject,
    );
    let issuedCode: string | undefined;
    try {
      const activeKey = this.getActiveCodeKey(userId);
      const previousCode = await this.redisService.get(activeKey);
      issuedCode = await this.tokensService.getEmailChangeCode(payload);
      await this.redisService.set(activeKey, issuedCode, {
        EX: this.emailChangeTokenTtl,
      });
      if (previousCode && previousCode !== issuedCode) {
        await this.redisService.del(
          `${EMAIL_CHANGE_CODE_PREFIX}${previousCode}`,
        );
      }

      const action =
        payload.kind === 'contact'
          ? payload.new_email === null
            ? 'удаление контактной почты'
            : 'изменение контактной почты'
          : 'изменение почты для входа';
      const text = `Для подтверждения действия «${action}» введите код ${issuedCode}. Код действует ${this.emailChangeTokenExpiresIn} мин. Если это были не вы, проигнорируйте письмо.`;
      const html = `<p>Для подтверждения действия «${action}» введите код:</p><p style="font-weight: bold; font-size: 30px;">${issuedCode}</p><p>Код действует ${this.emailChangeTokenExpiresIn} мин. Если это были не вы, проигнорируйте письмо.</p>`;
      await this.mailService.send(
        recipient,
        'Подтверждение изменения почты',
        text,
        html,
      );
      await this.tokensService.clearVerificationFailures(
        TokenType.EMAIL_CHANGE,
        attemptSubject,
      );
      return {
        message: 'Код подтверждения отправлен.',
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
    return this.confirmCode(currentUserId, dto, 'login', currentSessionId);
  }

  async confirmContact(currentUserId: number, dto: EmailChangeConfirmDto) {
    return this.confirmCode(currentUserId, dto, 'contact');
  }

  private async confirmCode(
    currentUserId: number,
    dto: EmailChangeConfirmDto,
    kind: EmailChangePayload['kind'],
    currentSessionId?: string,
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
      data.kind !== kind ||
      (typeof data.new_email !== 'string' &&
        !(kind === 'contact' && data.new_email === null)) ||
      (data.kind === 'contact' &&
        typeof data.old_email !== 'string' &&
        data.old_email !== null) ||
      data.user_id !== currentUserId
    ) {
      return this.rejectInvalidCode(currentUserId);
    }

    const newEmail = data.new_email?.trim().toLowerCase() ?? null;
    if (newEmail !== null) this.mailService.validateNotServiceEmail(newEmail);
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const user = await qr.manager.findOneOrFail(User, {
        where: { id: currentUserId },
        select: [ID, EMAIL, CONTACT_EMAIL, IS_BLOCKED],
        lock: { mode: 'pessimistic_write' },
      });
      if (user.is_blocked) {
        this.errorsService.badRequest(ErrMsg.CURRENT_USER_BLOCKED);
      }
      if (kind === 'login' && user.email?.trim().toLowerCase() === newEmail) {
        this.errorsService.forbidden(ErrMsg.NEW_EMAIL_MATCH_USER_EMAIL);
      }
      if (kind === 'contact') {
        if (
          data.kind !== 'contact' ||
          (user.contact_email?.trim().toLowerCase() ?? null) !== data.old_email
        ) {
          this.errorsService.conflict(
            'Контактная почта изменилась. Запросите новый код.',
          );
        }
        if ((user.contact_email?.trim().toLowerCase() ?? null) === newEmail) {
          this.errorsService.badRequest('Контактная почта уже указана.');
        }
      }
      if (kind === 'login' && newEmail !== null) {
        const isEmailTaken = await qr.manager.getRepository(User).exists({
          where: { email: newEmail },
        });
        if (isEmailTaken)
          this.errorsService.conflict(ErrMsg.CONFLICT_USER_EXISTS);
      }

      const consumed = await this.tokensService.consumeEmailChangeCode(
        currentUserId,
        dto.code,
      );
      if (
        !consumed ||
        consumed.user_id !== currentUserId ||
        consumed.kind !== kind ||
        (consumed.new_email?.trim().toLowerCase() ?? null) !== newEmail ||
        (kind === 'contact' &&
          !(
            data.kind === 'contact' &&
            consumed.kind === 'contact' &&
            consumed.old_email === data.old_email
          ))
      ) {
        await this.rejectInvalidCode(currentUserId);
      }

      if (kind === 'contact') user.contact_email = newEmail;
      else user.email = newEmail;
      await qr.manager.save(User, user);
      if (kind === 'login' && currentSessionId) {
        await this.authService.revokeOtherSessions(
          user.id,
          currentSessionId,
          'email_changed',
          qr.manager,
        );
      }
      await qr.commitTransaction();

      await this.tokensService
        .clearVerificationFailures(TokenType.EMAIL_CHANGE, attemptSubject)
        .catch(() => undefined);
      await this.redisService
        .del(this.getLockoutKey(currentUserId))
        .catch(() => undefined);
      return {
        message:
          kind === 'contact'
            ? 'Контактная почта изменена.'
            : 'Почта для входа изменена.',
      };
    } catch (err) {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      if (err instanceof HttpException) {
        throw err;
      }
      this.errorsService.userNotFound(err);
      this.errorsService.userConflict(err, [
        kind === 'contact' ? CONTACT_EMAIL : EMAIL,
      ]);
      this.errorsService.default(err);
    } finally {
      await qr.release();
    }
  }
}
