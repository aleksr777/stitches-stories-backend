import documents from '../src/legal/documents.json';
const registrationDetails = {
  name: 'Тестовый пользователь',
  documents: [documents['pd-account'], documents['account-terms']].map(
    ({ id, version, sha256 }) => ({ id, version, sha256 }),
  ),
};
import {
  ExecutionContext,
  HttpException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Server } from 'node:http';
import { Request } from 'express';
import request from 'supertest';
import { AdminLoginService } from '../src/auth/admin-login.service';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { PasswordResetService } from '../src/auth/password-reset.service';
import { PublicVerificationRateLimitService } from '../src/auth/public-verification-rate-limit.service';
import { RegistrationService } from '../src/auth/registration.service';
import { RefreshOriginGuard } from '../src/auth/guards/refresh-origin.guard';
import { RefreshTokenGuard } from '../src/auth/guards/refresh-token.guard';
import { LocalAuthGuard } from '../src/auth/guards/local-auth.guard';
import { EnvService } from '../src/common/env-service/env.service';
import { ErrorsService } from '../src/common/errors-service/errors.service';
import { SecurityConfigService } from '../src/common/security/security-config.service';
import { configureHttpSecurity } from '../src/common/security/security-http';
import { Role } from '../src/common/types/role.enum';
import { User } from '../src/users/entities/user.entity';

const refreshTokens = {
  access_token: 'new-access-token',
  refresh_token: 'new-refresh-token',
  access_token_expires: 1_900_000_000,
  refresh_token_expires: 1_900_000_100,
};

const FRONTEND_ORIGIN = 'http://localhost:5173';

type AuthResponseBody = {
  access_token: string;
  access_token_expires: number;
  refresh_token?: unknown;
};

