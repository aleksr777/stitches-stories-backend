import { RegistrationPayload } from '../legal/legal.types';
import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { EnvService } from '../common/env-service/env.service';
import { ErrMsg } from '../common/errors-service/error-messages.type';
import { ErrorsService } from '../common/errors-service/errors.service';
import { RedisService } from '../common/redis-service/redis.service';
import { TokenType } from '../common/types/token-type.type';

const RESET_REDIS_PREFIX = 'reset:';
const RESET_ACTIVE_REDIS_PREFIX = 'reset:active:';
const CURRENT_USER_PASSWORD_RESET_REDIS_PREFIX = 'current-user-password-reset:';
const CURRENT_USER_PASSWORD_RESET_ACTIVE_REDIS_PREFIX =
  'current-user-password-reset:active:';
const REGISTER_REDIS_PREFIX = 'register:';
const REGISTER_ACTIVE_REDIS_PREFIX = 'register:active:';
const EMAIL_CHANGE_REDIS_PREFIX = 'email-change:';
const EMAIL_CHANGE_ACTIVE_REDIS_PREFIX = 'email-change:active:';
const PASSWORD_CHANGE_PREFIX = 'password-change:';
const PASSWORD_CHANGE_ACTIVE_PREFIX = 'password-change:active:';
const VERIFICATION_ATTEMPTS_PREFIX = 'verification:attempts:';
const VERIFICATION_RESEND_PREFIX = 'verification:resend:';
const DEFAULT_VERIFICATION_ATTEMPTS = 5;

export type EmailChangePayload =
  | { user_id: number; kind: 'login'; new_email: string }
  | {
      user_id: number;
      kind: 'contact';
      new_email: string | null;
      old_email: string | null;
    };

@Injectable()
export class TokensService {
  private readonly resetExpiresIn: number;
  private readonly registrationExpiresIn: number;
  private readonly emailChangeTokenExpiresIn: number;
  private readonly passwordChangeTokenExpiresIn: number;
  private readonly verificationResendCooldown: number;

  constructor(
    private readonly redisService: RedisService,
    private readonly envService: EnvService,
    private readonly errorsService: ErrorsService,
  ) {
    this.resetExpiresIn = this.envService.get(
      'RESET_TOKEN_EXPIRES_IN',
      'number',
    );
    this.registrationExpiresIn = this.envService.get(
      'REGISTRATION_TOKEN_EXPIRES_IN',
      'number',
    );
    this.emailChangeTokenExpiresIn = this.envService.get(
      'EMAIL_CHANGE_TOKEN_EXPIRES_IN',
      'number',
    );
    this.passwordChangeTokenExpiresIn = this.envService.get(
      'PASSWORD_CHANGE_TOKEN_EXPIRES_IN',
      'number',
    );
    this.verificationResendCooldown = this.envService.get(
      'VERIFICATION_CODE_RESEND_COOLDOWN',
      'number',
    );
  }

