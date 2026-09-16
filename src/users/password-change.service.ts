import { HttpException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { AuthService } from '../auth/auth.service';
import { HashService } from '../common/hash-service/hash.service';
import { ErrorsService } from '../common/errors-service/errors.service';
import { MailService } from '../common/mail-service/mail.service';
import { EnvService } from '../common/env-service/env.service';
import { TokensService } from '../auth/tokens.service';
import {
  EMAIL,
  ID,
  PASSWORD,
} from '../common/constants/user-select-fields.constants';
import { ErrMsg } from '../common/errors-service/error-messages.type';
import { TokenType } from '../common/types/token-type.type';

type PasswordUpdateOptions = {
  revokeReason: string;
  tokenType: TokenType;
  currentSessionId: string;
  consumeCode: () => Promise<number | null>;
};

@Injectable()
export class PasswordChangeService {
  private readonly resetExpiresIn: number;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly authService: AuthService,
    private readonly hashService: HashService,
    private readonly errorsService: ErrorsService,
    private readonly tokensService: TokensService,
    private readonly mailService: MailService,
    private readonly envService: EnvService,
  ) {
    this.resetExpiresIn =
      this.envService.get('RESET_TOKEN_EXPIRES_IN', 'number') / 60;
  }

  async request(userId: number, oldPassword: string) {
    const user = await this.usersRepository
      .findOneOrFail({
        where: { id: userId },
        select: [ID, PASSWORD],
      })
      .catch((err) => {
        this.errorsService.userNotFound(err);
        this.errorsService.default(err);
      });
    const ok = await this.hashService.compare(oldPassword, user.password);
    if (!ok) {
      return this.errorsService.badRequest(ErrMsg.OLD_PASSWORD_IS_INCORRECT);
    }
    const code = await this.tokensService.getPasswordChangeCode(userId);
    return { code };
  }

  async requestReset(userId: number) {
    const attemptSubject = userId.toString();
    const retryAfter = await this.tokensService.reserveVerificationCodeRequest(
      TokenType.CURRENT_USER_PASSWORD_RESET,
      attemptSubject,
    );
    let issuedCode: string | undefined;

    try {
      const user = await this.usersRepository.findOneOrFail({
        where: { id: userId },
        select: [ID, EMAIL],
      });
      issuedCode = await this.tokensService.getCurrentUserPasswordResetCode(
        user.id,
      );
      const text =
        `You requested to change your password.\n` +
        `Use this code within ${this.resetExpiresIn} min: ${issuedCode}\n\n` +
        `If it wasn't you, ignore this message.`;
      const html = `
        <p>You requested to change your password.</p>
        <p>Use this code within ${this.resetExpiresIn} min:</p>
        <p style="font-weight: bold; font-size: 30px;">${issuedCode}</p>
        <p style="font-weight: bold; font-size: 17px;">If you didn’t request this, you can safely ignore this email.</p>`;
      await this.mailService.send(
        user.email,
        'Confirm password change',
        text,
        html,
      );
      await this.tokensService.clearVerificationFailures(
        TokenType.CURRENT_USER_PASSWORD_RESET,
        attemptSubject,
      );
      return {
        message: 'Confirmation code sent to your email.',
        retry_after: retryAfter,
        max_attempts: this.tokensService.getVerificationAttemptLimit(
          TokenType.CURRENT_USER_PASSWORD_RESET,
        ),
      };
    } catch (err: unknown) {
      if (issuedCode) {
        await this.tokensService
          .deleteCurrentUserPasswordResetCode(issuedCode, userId)
          .catch(() => undefined);
      }
      await this.tokensService
        .releaseVerificationCodeRequest(
          TokenType.CURRENT_USER_PASSWORD_RESET,
          attemptSubject,
        )
        .catch(() => undefined);
      if (err instanceof HttpException) throw err;
      this.errorsService.userNotFound(err);
      this.errorsService.default(err);
    }
  }

  async confirmReset(
    userId: number,
    code: string,
    newPassword: string,
    currentSessionId: string,
  ) {
    const attemptSubject = userId.toString();
    await this.tokensService.assertVerificationAttemptsAvailable(
      TokenType.CURRENT_USER_PASSWORD_RESET,
      attemptSubject,
    );
    const storedUserId =
      await this.tokensService.getIdByCurrentUserPasswordResetCode(code);
    if (!storedUserId || storedUserId !== userId) {
      await this.tokensService.registerVerificationFailure(
        TokenType.CURRENT_USER_PASSWORD_RESET,
        attemptSubject,
      );
      return this.errorsService.invalidToken(
        null,
        TokenType.CURRENT_USER_PASSWORD_RESET,
      );
    }

    const result = await this.updatePassword(userId, newPassword, {
      revokeReason: 'password_reset',
      tokenType: TokenType.CURRENT_USER_PASSWORD_RESET,
      currentSessionId,
      consumeCode: () =>
        this.tokensService.consumeCurrentUserPasswordResetCode(userId, code),
    });
    await this.tokensService
      .clearVerificationFailures(
        TokenType.CURRENT_USER_PASSWORD_RESET,
        attemptSubject,
      )
      .catch(() => undefined);
    return result;
  }

  async confirm(
    userId: number,
    code: string,
    newPassword: string,
    currentSessionId: string,
  ) {
    const attemptSubject = userId.toString();
    await this.tokensService.assertVerificationAttemptsAvailable(
      TokenType.PASSWORD_CHANGE,
      attemptSubject,
    );
    const storedUserId =
      await this.tokensService.getIdByPasswordChangeCode(code);
    if (!storedUserId || storedUserId !== userId) {
      await this.tokensService.registerVerificationFailure(
        TokenType.PASSWORD_CHANGE,
        attemptSubject,
      );
      return this.errorsService.invalidToken(null, TokenType.PASSWORD_CHANGE);
    }

    const result = await this.updatePassword(userId, newPassword, {
      revokeReason: 'password_changed',
      tokenType: TokenType.PASSWORD_CHANGE,
      currentSessionId,
      consumeCode: () =>
        this.tokensService.consumePasswordChangeCode(userId, code),
    });
    await this.tokensService
      .clearVerificationFailures(TokenType.PASSWORD_CHANGE, attemptSubject)
      .catch(() => undefined);
    return result;
  }

  private async updatePassword(
    userId: number,
    newPassword: string,
    options: PasswordUpdateOptions,
  ) {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const user = await qr.manager.findOneOrFail(User, {
        where: { id: userId },
        select: [ID, PASSWORD],
        lock: { mode: 'pessimistic_write' },
      });
      const same = await this.hashService.compare(newPassword, user.password);
      if (same) this.errorsService.badRequest(ErrMsg.NEW_PASSWORD_MUST_DIFFER);

      const consumedUserId = await options.consumeCode();
      if (consumedUserId !== userId) {
        this.errorsService.invalidToken(null, options.tokenType);
      }

      const hash = await this.hashService.hash(newPassword);
      await qr.manager.update(User, { id: userId }, { password: hash });
      await this.authService.revokeOtherSessions(
        userId,
        options.currentSessionId,
        options.revokeReason,
        qr.manager,
      );
      await qr.commitTransaction();
      return { message: 'Password changed successfully.' };
    } catch (err) {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      if (err instanceof HttpException) throw err;
      this.errorsService.userNotFound(err);
      this.errorsService.default(err);
    } finally {
      await qr.release();
    }
  }
}
