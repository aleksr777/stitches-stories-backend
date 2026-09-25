import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Server } from 'node:http';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { SocialController } from '../src/auth/social/social.controller';
import { SocialFlowService } from '../src/auth/social/social-flow.service';
import { SocialProviderService } from '../src/auth/social/social-provider.service';
import { SocialAccountService } from '../src/auth/social/social-account.service';
import { AuthService } from '../src/auth/auth.service';
import { PublicVerificationRateLimitService } from '../src/auth/public-verification-rate-limit.service';
import { LocalAuthGuard } from '../src/auth/guards/local-auth.guard';
import { SecurityConfigService } from '../src/common/security/security-config.service';
import { ErrorsService } from '../src/common/errors-service/errors.service';

describe('Social HTTP boundaries', () => {
  const origin = 'http://localhost:5173';
  let app: INestApplication;
  const oldFrontend = process.env.FRONTEND_URL;
  const flow = { begin: jest.fn(), callback: jest.fn(), pending: jest.fn() };
  const accounts = {
    find: jest.fn(),
    customer: jest.fn(),
    register: jest.fn(),
    login: jest.fn(),
  };
  const auth = { loginNewSession: jest.fn() };
  beforeAll(async () => {
    process.env.FRONTEND_URL = origin;
    const module = await Test.createTestingModule({
      controllers: [SocialController],
      providers: [
        { provide: SocialFlowService, useValue: flow },
        { provide: SocialAccountService, useValue: accounts },
        {
          provide: SocialProviderService,
          useValue: { available: () => ['yandex'] },
        },
        { provide: AuthService, useValue: auth },
        {
          provide: PublicVerificationRateLimitService,
          useValue: { consume: jest.fn() },
        },
        {
          provide: SecurityConfigService,
          useValue: {
            isFrontendOrigin: (value: string) => value === origin,
            getRefreshCookieSecure: () => false,
            getRefreshCookieSameSite: () => 'lax',
          },
        },
        ErrorsService,
      ],
    })
      .overrideGuard(LocalAuthGuard)
      .useValue({
        canActivate: () => {
          throw new UnauthorizedException();
        },
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => jest.resetAllMocks());
  afterAll(async () => {
    await app.close();
    if (oldFrontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = oldFrontend;
  });
  const client = () => request(app.getHttpServer() as Server);
  it('rejects missing or untrusted Origin before touching pending state', async () => {
    for (const path of [
      'yandex/start',
      'login',
      'registration/request',
      'link',
    ]) {
      await client()
        .post('/api/auth/social/' + path)
        .send({})
        .expect(403);
      await client()
        .post('/api/auth/social/' + path)
        .set('Origin', 'https://other.example')
        .send({})
        .expect(403);
    }
    expect(flow.begin).not.toHaveBeenCalled();
    expect(flow.pending).not.toHaveBeenCalled();
  });
  it('binds start to an HttpOnly cookie and does not expose the binding in JSON', async () => {
    flow.begin.mockResolvedValue({
      url: 'https://oauth.yandex.ru/authorize?state=test',
      binding: 'synthetic-binding',
    });
    const response = await client()
      .post('/api/auth/social/yandex/start')
      .set('Origin', origin)
      .send({})
      .expect(201);
    expect(response.body).toEqual({
      url: 'https://oauth.yandex.ru/authorize?state=test',
    });
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Lax');
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('redirects rejected callback to a fixed URL without reflecting code or provider errors', async () => {
    const response = await client()
      .get(
        '/api/auth/social/yandex/callback?error=secret-error&code=secret-code',
      )
      .expect(303);
    expect(response.headers.location).toBe(
      origin + '/auth/social?error=failed',
    );
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(flow.callback).not.toHaveBeenCalled();
  });
  it('uses only the server-side pending identity and returns refresh tokens only in a cookie', async () => {
    flow.pending.mockResolvedValue({
      provider: 'vk',
      subject: 'server-verified-id',
    });
    accounts.login.mockResolvedValue({ id: 7 });
    auth.loginNewSession.mockResolvedValue({
      access_token: 'access',
      access_token_expires: 2000000000,
      refresh_token: 'refresh',
      refresh_token_expires: 2000000000,
    });
    const response = await client()
      .post('/api/auth/social/login')
      .set('Origin', origin)
      .set('Cookie', 'social_pending=test')
      .send({ subject: 'attacker-id', role: 'admin' })
      .expect(201);
    expect(accounts.login).toHaveBeenCalledWith({
      provider: 'vk',
      subject: 'server-verified-id',
    });
    expect(response.body).toEqual({
      access_token: 'access',
      access_token_expires: 2000000000,
    });
    expect(response.headers['set-cookie'][0]).toContain(
      'refresh_token=refresh;',
    );
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
  });
  it('does not permit linking without normal password authentication', async () => {
    await client()
      .post('/api/auth/social/link')
      .set('Origin', origin)
      .send({ email: 'customer@example.test', password: 'wrong' })
      .expect(401);
    expect(flow.pending).not.toHaveBeenCalled();
  });
});
