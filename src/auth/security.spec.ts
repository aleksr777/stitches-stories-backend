import { ExecutionContext, HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource, Repository } from 'typeorm';
import { EnvService } from '../common/env-service/env.service';
import { ErrorsService } from '../common/errors-service/errors.service';
import { HashService } from '../common/hash-service/hash.service';
import { MailService } from '../common/mail-service/mail.service';
import { RedisService } from '../common/redis-service/redis.service';
import { ApiRateLimitGuard } from '../common/rate-limit-service/api-rate-limit.guard';
import { JwtPayload } from '../common/types/jwt-tokens.type';
import { User } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import { LoginRateLimitService } from './login-rate-limit.service';
import { PasswordResetService } from './password-reset.service';
import { PublicVerificationRateLimitService } from './public-verification-rate-limit.service';
import { SessionTokenService } from './session-token.service';
import { TokensService } from './tokens.service';

const createEnvService = (values: Record<string, string | number>) =>
  ({
    get: jest.fn((key: string) => values[key]),
  }) as unknown as EnvService;

const createRedisMock = () => ({
  get: jest.fn(),
  del: jest.fn(),
  ttl: jest.fn(),
  incrWithExpire: jest.fn(),
});

describe('authentication security primitives', () => {
  describe('HashService refresh-token hashing', () => {
    const service = new HashService();

    it('hashes tokens deterministically without storing the raw token', () => {
      const token = 'refresh-token-value';
      const hash = service.hashToken(token);

      expect(hash).toHaveLength(64);
      expect(hash).not.toBe(token);
      expect(service.hashToken(token)).toBe(hash);
    });

    it('compares refresh tokens using the stored hash', () => {
      const hash = service.hashToken('current-token');

      expect(service.compareToken('current-token', hash)).toBe(true);
      expect(service.compareToken('replayed-token', hash)).toBe(false);
    });
  });

  describe('SessionTokenService rotation tokens', () => {
    const envService = createEnvService({
      JWT_ACCESS_SECRET: 'access-secret',
      JWT_REFRESH_SECRET: 'refresh-secret',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
    });
    const jwtService = new JwtService();
    const service = new SessionTokenService(jwtService, envService);

    it('binds tokens to one session and generates a unique refresh jti on each rotation', () => {
      const sessionId = '11111111-1111-4111-8111-111111111111';
      const first = service.generate(7, sessionId);
      const second = service.generate(7, sessionId);
      const firstAccessPayload = jwtService.decode<JwtPayload>(
        first.access_token,
      );
      const firstRefreshPayload = jwtService.decode<JwtPayload>(
        first.refresh_token,
      );
      const secondRefreshPayload = jwtService.decode<JwtPayload>(
        second.refresh_token,
      );

      expect(first.refresh_token).not.toBe(second.refresh_token);
      expect(firstAccessPayload?.sub).toBe(7);
      expect(firstAccessPayload?.sid).toBe(sessionId);
      expect(firstRefreshPayload?.sub).toBe(7);
      expect(secondRefreshPayload?.sub).toBe(7);
      expect(firstRefreshPayload?.sid).toBe(sessionId);
      expect(secondRefreshPayload?.sid).toBe(sessionId);
      expect(typeof firstRefreshPayload?.jti).toBe('string');
      expect(typeof secondRefreshPayload?.jti).toBe('string');
      expect(firstRefreshPayload?.jti).not.toBe(secondRefreshPayload?.jti);
    });
  });

  describe('LoginRateLimitService', () => {
    const envService = createEnvService({
      LOGIN_EMAIL_MAX_ATTEMPTS: 5,
      LOGIN_IP_MAX_ATTEMPTS: 20,
      LOGIN_RATE_LIMIT_WINDOW: 300,
    });
    const errorsService = new ErrorsService();

    it('normalizes email keys and clears successful-login failures', async () => {
      const redis = createRedisMock();
      redis.del.mockResolvedValue(1);
      const service = new LoginRateLimitService(
        redis as unknown as RedisService,
        envService,
        errorsService,
      );

      await service.clearEmailFailures('  User@Example.COM ');

      expect(redis.del).toHaveBeenCalledWith(
        'login:failures:email:user@example.com',
      );
    });

    it('returns 429 when the email failure limit is reached', async () => {
      const redis = createRedisMock();
      redis.incrWithExpire.mockResolvedValueOnce(5).mockResolvedValueOnce(1);
      redis.ttl.mockResolvedValue(180);
      const service = new LoginRateLimitService(
        redis as unknown as RedisService,
        envService,
        errorsService,
      );

      await expect(
        service.registerFailure('user@example.com', '127.0.0.1'),
      ).rejects.toMatchObject({ status: 429 });
    });
  });

  describe('PublicVerificationRateLimitService', () => {
    const envService = createEnvService({
      PUBLIC_VERIFICATION_IP_MAX_REQUESTS: 20,
      PUBLIC_VERIFICATION_IP_RATE_LIMIT_WINDOW: 600,
    });
    const errorsService = new ErrorsService();

    it('allows requests up to the configured IP limit', async () => {
      const redis = createRedisMock();
      redis.incrWithExpire.mockResolvedValue(20);
      const service = new PublicVerificationRateLimitService(
        redis as unknown as RedisService,
        envService,
        errorsService,
      );

      await expect(service.consume('127.0.0.1')).resolves.toBeUndefined();
      expect(redis.incrWithExpire).toHaveBeenCalledWith(
        'verification:requests:ip:127.0.0.1',
        600,
      );
    });

    it('returns 429 with the Redis TTL after the IP limit is exceeded', async () => {
      const redis = createRedisMock();
      redis.incrWithExpire.mockResolvedValue(21);
      redis.ttl.mockResolvedValue(420);
      const service = new PublicVerificationRateLimitService(
        redis as unknown as RedisService,
        envService,
        errorsService,
      );

      try {
        await service.consume('127.0.0.1');
        throw new Error('Expected rate limit error');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HttpException);
        const httpError = err as HttpException;
        expect(httpError.getStatus()).toBe(429);
        expect(httpError.getResponse()).toMatchObject({ retry_after: 420 });
      }
    });
  });

  describe('ApiRateLimitGuard', () => {
    const envService = createEnvService({
      API_IP_MAX_REQUESTS: 600,
      API_RATE_LIMIT_WINDOW: 60,
      AUTH_IP_MAX_REQUESTS: 120,
      AUTH_RATE_LIMIT_WINDOW: 60,
    });
    const errorsService = new ErrorsService();

    const createContext = (request: object) =>
      ({
        switchToHttp: () => ({
          getRequest: () => request,
        }),
      }) as unknown as ExecutionContext;

    it('counts auth requests against both general and auth-specific limits', async () => {
      const redis = createRedisMock();
      redis.incrWithExpire.mockResolvedValue(1);
      const guard = new ApiRateLimitGuard(
        redis as unknown as RedisService,
        envService,
        errorsService,
      );
      const context = createContext({
        method: 'POST',
        ip: '127.0.0.1',
        socket: {},
        originalUrl: '/api/auth/login',
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(redis.incrWithExpire).toHaveBeenNthCalledWith(
        1,
        'rate-limit:api:ip:127.0.0.1',
        60,
      );
      expect(redis.incrWithExpire).toHaveBeenNthCalledWith(
        2,
        'rate-limit:auth:ip:127.0.0.1',
        60,
      );
    });

    it('does not rate-limit CORS preflight requests', async () => {
      const redis = createRedisMock();
      const guard = new ApiRateLimitGuard(
        redis as unknown as RedisService,
        envService,
        errorsService,
      );
      const context = createContext({
        method: 'OPTIONS',
        ip: '127.0.0.1',
        socket: {},
        originalUrl: '/api/auth/login',
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(redis.incrWithExpire).not.toHaveBeenCalled();
    });
  });

  describe('PasswordResetService', () => {
    const createPasswordResetDataSource = (consumeUpdate = true) => {
      const managerFindOne = jest.fn().mockResolvedValue({
        id: 7,
        email: 'admin@example.com',
      });
      const managerUpdate = jest.fn().mockResolvedValue({
        affected: consumeUpdate ? 1 : 0,
      });
      const queryRunner = {
        isTransactionActive: false,
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn(function (this: {
          isTransactionActive: boolean;
        }) {
          this.isTransactionActive = true;
          return Promise.resolve();
        }),
        commitTransaction: jest.fn(function (this: {
          isTransactionActive: boolean;
        }) {
          this.isTransactionActive = false;
          return Promise.resolve();
        }),
        rollbackTransaction: jest.fn(function (this: {
          isTransactionActive: boolean;
        }) {
          this.isTransactionActive = false;
          return Promise.resolve();
        }),
        release: jest.fn().mockResolvedValue(undefined),
        manager: {
          findOne: managerFindOne,
          update: managerUpdate,
        },
      };
      const dataSource = {
        createQueryRunner: jest.fn(() => queryRunner),
      } as unknown as DataSource;
      return { dataSource, queryRunner, managerUpdate };
    };

    it('atomically changes the password and revokes old sessions before the controller signs in', async () => {
      const users = {} as Repository<User>;
      const revokeAllSessions = jest.fn().mockResolvedValue(undefined);
      const login = jest.fn();
      const authService = {
        revokeAllSessions,
        login,
      } as unknown as AuthService;
      const assertVerificationAttemptsAvailable = jest
        .fn()
        .mockResolvedValue(undefined);
      const getIdByResetCode = jest.fn().mockResolvedValue(7);
      const consumeResetCode = jest.fn().mockResolvedValue(7);
      const clearVerificationFailures = jest.fn().mockResolvedValue(undefined);
      const tokensService = {
        assertVerificationAttemptsAvailable,
        getIdByResetCode,
        consumeResetCode,
        clearVerificationFailures,
      } as unknown as TokensService;
      const hashPassword = jest.fn().mockResolvedValue('hashed-password');
      const hashService = { hash: hashPassword } as unknown as HashService;
      const errorsService = new ErrorsService();
      const mailService = {} as MailService;
      const envService = createEnvService({
        RESET_TOKEN_EXPIRES_IN: 300,
        PASSWORD_RESET_VERIFICATION_LOCKOUT: 180,
      });
      const redis = createRedisMock();
      redis.ttl.mockResolvedValue(0);
      redis.del.mockResolvedValue(1);
      const { dataSource, queryRunner, managerUpdate } =
        createPasswordResetDataSource();
      const service = new PasswordResetService(
        users,
        authService,
        tokensService,
        hashService,
        errorsService,
        mailService,
        envService,
        redis as unknown as RedisService,
        dataSource,
      );

      await expect(
        service.confirm('123456', 'new-password-123', ' ADMIN@example.com '),
      ).resolves.toEqual({
        message: 'Password reset successfully.',
      });

      expect(consumeResetCode).toHaveBeenCalledWith(7, '123456');
      expect(managerUpdate).toHaveBeenCalledWith(
        User,
        { id: 7 },
        { password: 'hashed-password' },
      );
      expect(revokeAllSessions).toHaveBeenCalledWith(
        7,
        'password_reset',
        queryRunner.manager,
      );
      expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
      expect(login).not.toHaveBeenCalled();
    });

    it('rejects a reset code that was consumed by another request', async () => {
      const users = {} as Repository<User>;
      const authService = {
        revokeAllSessions: jest.fn(),
      } as unknown as AuthService;
      const registerVerificationFailure = jest.fn().mockResolvedValue(false);
      const getVerificationAttemptsRemaining = jest.fn().mockResolvedValue(4);
      const tokensService = {
        assertVerificationAttemptsAvailable: jest
          .fn()
          .mockResolvedValue(undefined),
        getIdByResetCode: jest.fn().mockResolvedValue(7),
        consumeResetCode: jest.fn().mockResolvedValue(null),
        registerVerificationFailure,
        getVerificationAttemptsRemaining,
      } as unknown as TokensService;
      const errorsService = new ErrorsService();
      const envService = createEnvService({
        RESET_TOKEN_EXPIRES_IN: 300,
        PASSWORD_RESET_VERIFICATION_LOCKOUT: 180,
      });
      const redis = createRedisMock();
      redis.ttl.mockResolvedValue(0);
      const { dataSource, queryRunner, managerUpdate } =
        createPasswordResetDataSource();
      const service = new PasswordResetService(
        users,
        authService,
        tokensService,
        { hash: jest.fn() } as unknown as HashService,
        errorsService,
        {} as MailService,
        envService,
        redis as unknown as RedisService,
        dataSource,
      );

      await expect(
        service.confirm('123456', 'new-password-123', 'admin@example.com'),
      ).rejects.toMatchObject({ status: 401 });
      expect(managerUpdate).not.toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(registerVerificationFailure).toHaveBeenCalledWith(
        expect.anything(),
        'admin@example.com',
      );
    });
  });
});
