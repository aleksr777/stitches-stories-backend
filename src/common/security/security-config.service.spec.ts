import { InternalServerErrorException } from '@nestjs/common';
import { EnvService } from '../env-service/env.service';
import { ErrorsService } from '../errors-service/errors.service';
import { SecurityConfigService } from './security-config.service';

type TestEnv = Record<string, string>;

const REQUIRED_DEFAULTS: TestEnv = {
  JWT_ACCESS_SECRET: 'access-secret-that-is-at-least-32-characters-long',
  JWT_REFRESH_SECRET: 'refresh-secret-that-is-at-least-32-characters-long',
  DB_TYPEORM_SYNC: 'false',
};

const parseValue = (
  value: string,
  type: 'string' | 'number' | 'boolean',
): string | number | boolean => {
  if (type === 'boolean') return value === 'true';
  if (type === 'number') return Number(value);
  return value;
};

const createService = (values: TestEnv) => {
  const env = { ...REQUIRED_DEFAULTS, ...values };
  const envService = {
    get: jest.fn(
      (
        key: string,
        type: 'string' | 'number' | 'boolean' = 'string',
      ): string | number | boolean => {
        const value = env[key];
        if (value === undefined) throw new Error(`Missing test env: ${key}`);
        return parseValue(value, type);
      },
    ),
    getOptional: jest.fn(
      (
        key: string,
        type: 'string' | 'number' | 'boolean' = 'string',
      ): string | number | boolean | undefined => {
        const value = env[key];
        return value === undefined ? undefined : parseValue(value, type);
      },
    ),
  } as unknown as EnvService;

  return new SecurityConfigService(envService, new ErrorsService());
};

describe('SecurityConfigService', () => {
  it('accepts local development security settings', () => {
    const service = createService({
      FRONTEND_URL: 'http://localhost:5173/app',
      REFRESH_COOKIE_SECURE: 'false',
      REFRESH_COOKIE_SAME_SITE: 'lax',
      TRUST_PROXY: 'false',
    });

    expect(() => service.validate()).not.toThrow();
    expect(service.getRefreshCookieSecure()).toBe(false);
    expect(service.getRefreshCookieSameSite()).toBe('lax');
    expect(service.getFrontendOrigin()).toBe('http://localhost:5173');
    expect(service.getTrustProxy()).toBe(false);
    expect(service.isFrontendOrigin('http://localhost:5173')).toBe(true);
  });

  it('accepts cross-site secure cookies behind an exact proxy hop count', () => {
    const service = createService({
      FRONTEND_URL: 'https://app.example.com',
      REFRESH_COOKIE_SECURE: 'true',
      REFRESH_COOKIE_SAME_SITE: 'none',
      TRUST_PROXY: '1',
    });

    expect(() => service.validate()).not.toThrow();
    expect(service.getRefreshCookieSecure()).toBe(true);
    expect(service.getRefreshCookieSameSite()).toBe('none');
    expect(service.getTrustProxy()).toBe(1);
  });

  it('rejects SameSite=None without Secure cookies', () => {
    const service = createService({
      FRONTEND_URL: 'https://app.example.com',
      REFRESH_COOKIE_SECURE: 'false',
      REFRESH_COOKIE_SAME_SITE: 'none',
      TRUST_PROXY: 'false',
    });

    expect(() => service.validate()).toThrow(InternalServerErrorException);
  });

  it('rejects trusting arbitrary forwarded client IP values', () => {
    const service = createService({
      FRONTEND_URL: 'https://app.example.com',
      REFRESH_COOKIE_SECURE: 'true',
      REFRESH_COOKIE_SAME_SITE: 'lax',
      TRUST_PROXY: 'true',
    });

    expect(() => service.validate()).toThrow(InternalServerErrorException);
  });

  it('rejects unsafe production database synchronization', () => {
    const service = createService({
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://app.example.com',
      REFRESH_COOKIE_SECURE: 'true',
      REFRESH_COOKIE_SAME_SITE: 'lax',
      TRUST_PROXY: '1',
      DB_TYPEORM_SYNC: 'true',
      MFA_ENCRYPTION_KEY: 'mfa-encryption-key-that-is-at-least-32-characters',
    });

    expect(() => service.validate()).toThrow(InternalServerErrorException);
  });
});