describe('AuthController (e2e)', () => {
  let app: NestExpressApplication;

  const envValues = new Map<string, string>();
  const parseEnvValue = (
    value: string,
    type: 'string' | 'number' | 'boolean',
  ): string | number | boolean => {
    if (type === 'boolean') return value === 'true';
    if (type === 'number') return Number(value);
    return value;
  };
  const envService = {
    get: jest.fn(
      (
        key: string,
        type: 'string' | 'number' | 'boolean' = 'string',
      ): string | number | boolean => {
        const value = envValues.get(key);
        if (value === undefined) throw new Error(`Missing test env: ${key}`);
        return parseEnvValue(value, type);
      },
    ),
    getOptional: jest.fn(
      (
        key: string,
        type: 'string' | 'number' | 'boolean' = 'string',
      ): string | number | boolean | undefined => {
        const value = envValues.get(key);
        return value === undefined ? undefined : parseEnvValue(value, type);
      },
    ),
  } as unknown as EnvService;

  const authService = {
    refreshJwtTokens: jest.fn(),
    validateUserByEmailAndPassword: jest.fn(),
    isUserBlocked: jest.fn(),
    loginNewSession: jest.fn(),
  };
  const registrationService = {
    request: jest.fn(),
    resend: jest.fn(),
    confirm: jest.fn(),
  };
  const passwordResetService = {
    request: jest.fn(),
    confirm: jest.fn(),
  };
  const adminLoginService = {
    request: jest.fn(),
    confirm: jest.fn(),
    resend: jest.fn(),
  };
  let loginUser: User;
  const publicVerificationRateLimitService = {
    consume: jest.fn(),
  };

  const getServer = (): Server => app.getHttpServer();

  beforeEach(async () => {
    jest.clearAllMocks();
    loginUser = {
      id: 1,
      role: Role.ADMIN,
      email: 'admin@example.test',
      is_blocked: false,
    } as User;
    for (const service of [
      authService,
      adminLoginService,
      registrationService,
      passwordResetService,
      publicVerificationRateLimitService,
    ]) {
      for (const mock of Object.values(service)) mock.mockReset();
    }
    envValues.clear();
    envValues.set('FRONTEND_URL', FRONTEND_ORIGIN);
    envValues.set('REFRESH_COOKIE_SECURE', 'false');
    envValues.set('REFRESH_COOKIE_SAME_SITE', 'lax');
    envValues.set('TRUST_PROXY', 'false');
    envValues.set(
      'JWT_ACCESS_SECRET',
      'access-secret-that-is-at-least-32-characters-long',
    );
    envValues.set(
      'JWT_REFRESH_SECRET',
      'refresh-secret-that-is-at-least-32-characters-long',
    );
    envValues.set('DB_TYPEORM_SYNC', 'false');

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        ErrorsService,
        SecurityConfigService,
        RefreshOriginGuard,
        { provide: EnvService, useValue: envService },
        { provide: AuthService, useValue: authService },
        { provide: AdminLoginService, useValue: adminLoginService },
        { provide: RegistrationService, useValue: registrationService },
        { provide: PasswordResetService, useValue: passwordResetService },
        {
          provide: PublicVerificationRateLimitService,
          useValue: publicVerificationRateLimitService,
        },
      ],
    })
      .overrideGuard(LocalAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<Request>().user = loginUser;
          return true;
        },
      })
      .overrideGuard(RefreshTokenGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => { user?: { id: number } } };
        }) => {
          context.switchToHttp().getRequest().user = { id: 7 };
          return true;
        },
      })
      .compile();

    const securityConfig = moduleRef.get(SecurityConfigService);
    securityConfig.validate();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureHttpSecurity(app, securityConfig);
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('applies security headers and the public verification limiter', async () => {
    publicVerificationRateLimitService.consume.mockResolvedValue(undefined);
    registrationService.request.mockResolvedValue({
      message: 'If the email exists, we’ve sent you a code.',
      retry_after: 60,
      max_attempts: 5,
    });

    const response = await request(getServer())
      .post('/api/auth/registration/request')
      .send({
        email: 'user@example.com',
        password: 'password1234',
        ...registrationDetails,
      })
      .expect(201);

    expect(publicVerificationRateLimitService.consume).toHaveBeenCalledTimes(1);
    expect(registrationService.request).toHaveBeenCalledWith(
      'user@example.com',
      'password1234',
      registrationDetails,
    );
    expect(response.body as Record<string, unknown>).toMatchObject({
      retry_after: 60,
      max_attempts: 5,
    });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });

  it('returns 429 when the public verification IP limit is exceeded', async () => {
    publicVerificationRateLimitService.consume.mockRejectedValue(
      new HttpException(
        {
          message: 'Too many verification code requests from this IP.',
          retry_after: 300,
        },
        429,
      ),
    );

    const response = await request(getServer())
      .post('/api/auth/password-reset/request')
      .send({ email: 'user@example.com' })
      .expect(429);

    expect(passwordResetService.request).not.toHaveBeenCalled();
    expect(response.body as Record<string, unknown>).toMatchObject({
      retry_after: 300,
    });
  });

  it('rotates the refresh cookie for the configured frontend origin', async () => {
    authService.refreshJwtTokens.mockResolvedValue(refreshTokens);

    const response = await request(getServer())
      .post('/api/auth/refresh-tokens')
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', ['refresh_token=old-refresh-token'])
      .expect(201);

    const body = response.body as AuthResponseBody;
    const setCookie = response.headers['set-cookie']?.[0];

    expect(authService.refreshJwtTokens).toHaveBeenCalledWith(
      7,
      'old-refresh-token',
    );
    expect(body).toEqual({
      access_token: 'new-access-token',
      access_token_expires: 1_900_000_000,
    });
    expect(body.refresh_token).toBeUndefined();
    expect(setCookie).toContain('refresh_token=new-refresh-token');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Priority=High');
    expect(setCookie).not.toContain('Secure');
  });

  it('rejects refresh requests from an untrusted origin', async () => {
    await request(getServer())
      .post('/api/auth/refresh-tokens')
      .set('Origin', 'https://attacker.example')
      .set('Cookie', ['refresh_token=old-refresh-token'])
      .expect(403);

    expect(authService.refreshJwtTokens).not.toHaveBeenCalled();
  });

  it('rejects refresh requests without an Origin header', async () => {
    await request(getServer())
      .post('/api/auth/refresh-tokens')
      .set('Cookie', ['refresh_token=old-refresh-token'])
      .expect(403);

    expect(authService.refreshJwtTokens).not.toHaveBeenCalled();
  });

  it('rejects invalid registration payloads before calling the service', async () => {
    await request(getServer())
      .post('/api/auth/registration/request')
      .send({ email: 'not-an-email', password: 'short' })
      .expect(400);

    expect(registrationService.request).not.toHaveBeenCalled();
  });

  it('returns access credentials and an HttpOnly refresh cookie after registration', async () => {
    registrationService.confirm.mockResolvedValue(refreshTokens);
    const response = await request(getServer())
      .post('/api/auth/registration/confirm')
      .send({ code: '123456', email: 'user@example.com' })
      .expect(201);

    expect(response.body as AuthResponseBody).toEqual({
      access_token: refreshTokens.access_token,
      access_token_expires: refreshTokens.access_token_expires,
    });
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
    expect(response.headers['set-cookie']?.[0]).toContain(
      'refresh_token=new-refresh-token',
    );
  });

  it('authenticates a successful recovery and replaces the old refresh cookie', async () => {
    passwordResetService.confirm.mockResolvedValue({
      message: 'Password reset.',
    });
    authService.validateUserByEmailAndPassword.mockResolvedValue({
      id: 7,
      is_blocked: false,
    });
    authService.loginNewSession.mockResolvedValue(refreshTokens);
    const response = await request(getServer())
      .post('/api/auth/password-reset/confirm')
      .set('User-Agent', 'recovery-test')
      .set('Cookie', ['refresh_token=old-refresh-token'])
      .send({
        code: '123456',
        email: 'user@example.com',
        new_password: 'new-password123',
      })
      .expect(201);

    expect(passwordResetService.confirm).toHaveBeenCalledWith(
      '123456',
      'new-password123',
      'user@example.com',
    );
    expect(authService.loginNewSession).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ userAgent: 'recovery-test' }),
    );
    expect(response.body as AuthResponseBody).toEqual({
      access_token: refreshTokens.access_token,
      access_token_expires: refreshTokens.access_token_expires,
    });
    expect(response.headers['set-cookie']?.[0]).toContain(
      'refresh_token=new-refresh-token',
    );
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
  });

  it('does not issue credentials when a recovery code is rejected', async () => {
    passwordResetService.confirm.mockRejectedValue(
      new UnauthorizedException('Invalid code'),
    );
    const response = await request(getServer())
      .post('/api/auth/password-reset/confirm')
      .send({
        code: '654321',
        email: 'user@example.com',
        new_password: 'new-password123',
      })
      .expect(401);

    expect(authService.loginNewSession).not.toHaveBeenCalled();
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(
      (response.body as Partial<AuthResponseBody>).access_token,
    ).toBeUndefined();
  });

  it('does not authenticate a blocked account after recovery', async () => {
    passwordResetService.confirm.mockResolvedValue({
      message: 'Password reset.',
    });
    authService.validateUserByEmailAndPassword.mockResolvedValue({
      id: 7,
      is_blocked: true,
    });
    authService.isUserBlocked.mockImplementation(() => {
      throw new HttpException('Blocked', 403);
    });
    const response = await request(getServer())
      .post('/api/auth/password-reset/confirm')
      .send({
        code: '123456',
        email: 'user@example.com',
        new_password: 'new-password123',
      })
      .expect(403);

    expect(authService.loginNewSession).not.toHaveBeenCalled();
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('requires an emailed code before creating an administrator session', async () => {
    const challenge = {
      admin_confirmation_required: true,
      challenge_id: 'a'.repeat(64),
      expires_in: 300,
      retry_after: 60,
      max_attempts: 5,
      message: 'Код отправлен.',
    };
    publicVerificationRateLimitService.consume.mockResolvedValue(undefined);
    adminLoginService.request.mockResolvedValue(challenge);

    const response = await request(getServer())
      .post('/api/auth/login')
      .send({ email: loginUser.email, password: 'admin-password' })
      .expect(201);

    expect(response.body).toEqual(challenge);
    expect(adminLoginService.request).toHaveBeenCalledWith(loginUser);
    expect(authService.loginNewSession).not.toHaveBeenCalled();
    expect(response.headers['set-cookie']?.[0]).toContain('refresh_token=;');
    expect(publicVerificationRateLimitService.consume).toHaveBeenCalledTimes(1);
  });

  it('keeps an ordinary password login available without administrator confirmation', async () => {
    loginUser.role = Role.USER;
    authService.loginNewSession.mockResolvedValue(refreshTokens);

    const response = await request(getServer())
      .post('/api/auth/login')
      .send({ email: loginUser.email, password: 'user-password' })
      .expect(201);

    expect(response.body).toMatchObject({
      access_token: refreshTokens.access_token,
    });
    expect(adminLoginService.request).not.toHaveBeenCalled();
  });

  it('issues a refresh cookie only after a valid administrator confirmation', async () => {
    adminLoginService.confirm.mockResolvedValue(loginUser);
    authService.loginNewSession.mockResolvedValue(refreshTokens);

    const response = await request(getServer())
      .post('/api/auth/login/admin/confirm')
      .set('User-Agent', 'admin-confirm-test')
      .send({ challenge_id: 'a'.repeat(64), code: '123456' })
      .expect(201);

    expect(adminLoginService.confirm).toHaveBeenCalledWith(
      'a'.repeat(64),
      '123456',
    );
    expect(authService.loginNewSession).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ userAgent: 'admin-confirm-test' }),
    );
    expect(response.body).toMatchObject({
      access_token: refreshTokens.access_token,
    });
    expect(response.body).not.toHaveProperty('refresh_token');
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
  });

  it('validates administrator confirmation payloads and rate-limits resend requests', async () => {
    adminLoginService.confirm.mockRejectedValue(
      new UnauthorizedException('Неверный код'),
    );
    await request(getServer())
      .post('/api/auth/login/admin/confirm')
      .send({ challenge_id: 'a'.repeat(64), code: '000000' })
      .expect(401);
    await request(getServer())
      .post('/api/auth/login/admin/confirm')
      .send({ challenge_id: 'short', code: 'not-a-code' })
      .expect(400);

    publicVerificationRateLimitService.consume.mockResolvedValue(undefined);
    adminLoginService.resend.mockResolvedValue({
      admin_confirmation_required: true,
      challenge_id: 'b'.repeat(64),
      expires_in: 300,
      retry_after: 60,
      max_attempts: 5,
      message: 'Код отправлен.',
    });
    await request(getServer())
      .post('/api/auth/login/admin/resend')
      .send({ challenge_id: 'a'.repeat(64) })
      .expect(201);

    expect(publicVerificationRateLimitService.consume).toHaveBeenCalledTimes(1);
    expect(adminLoginService.resend).toHaveBeenCalledWith('a'.repeat(64));
  });
});
