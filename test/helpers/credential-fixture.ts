import { RegistrationPayload } from '../../src/legal/legal.types';
import { LegalService } from '../../src/legal/legal.service';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ActivityService } from '../../src/activity/activity.service';
import { SecurityAuditService } from '../../src/audit/security-audit.service';
import { AuthController } from '../../src/auth/auth.controller';
import { AdminLoginService } from '../../src/auth/admin-login.service';
import { AuthService } from '../../src/auth/auth.service';
import { AuthSession } from '../../src/auth/entities/auth-session.entity';
import { PasswordResetService } from '../../src/auth/password-reset.service';
import { PublicVerificationRateLimitService } from '../../src/auth/public-verification-rate-limit.service';
import { RegistrationService } from '../../src/auth/registration.service';
import { SessionTokenService } from '../../src/auth/session-token.service';
import { TokensService } from '../../src/auth/tokens.service';
import { EnvService } from '../../src/common/env-service/env.service';
import { ErrorsService } from '../../src/common/errors-service/errors.service';
import { HashService } from '../../src/common/hash-service/hash.service';
import { MailService } from '../../src/common/mail-service/mail.service';
import { RedisService } from '../../src/common/redis-service/redis.service';
import { SecurityConfigService } from '../../src/common/security/security-config.service';
import { EmailChangeService } from '../../src/users/email-change.service';
import { User } from '../../src/users/entities/user.entity';
import { PasswordChangeService } from '../../src/users/password-change.service';
import { UsersController } from '../../src/users/users.controller';
import { UsersService } from '../../src/users/users.service';

export const PASSWORD = 'original-password-123';
export const NEW_PASSWORD = 'replacement-password-456';
export const CODE = '123456';

export const createCredentialFixture = async (db: DataSource) => {
  const hash = new HashService();
  const errors = new ErrorsService();
  const users = db.getRepository(User);
  const user = await users.save(
    users.create({
      email: `${randomUUID()}@example.com`,
      password: await hash.hash(PASSWORD),
    }),
  );
  const values: Record<string, string> = {
    JWT_ACCESS_SECRET: 'test-access-secret-with-at-least-32-characters',
    JWT_REFRESH_SECRET: 'test-refresh-secret-with-at-least-32-characters',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
    FRONTEND_URL: 'http://localhost:5173',
    REFRESH_COOKIE_SECURE: 'false',
    REFRESH_COOKIE_SAME_SITE: 'lax',
    RESET_TOKEN_EXPIRES_IN: '600',
    REGISTRATION_TOKEN_EXPIRES_IN: '600',
    EMAIL_CHANGE_TOKEN_EXPIRES_IN: '600',
    PASSWORD_RESET_VERIFICATION_LOCKOUT: '300',
    REGISTRATION_VERIFICATION_LOCKOUT: '300',
    EMAIL_CHANGE_VERIFICATION_LOCKOUT: '300',
  };
  const env = {
    get: (key: string, type = 'string') => {
      if (!(key in values)) throw new Error(`Missing fixture setting: ${key}`);
      return type === 'number'
        ? Number(values[key])
        : type === 'boolean'
          ? values[key] === 'true'
          : values[key];
    },
    getOptional: () => undefined,
  } as unknown as EnvService;
  const security = new SecurityConfigService(env, errors);
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as SecurityAuditService;
  const activity = {
    setSessionActivity: jest.fn().mockResolvedValue(undefined),
    getSessionActivities: jest.fn().mockResolvedValue(new Map()),
  } as unknown as ActivityService;
  const mail = { validateNotServiceEmail: jest.fn() } as unknown as MailService;
  const redis = {
    ttl: jest.fn().mockResolvedValue(-2),
    del: jest.fn().mockResolvedValue(1),
  } as unknown as RedisService;
  let recoveryCodeUsed = false;
  let emailCodeUsed = false;
  const newEmail = `${randomUUID()}@example.com`;
  const emailChange = { user_id: user.id, new_email: newEmail };
  const tokenMocks = {
    assertVerificationAttemptsAvailable: jest.fn().mockResolvedValue(undefined),
    clearVerificationFailures: jest.fn().mockResolvedValue(undefined),
    registerVerificationFailure: jest.fn().mockResolvedValue(false),
    getVerificationAttemptsRemaining: jest.fn().mockResolvedValue(4),
    getIdByResetCode: jest.fn((code: string) =>
      Promise.resolve(code === CODE && !recoveryCodeUsed ? user.id : null),
    ),
    consumeResetCode: jest.fn((_id: number, code: string) => {
      if (code !== CODE || recoveryCodeUsed) return Promise.resolve(null);
      recoveryCodeUsed = true;
      return Promise.resolve(user.id);
    }),
    getDataByEmailChangeCode: jest.fn((code: string) =>
      Promise.resolve(code === CODE && !emailCodeUsed ? emailChange : null),
    ),
    consumeEmailChangeCode: jest.fn((_id: number, code: string) => {
      if (code !== CODE || emailCodeUsed) return Promise.resolve(null);
      emailCodeUsed = true;
      return Promise.resolve(emailChange);
    }),
    getIdByPasswordChangeCode: jest.fn().mockResolvedValue(user.id),
    consumePasswordChangeCode: jest.fn().mockResolvedValue(user.id),
    getIdByCurrentUserPasswordResetCode: jest.fn().mockResolvedValue(user.id),
    consumeCurrentUserPasswordResetCode: jest.fn().mockResolvedValue(user.id),
    consumeRegistrationCode: jest.fn().mockResolvedValue({
      email: `${randomUUID()}@example.com`,
      password: user.password,
    } as RegistrationPayload),
  };
  const tokens = tokenMocks as unknown as TokensService;
  const auth = new AuthService(
    users,
    db.getRepository(AuthSession),
    db,
    new SessionTokenService(new JwtService(), env),
    activity,
    hash,
    errors,
    security,
    audit,
  );
  const reset = new PasswordResetService(
    users,
    auth,
    tokens,
    hash,
    errors,
    mail,
    env,
    redis,
    db,
  );
  const registration = new RegistrationService(
    users,
    db,
    auth,
    tokens,
    hash,
    errors,
    mail,
    env,
    redis,
    new LegalService(db),
  );
  const email = new EmailChangeService(
    db,
    users,
    mail,
    env,
    errors,
    redis,
    tokens,
    auth,
  );
  const password = new PasswordChangeService(
    db,
    users,
    auth,
    hash,
    errors,
    tokens,
    mail,
    env,
  );
  const authController = new AuthController(
    auth,
    {} as AdminLoginService,
    registration,
    reset,
    {} as PublicVerificationRateLimitService,
    security,
  );
  const usersController = new UsersController(
    new UsersService(db, users, auth, hash, errors),
    email,
    password,
    security,
    audit,
  );
  return {
    user,
    newEmail,
    auth,
    authController,
    usersController,
    tokenMocks,
    users,
    hash,
  };
};
