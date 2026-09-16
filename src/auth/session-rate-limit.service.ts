import { HttpException, Injectable, Logger } from '@nestjs/common';
import { EnvService } from '../common/env-service/env.service';
import { ErrorsService } from '../common/errors-service/errors.service';
import { RedisService } from '../common/redis-service/redis.service';

const PREFIX = 'rate-limit:session:';
const DEFAULT_MAX_REQUESTS = 300;
const DEFAULT_WINDOW_SECONDS = 60;

@Injectable()
export class SessionRateLimitService {
  private readonly logger = new Logger(SessionRateLimitService.name);
  private readonly maxRequests: number;
  private readonly windowSeconds: number;

  constructor(
    private readonly redis: RedisService,
    private readonly env: EnvService,
    private readonly errors: ErrorsService,
  ) {
    this.maxRequests =
      this.env.getOptional('SESSION_API_MAX_REQUESTS', 'number') ??
      DEFAULT_MAX_REQUESTS;
    this.windowSeconds =
      this.env.getOptional('SESSION_API_RATE_LIMIT_WINDOW', 'number') ??
      DEFAULT_WINDOW_SECONDS;
  }

  async consume(sessionId: string): Promise<void> {
    try {
      const key = `${PREFIX}${sessionId}`;
      const count = await this.redis.incrWithExpire(key, this.windowSeconds);
      if (count <= this.maxRequests) return;

      const ttl = await this.redis.ttl(key);
      this.errors.tooManyRequests(
        'Too many requests from this session. Please try again later.',
        typeof ttl === 'number' && ttl > 0 ? ttl : 1,
      );
    } catch (err: unknown) {
      if (err instanceof HttpException && err.getStatus() === 429) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Session rate limiting unavailable: ${message}`);
    }
  }
}
