import { Injectable } from '@nestjs/common';
import { EnvService } from '../common/env-service/env.service';
import { ErrorsService } from '../common/errors-service/errors.service';
import { RedisService } from '../common/redis-service/redis.service';

const LOGIN_EMAIL_FAILURES_PREFIX = 'login:failures:email:';
const LOGIN_IP_FAILURES_PREFIX = 'login:failures:ip:';
const LOGIN_RATE_LIMIT_MESSAGE =
  'Too many failed login attempts. Please try again later.';

@Injectable()
export class LoginRateLimitService {
  private readonly emailMaxAttempts: number;
  private readonly ipMaxAttempts: number;
  private readonly windowSeconds: number;

  constructor(
    private readonly redisService: RedisService,
    private readonly envService: EnvService,
    private readonly errorsService: ErrorsService,
  ) {
    this.emailMaxAttempts = this.envService.get(
      'LOGIN_EMAIL_MAX_ATTEMPTS',
      'number',
    );
    this.ipMaxAttempts = this.envService.get('LOGIN_IP_MAX_ATTEMPTS', 'number');
    this.windowSeconds = this.envService.get(
      'LOGIN_RATE_LIMIT_WINDOW',
      'number',
    );
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private getEmailKey(email: string) {
    return `${LOGIN_EMAIL_FAILURES_PREFIX}${this.normalizeEmail(email)}`;
  }

  private getIpKey(ip: string) {
    return `${LOGIN_IP_FAILURES_PREFIX}${ip}`;
  }

  private async getAttempts(key: string) {
    const raw = await this.redisService.get(key);
    const attempts = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(attempts) ? attempts : 0;
  }

  private async getRetryAfter(keys: string[]) {
    const ttls = await Promise.all(
      keys.map((key) => this.redisService.ttl(key)),
    );
    const activeTtls = ttls.filter(
      (ttl): ttl is number => typeof ttl === 'number' && ttl > 0,
    );
    return activeTtls.length > 0 ? Math.max(...activeTtls) : 1;
  }

  private async rejectIfLimited(
    emailAttempts: number,
    ipAttempts: number,
    emailKey: string,
    ipKey: string,
  ) {
    const limitedKeys: string[] = [];
    if (emailAttempts >= this.emailMaxAttempts) limitedKeys.push(emailKey);
    if (ipAttempts >= this.ipMaxAttempts) limitedKeys.push(ipKey);
    if (limitedKeys.length === 0) return;

    const retryAfter = await this.getRetryAfter(limitedKeys);
    this.errorsService.tooManyRequests(LOGIN_RATE_LIMIT_MESSAGE, retryAfter);
  }

  async assertAllowed(email: string, ip: string) {
    const emailKey = this.getEmailKey(email);
    const ipKey = this.getIpKey(ip);
    const [emailAttempts, ipAttempts] = await Promise.all([
      this.getAttempts(emailKey),
      this.getAttempts(ipKey),
    ]);

    await this.rejectIfLimited(emailAttempts, ipAttempts, emailKey, ipKey);
  }

  async registerFailure(email: string, ip: string) {
    const emailKey = this.getEmailKey(email);
    const ipKey = this.getIpKey(ip);
    const [emailAttempts, ipAttempts] = await Promise.all([
      this.redisService.incrWithExpire(emailKey, this.windowSeconds),
      this.redisService.incrWithExpire(ipKey, this.windowSeconds),
    ]);

    await this.rejectIfLimited(emailAttempts, ipAttempts, emailKey, ipKey);
  }

  async clearEmailFailures(email: string) {
    await this.redisService.del(this.getEmailKey(email));
  }
}
