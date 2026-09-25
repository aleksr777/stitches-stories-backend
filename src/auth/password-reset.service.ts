import { HttpException, Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { TokensService } from './tokens.service';
import { HashService } from '../common/hash-service/hash.service';
import { ErrorsService } from '../common/errors-service/errors.service';
import { MailService } from '../common/mail-service/mail.service';
import { EnvService } from '../common/env-service/env.service';
import { RedisService } from '../common/redis-service/redis.service';
import { User } from '../users/entities/user.entity';
import { EMAIL, ID } from '../common/constants/user-select-fields.constants';
import { TokenType } from '../common/types/token-type.type';

const PASSWORD_RESET_LOCKOUT_PREFIX = 'password-reset:lockout:';
const RESET_ACTIVE_PREFIX = 'reset:active:';
const RESET_CODE_PREFIX = 'reset:';
const PASSWORD_RESET_LOCKOUT_MESSAGE =
  'Password reset is temporarily locked after too many incorrect confirmation codes.';

@Injectable()
export class PasswordResetService {
  config: any;
  private readonly resetExpiresIn: number;
  private readonly passwordResetVerificationLockout: number;

  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private readonly authService: AuthService,
    private readonly tokensService: TokensService,
    private readonly hashService: HashService,
    private readonly errorsService: ErrorsService,
    private readonly mailService: MailService,
    private readonly envService: EnvService,
    private readonly redisService: RedisService,
    private readonly dataSource: DataSource,
  ) {
    this.resetExpiresIn =
      this.envService.get('RESET_TOKEN_EXPIRES_IN', 'number') / 60;
    this.passwordResetVerificationLockout = this.envService.get(
      'PASSWORD_RESET_VERIFICATION_LOCKOUT',
      'number',
    );
  }

  private getLockoutKey(email: string) {
    return `${PASSWORD_RESET_LOCKOUT_PREFIX}${email.trim().toLowerCase()}`;
  }

  private async invalidateActiveCode(email: string) {
    const user = await this.usersRepository.findOne({
      where: { email: email.trim().toLowerCase() },
      select: [ID],
    });
    if (!user) return;

    const activeKey = `${RESET_ACTIVE_PREFIX}${user.id}`;
    const activeCode = await this.redisService.get(activeKey);
    if (activeCode) {
      await this.redisService.del(`${RESET_CODE_PREFIX}${activeCode}`);
    }
    await this.redisService.del(activeKey);
  }

  private async getLockoutSeconds(email: string) {
    const ttl = await this.redisService.ttl(this.getLockoutKey(email));
    return typeof ttl === 'number' && ttl > 0 ? ttl : 0;
  }

  private async assertNotLocked(email: string) {
    const retryAfter = await this.getLockoutSeconds(email);
    if (retryAfter > 0) {
      this.errorsService.tooManyRequests(
        PASSWORD_RESET_LOCKOUT_MESSAGE,
        retryAfter,
      );
    }
  }

  private async rejectInvalidCode(email: string): Promise<never> {
    await this.tokensService.registerVerificationFailure(
      TokenType.PASSWORD_RESET,
      email,
    );
    const attemptsRemaining =
      await this.tokensService.getVerificationAttemptsRemaining(
        TokenType.PASSWORD_RESET,
        email,
      );

    let retryAfter: number | undefined;
    if (attemptsRemaining <= 0) {
      retryAfter = this.passwordResetVerificationLockout;
      await this.invalidateActiveCode(email);
      await this.redisService.set(this.getLockoutKey(email), '1', {
        EX: retryAfter,
      });
    }

    return this.errorsService.invalidTokenWithAttempts(
      TokenType.PASSWORD_RESET,
      attemptsRemaining,
      retryAfter,
    );
  }

  private getRequestResponse(retryAfter: number) {
    return {
      message: 'If the email exists, we’ve sent you a password reset code.',
      retry_after: retryAfter,
      max_attempts: this.tokensService.getVerificationAttemptLimit(
        TokenType.PASSWORD_RESET,
      ),
    };
  }

  async request(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    this.mailService.validateNotServiceEmail(normalizedEmail);
    await this.assertNotLocked(normalizedEmail);
    const retryAfter = await this.tokensService.reserveVerificationCodeRequest(
      TokenType.PASSWORD_RESET,
      normalizedEmail,
    );
    let issuedCode: string | undefined;
    let userId: number | undefined;

    try {
      const user = await this.usersRepository.findOne({
        where: { email: normalizedEmail },
        select: [ID],
      });
      if (user) {
        userId = user.id;
        issuedCode = await this.tokensService.getResetCode(user.id);
        const text = `Hi, this is an automated message, please do not reply! You can reset your password by using the code below (within ${this.resetExpiresIn} min): ${issuedCode}`;
        const html = `
          <p style="font-weight: bold; font-size: 17px;">Hi, this is an automated message, please do not reply!</p>
          <p style="font-weight: bold; font-size: 17px;">You can reset your password by using the code below (within ${this.resetExpiresIn} min):</p>
          <p style="font-weight: bold; font-size: 30px;">${issuedCode}</p>
          <p style="font-weight: bold; font-size: 17px;">If you didn’t request this, you can safely ignore this email.</p>`;
        await this.mailService.send(
          normalizedEmail,
          'Password recovery',
          text,
          html,
        );
        await this.tokensService.clearVerificationFailures(
          TokenType.PASSWORD_RESET,
          normalizedEmail,
        );
      }
      return this.getRequestResponse(retryAfter);
    } catch (err: unknown) {
      if (issuedCode) {
        await this.tokensService
          .deletePassResetCode(issuedCode, userId)
          .catch(() => undefined);
      }
      await this.tokensService
        .releaseVerificationCodeRequest(
          TokenType.PASSWORD_RESET,
          normalizedEmail,
        )
        .catch(() => undefined);
      if (err instanceof HttpException) throw err;
      this.errorsService.default(err);
    }
  }

  async confirm(code: string, newPassword: string, email: string) {
    const attemptSubject = email.trim().toLowerCase();
    await this.assertNotLocked(attemptSubject);
    await this.tokensService.assertVerificationAttemptsAvailable(
      TokenType.PASSWORD_RESET,
      attemptSubject,
    );

    const userId = await this.tokensService.getIdByResetCode(code);
    if (userId === null) {
      return this.rejectInvalidCode(attemptSubject);
    }

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const user = await qr.manager.findOne(User, {
        where: { id: userId },
        select: [ID, EMAIL],
        lock: { mode: 'pessimistic_write' },
      });
      if (!user || user.email?.trim().toLowerCase() !== attemptSubject) {
        await this.rejectInvalidCode(attemptSubject);
      }

      const consumedUserId = await this.tokensService.consumeResetCode(
        userId,
        code,
      );
      if (consumedUserId !== userId) {
        await this.rejectInvalidCode(attemptSubject);
      }

      const hashedPassword = await this.hashService.hash(newPassword);
      const result = await qr.manager.update(
        User,
        { id: userId },
        { password: hashedPassword },
      );
      if (result.affected === 0) {
        this.errorsService.userNotFound();
      }
      await this.authService.revokeAllSessions(
        userId,
        'password_reset',
        qr.manager,
      );
      await qr.commitTransaction();

      await this.tokensService.clearVerificationFailures(
        TokenType.PASSWORD_RESET,
        attemptSubject,
      );
      await this.redisService
        .del(this.getLockoutKey(attemptSubject))
        .catch(() => undefined);

      return {
        message: 'Password reset successfully.',
      };
    } catch (err: unknown) {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      this.errorsService.resetPassword(err);
    } finally {
      await qr.release();
    }
  }
}
