import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Request } from 'express';
import { EnvService } from '../env-service/env.service';
import { ErrorsService } from '../errors-service/errors.service';
import { RedisService } from '../redis-service/redis.service';

const API_RATE_LIMIT_PREFIX = 'rate-limit:api:ip:';
const AUTH_RATE_LIMIT_PREFIX = 'rate-limit:auth:ip:';
const API_RATE_LIMIT_MESSAGE =
  'Too many API requests from this IP. Please try again later.';
const AUTH_RATE_LIMIT_MESSAGE =
  'Too many authentication requests from this IP. Please try again later.';

@Injectable()
export class ApiRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(ApiRateLimitGuard.name);
  private readonly apiMaxRequests: number;
  private readonly apiWindowSeconds: number;
  private readonly authMaxRequests: number;
  private readonly authWindowSeconds: number;

  constructor(
    private readonly redisService: RedisService,
    private readonly envService: EnvService,
    private readonly errorsService: ErrorsService,
  ) {
    this.apiMaxRequests = this.envService.get('API_IP_MAX_REQUESTS', 'number');
    this.apiWindowSeconds = this.envService.get(
      'API_RATE_LIMIT_WINDOW',
      'number',
    );
    this.authMaxRequests = this.envService.get(
      'AUTH_IP_MAX_REQUESTS',
      'number',
    );
    this.authWindowSeconds = this.envService.get(
      'AUTH_RATE_LIMIT_WINDOW',
      'number',
    );
  }

  private getIp(request: Request) {
    return request.ip || request.socket.remoteAddress || 'unknown';
  }

  private getPath(request: Request) {
    return request.originalUrl.split('?')[0];
  }

  private isAuthRequest(request: Request) {
    const path = this.getPath(request);
    return path === '/api/auth' || path.startsWith('/api/auth/');
  }

  private isHealthRequest(request: Request) {
    const path = this.getPath(request);
    return path === '/api/health/live' || path === '/api/health/ready';
  }

  private async consume(
    key: string,
    maxRequests: number,
    windowSeconds: number,
    message: string,
  ) {
    const requests = await this.redisService.incrWithExpire(key, windowSeconds);
    if (requests <= maxRequests) return;

    const ttl = await this.redisService.ttl(key);
    const retryAfter = typeof ttl === 'number' && ttl > 0 ? ttl : 1;
    this.errorsService.tooManyRequests(message, retryAfter);
  }

  private async consumeGeneralSafely(
    key: string,
    maxRequests: number,
    windowSeconds: number,
    message: string,
  ): Promise<void> {
    try {
      await this.consume(key, maxRequests, windowSeconds, message);
    } catch (err: unknown) {
      if (err instanceof HttpException && err.getStatus() === 429) throw err;
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `General API rate limiting unavailable: ${errorMessage}`,
      );
    }
  }

  private async consumeAuthentication(ip: string): Promise<void> {
    try {
      await this.consume(
        `${AUTH_RATE_LIMIT_PREFIX}${ip}`,
        this.authMaxRequests,
        this.authWindowSeconds,
        AUTH_RATE_LIMIT_MESSAGE,
      );
    } catch (err: unknown) {
      if (err instanceof HttpException && err.getStatus() === 429) throw err;
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Authentication rate limiting unavailable: ${errorMessage}`,
      );
      throw new ServiceUnavailableException(
        'Authentication is temporarily unavailable. Please try again later.',
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.method === 'OPTIONS' || this.isHealthRequest(request)) {
      return true;
    }

    const ip = this.getIp(request);
    await this.consumeGeneralSafely(
      `${API_RATE_LIMIT_PREFIX}${ip}`,
      this.apiMaxRequests,
      this.apiWindowSeconds,
      API_RATE_LIMIT_MESSAGE,
    );

    if (this.isAuthRequest(request)) {
      await this.consumeAuthentication(ip);
    }

    return true;
  }
}