  private isRegistrationPayload(obj: unknown): obj is RegistrationPayload {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      'email' in obj &&
      typeof (obj as { email?: unknown }).email === 'string' &&
      'password' in obj &&
      typeof (obj as { password?: unknown }).password === 'string'
    );
  }

  private parseRegistrationPayload(
    raw: string | null,
  ): RegistrationPayload | null {
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return this.isRegistrationPayload(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private parseUserId(raw: string | null): number | null {
    if (!raw) return null;
    const userId = Number.parseInt(raw, 10);
    return Number.isInteger(userId) && userId > 0 ? userId : null;
  }

  private getVerificationAttemptConfig(tokenType: TokenType) {
    switch (tokenType) {
      case TokenType.REGISTRATION:
        return {
          maxAttempts: DEFAULT_VERIFICATION_ATTEMPTS,
          expiresIn: this.registrationExpiresIn,
        };
      case TokenType.PASSWORD_RESET:
      case TokenType.CURRENT_USER_PASSWORD_RESET:
        return {
          maxAttempts: DEFAULT_VERIFICATION_ATTEMPTS,
          expiresIn: this.resetExpiresIn,
        };
      case TokenType.EMAIL_CHANGE:
        return {
          maxAttempts: DEFAULT_VERIFICATION_ATTEMPTS,
          expiresIn: this.emailChangeTokenExpiresIn,
        };
      case TokenType.PASSWORD_CHANGE:
        return {
          maxAttempts: DEFAULT_VERIFICATION_ATTEMPTS,
          expiresIn: this.passwordChangeTokenExpiresIn,
        };
      default:
        return {
          maxAttempts: DEFAULT_VERIFICATION_ATTEMPTS,
          expiresIn: this.resetExpiresIn,
        };
    }
  }

  private getVerificationAttemptsKey(tokenType: TokenType, subject: string) {
    return `${VERIFICATION_ATTEMPTS_PREFIX}${tokenType.toLowerCase()}:${subject}`;
  }

  private getVerificationResendKey(tokenType: TokenType, subject: string) {
    return `${VERIFICATION_RESEND_PREFIX}${tokenType.toLowerCase()}:${subject}`;
  }

  private getRegistrationActiveKey(email: string) {
    return `${REGISTER_ACTIVE_REDIS_PREFIX}${email.trim().toLowerCase()}`;
  }

  private getResetActiveKey(userId: number) {
    return `${RESET_ACTIVE_REDIS_PREFIX}${userId}`;
  }

  private getCurrentUserPasswordResetActiveKey(userId: number) {
    return `${CURRENT_USER_PASSWORD_RESET_ACTIVE_REDIS_PREFIX}${userId}`;
  }

  private getEmailChangeActiveKey(userId: number) {
    return `${EMAIL_CHANGE_ACTIVE_REDIS_PREFIX}${userId}`;
  }

  private getPasswordChangeActiveKey(userId: number) {
    return `${PASSWORD_CHANGE_ACTIVE_PREFIX}${userId}`;
  }

  getVerificationAttemptLimit(tokenType: TokenType) {
    return this.getVerificationAttemptConfig(tokenType).maxAttempts;
  }

  async reserveVerificationCodeRequest(tokenType: TokenType, subject: string) {
    const key = this.getVerificationResendKey(tokenType, subject);
    const result = await this.redisService.set(key, '1', {
      EX: this.verificationResendCooldown,
      NX: true,
    });

    if (result === 'OK') return this.verificationResendCooldown;

    const ttl = await this.redisService.ttl(key);
    const retryAfter = typeof ttl === 'number' && ttl > 0 ? ttl : 1;
    this.errorsService.tooManyRequests(
      ErrMsg.VERIFICATION_CODE_RESEND_TOO_SOON,
      retryAfter,
    );
  }

  async releaseVerificationCodeRequest(tokenType: TokenType, subject: string) {
    await this.redisService.del(
      this.getVerificationResendKey(tokenType, subject),
    );
  }

  async getVerificationAttemptsRemaining(
    tokenType: TokenType,
    subject: string,
  ) {
    const { maxAttempts } = this.getVerificationAttemptConfig(tokenType);
    const key = this.getVerificationAttemptsKey(tokenType, subject);
    const raw = await this.redisService.get(key);
    const attempts = raw ? Number.parseInt(raw, 10) : 0;
    const safeAttempts = Number.isFinite(attempts) ? attempts : 0;
    return Math.max(0, maxAttempts - safeAttempts);
  }

  async assertVerificationAttemptsAvailable(
    tokenType: TokenType,
    subject: string,
  ) {
    const attemptsRemaining = await this.getVerificationAttemptsRemaining(
      tokenType,
      subject,
    );
    if (attemptsRemaining <= 0) {
      this.errorsService.invalidTokenWithAttempts(tokenType, 0);
    }
  }

  async registerVerificationFailure(tokenType: TokenType, subject: string) {
    const { maxAttempts, expiresIn } =
      this.getVerificationAttemptConfig(tokenType);
    const key = this.getVerificationAttemptsKey(tokenType, subject);
    const attempts = await this.redisService.incrWithExpire(key, expiresIn);
    return attempts >= maxAttempts;
  }

  async clearVerificationFailures(tokenType: TokenType, subject: string) {
    await this.redisService.del(
      this.getVerificationAttemptsKey(tokenType, subject),
    );
  }

  generateVerificationCode(): string {
    return randomInt(100_000, 1_000_000).toString();
  }

  private async saveVerificationToken(
    prefix: string,
    value: string,
    expiresIn: number,
  ): Promise<string> {
    const maxAttempts = 100;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const code = this.generateVerificationCode();
      const key = `${prefix}${code}`;
      const result = await this.redisService.set(key, value, {
        EX: expiresIn,
        NX: true,
      });
      if (result === 'OK') return code;
    }
    this.errorsService.default(null, ErrMsg.UNABLE_GENERATE_UNIQUE_CODE);
  }

  private async replaceActiveUserCode(
    activeKey: string,
    code: string,
    tokenPrefix: string,
    expiresIn: number,
  ) {
    const previousCode = await this.redisService.get(activeKey);
    await this.redisService.set(activeKey, code, { EX: expiresIn });
    if (previousCode && previousCode !== code) {
      await this.redisService.del(`${tokenPrefix}${previousCode}`);
    }
  }

  async getRegistrationCode(value: RegistrationPayload) {
    if (!this.isRegistrationPayload(value)) {
      this.errorsService.default(null, ErrMsg.INVALID_REGISTRATION_PAYLOAD);
    }

    const normalizedEmail = value.email.trim().toLowerCase();
    const activeKey = this.getRegistrationActiveKey(normalizedEmail);
    const previousCode = await this.redisService.get(activeKey);
    const json = JSON.stringify({ ...value, email: normalizedEmail });
    const code = await this.saveVerificationToken(
      REGISTER_REDIS_PREFIX,
      json,
      this.registrationExpiresIn,
    );

    await this.redisService.set(activeKey, code, {
      EX: this.registrationExpiresIn,
    });
    if (previousCode && previousCode !== code) {
      await this.redisService.del(`${REGISTER_REDIS_PREFIX}${previousCode}`);
    }
    return code;
  }

  async getActiveRegistrationData(email: string) {
    const activeCode = await this.redisService.get(
      this.getRegistrationActiveKey(email),
    );
    if (!activeCode) return null;
    const data = await this.getDataByRegistrationCode(activeCode);
    return data ? { code: activeCode, data } : null;
  }

  async getDataByRegistrationCode(
    code: string,
  ): Promise<{ email: string; password: string } | null> {
    const raw = await this.redisService.get(`${REGISTER_REDIS_PREFIX}${code}`);
    return this.parseRegistrationPayload(raw);
  }

  async consumeRegistrationCode(email: string, code: string) {
    const raw = await this.redisService.consumeActiveToken(
      this.getRegistrationActiveKey(email),
      code,
      `${REGISTER_REDIS_PREFIX}${code}`,
    );
    return this.parseRegistrationPayload(raw);
  }

  async deleteRegistrationCode(code: string, email?: string) {
    await this.redisService.del(`${REGISTER_REDIS_PREFIX}${code}`);
    if (!email) return;
    const activeKey = this.getRegistrationActiveKey(email);
    const activeCode = await this.redisService.get(activeKey);
    if (activeCode === code) await this.redisService.del(activeKey);
  }

  async getResetCode(userId: number) {
    if (!userId) this.errorsService.default(null, ErrMsg.USER_ID_NOT_DEFINED);

    const activeKey = this.getResetActiveKey(userId);
    const previousCode = await this.redisService.get(activeKey);
    const code = await this.saveVerificationToken(
      RESET_REDIS_PREFIX,
      userId.toString(),
      this.resetExpiresIn,
    );
    await this.redisService.set(activeKey, code, { EX: this.resetExpiresIn });
    if (previousCode && previousCode !== code) {
      await this.redisService.del(`${RESET_REDIS_PREFIX}${previousCode}`);
    }
    return code;
  }

  async getIdByResetCode(code: string): Promise<number | null> {
    return this.parseUserId(
      await this.redisService.get(`${RESET_REDIS_PREFIX}${code}`),
    );
  }

  async consumeResetCode(userId: number, code: string): Promise<number | null> {
    const raw = await this.redisService.consumeActiveToken(
      this.getResetActiveKey(userId),
      code,
      `${RESET_REDIS_PREFIX}${code}`,
    );
    const consumedUserId = this.parseUserId(raw);
    return consumedUserId === userId ? consumedUserId : null;
  }

  async deletePassResetCode(code: string, userId?: number) {
    await this.redisService.del(`${RESET_REDIS_PREFIX}${code}`);
    if (!userId) return;
    const activeKey = this.getResetActiveKey(userId);
    const activeCode = await this.redisService.get(activeKey);
    if (activeCode === code) await this.redisService.del(activeKey);
  }

  async getCurrentUserPasswordResetCode(userId: number) {
    if (!userId) this.errorsService.default(null, ErrMsg.USER_ID_NOT_DEFINED);
    const code = await this.saveVerificationToken(
      CURRENT_USER_PASSWORD_RESET_REDIS_PREFIX,
      userId.toString(),
      this.resetExpiresIn,
    );
    await this.replaceActiveUserCode(
      this.getCurrentUserPasswordResetActiveKey(userId),
      code,
      CURRENT_USER_PASSWORD_RESET_REDIS_PREFIX,
      this.resetExpiresIn,
    );
    return code;
  }

  async getIdByCurrentUserPasswordResetCode(
    code: string,
  ): Promise<number | null> {
    return this.parseUserId(
      await this.redisService.get(
        `${CURRENT_USER_PASSWORD_RESET_REDIS_PREFIX}${code}`,
      ),
    );
  }

  async consumeCurrentUserPasswordResetCode(
    userId: number,
    code: string,
  ): Promise<number | null> {
    const raw = await this.redisService.consumeActiveToken(
      this.getCurrentUserPasswordResetActiveKey(userId),
      code,
      `${CURRENT_USER_PASSWORD_RESET_REDIS_PREFIX}${code}`,
    );
    const consumedUserId = this.parseUserId(raw);
    return consumedUserId === userId ? consumedUserId : null;
  }

  async deleteCurrentUserPasswordResetCode(code: string, userId?: number) {
    await this.redisService.del(
      `${CURRENT_USER_PASSWORD_RESET_REDIS_PREFIX}${code}`,
    );
    if (!userId) return;
    const activeKey = this.getCurrentUserPasswordResetActiveKey(userId);
    const activeCode = await this.redisService.get(activeKey);
    if (activeCode === code) await this.redisService.del(activeKey);
  }

  async getEmailChangeCode(value: EmailChangePayload) {
    if (!value) this.errorsService.default(null, ErrMsg.PAYLOAD_NOT_DEFINED);
    return this.saveVerificationToken(
      EMAIL_CHANGE_REDIS_PREFIX,
      JSON.stringify(value),
      this.emailChangeTokenExpiresIn,
    );
  }

  async getDataByEmailChangeCode(code: string) {
    const raw = await this.redisService.get(
      `${EMAIL_CHANGE_REDIS_PREFIX}${code}`,
    );
    if (!raw) return undefined;
    return JSON.parse(raw) as EmailChangePayload;
  }

  async consumeEmailChangeCode(userId: number, code: string) {
    const raw = await this.redisService.consumeActiveToken(
      this.getEmailChangeActiveKey(userId),
      code,
      `${EMAIL_CHANGE_REDIS_PREFIX}${code}`,
    );
    if (!raw) return undefined;
    return JSON.parse(raw) as EmailChangePayload;
  }

  async getPasswordChangeCode(userId: number) {
    if (!userId) this.errorsService.default(null, ErrMsg.USER_ID_NOT_DEFINED);
    const code = await this.saveVerificationToken(
      PASSWORD_CHANGE_PREFIX,
      userId.toString(),
      this.passwordChangeTokenExpiresIn,
    );
    await this.replaceActiveUserCode(
      this.getPasswordChangeActiveKey(userId),
      code,
      PASSWORD_CHANGE_PREFIX,
      this.passwordChangeTokenExpiresIn,
    );
    return code;
  }

  async getIdByPasswordChangeCode(code: string): Promise<number | null> {
    return this.parseUserId(
      await this.redisService.get(`${PASSWORD_CHANGE_PREFIX}${code}`),
    );
  }

  async consumePasswordChangeCode(
    userId: number,
    code: string,
  ): Promise<number | null> {
    const raw = await this.redisService.consumeActiveToken(
      this.getPasswordChangeActiveKey(userId),
      code,
      `${PASSWORD_CHANGE_PREFIX}${code}`,
    );
    const consumedUserId = this.parseUserId(raw);
    return consumedUserId === userId ? consumedUserId : null;
  }
}
