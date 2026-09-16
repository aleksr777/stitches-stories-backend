import {
  ExecutionContext,
  HttpException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Request } from 'express';
import { EnvService } from '../env-service/env.service';
import { ErrorsService } from '../errors-service/errors.service';
import { RedisService } from '../redis-service/redis.service';
import { ApiRateLimitGuard } from './api-rate-limit.guard';

const createContext = (path: string): ExecutionContext => {
  const request = {
    method: 'POST',
    originalUrl: path,
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as Request;

  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
};

describe('ApiRateLimitGuard', () => {
  const incrWithExpire = jest.fn();
  const ttl = jest.fn();
  const redis = { incrWithExpire, ttl } as unknown as RedisService;
  const env = {
    get: jest.fn((key: string) => {
      const values: Record<string, number> = {
        API_IP_MAX_REQUESTS: 100,
        API_RATE_LIMIT_WINDOW: 60,
        AUTH_IP_MAX_REQUESTS: 10,
        AUTH_RATE_LIMIT_WINDOW: 60,
      };
      return values[key];
    }),
  } as unknown as EnvService;
  const errors = new ErrorsService();
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('fails open for general API throttling when Redis is unavailable', async () => {
    incrWithExpire.mockRejectedValueOnce(new Error('Redis unavailable'));
    const guard = new ApiRateLimitGuard(redis, env, errors);

    await expect(
      guard.canActivate(createContext('/api/users/me')),
    ).resolves.toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('fails closed for authentication throttling when Redis is unavailable', async () => {
    incrWithExpire
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('Redis unavailable'));
    const guard = new ApiRateLimitGuard(redis, env, errors);

    await expect(
      guard.canActivate(createContext('/api/auth/login')),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('preserves authentication 429 responses', async () => {
    incrWithExpire.mockResolvedValueOnce(1).mockResolvedValueOnce(11);
    ttl.mockResolvedValueOnce(30);
    const guard = new ApiRateLimitGuard(redis, env, errors);

    try {
      await guard.canActivate(createContext('/api/auth/login'));
      throw new Error('Expected rate limit exception');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
    }
  });

  it('bypasses rate limiting for health endpoints', async () => {
    const guard = new ApiRateLimitGuard(redis, env, errors);

    await expect(
      guard.canActivate(createContext('/api/health/ready')),
    ).resolves.toBe(true);
    expect(incrWithExpire).not.toHaveBeenCalled();
  });
});
