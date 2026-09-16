import { Injectable } from '@nestjs/common';
import { EnvService } from '../common/env-service/env.service';
import { ErrorsService } from '../common/errors-service/errors.service';
import { RedisService } from '../common/redis-service/redis.service';

const PUBLIC_VERIFICATION_IP_PREFIX = 'verification:requests:ip:';
const PUBLIC_VERIFICATION_RATE_LIMIT_MESSAGE =
  'Too many verification code requests from this IP. Please try again later.';

@Injectable()
export class PublicVerificationRateLimitService {
  private readonly maxRequests: number;
  private readonly windowSeconds: number;

  constructor(
    private readonly redisService: RedisService,
    private readonly envService: EnvService,
    private readonly errorsService: ErrorsService,
  ) {
    this.maxRequests = this.envService.get(
      'PUBLIC_VERIFICATION_IP_MAX_REQUESTS',
      'number',
    );
    this.windowSeconds = this.envService.get(
      'PUBLIC_VERIFICATION_IP_RATE_LIMIT_WINDOW',
      'number',
    );
  }

  async consume(ip: string) {
    const key = `${PUBLIC_VERIFICATION_IP_PREFIX}${ip}`;
    const requests = await this.redisService.incrWithExpire(
      key,
      this.windowSeconds,
    );

    if (requests <= this.maxRequests) return;

    const ttl = await this.redisService.ttl(key);
    const retryAfter = typeof ttl === 'number' && ttl > 0 ? ttl : 1;
    this.errorsService.tooManyRequests(
      PUBLIC_VERIFICATION_RATE_LIMIT_MESSAGE,
      retryAfter,
    );
  }
}
