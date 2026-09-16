import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createClient, RedisClientType, type SetOptions } from 'redis';
import { EnvService } from '../env-service/env.service';
import { ErrorsService } from '../errors-service/errors.service';
import { SecurityConfigService } from '../security/security-config.service';

const INCR_WITH_EXPIRE_SCRIPT = `
local value = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return value
`;

const CONSUME_ACTIVE_TOKEN_SCRIPT = `
local active = redis.call('GET', KEYS[1])
if active ~= ARGV[1] then
  return false
end
local payload = redis.call('GET', KEYS[2])
if not payload then
  return false
end
redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
return payload
`;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: RedisClientType;
  private isShuttingDown = false;

  constructor(
    envService: EnvService,
    securityConfig: SecurityConfigService,
    private readonly errorsService: ErrorsService,
  ) {
    const host = envService.get('REDIS_HOST');
    const port = envService.get('REDIS_PORT', 'number');
    const username = securityConfig.getRedisUsername();
    const password = securityConfig.getRedisPassword();
    const protocol = securityConfig.getRedisTls() ? 'rediss' : 'redis';
    const credentials = password
      ? `${username ? encodeURIComponent(username) : ''}:${encodeURIComponent(password)}@`
      : '';

    this.client = createClient({
      url: `${protocol}://${credentials}${host}:${port}`,
      socket: {
        connectTimeout: securityConfig.getRedisConnectTimeoutMs(),
        reconnectStrategy: (retries) => Math.min(100 * 2 ** retries, 3_000),
      },
    });
  }

  async onModuleInit(): Promise<void> {
    this.client.on('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Redis connection error: ${message}`);
    });
    this.client.on('reconnecting', () => {
      this.logger.warn('Redis reconnecting.');
    });
    await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.isShuttingDown || !this.client.isOpen) return;
    this.isShuttingDown = true;
    try {
      await this.client.quit();
      this.logger.log('Redis connection closed gracefully.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Redis shutdown error: ${message}`);
    }
  }

  getClient(): RedisClientType {
    return this.client;
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async set(
    key: string,
    value: string,
    options?: SetOptions,
  ): Promise<string | null> {
    try {
      return await this.client.set(key, value, options);
    } catch (err) {
      this.errorsService.default(err, 'Redis error (set).');
    }
  }

  async get(key: string) {
    try {
      return await this.client.get(key);
    } catch (err) {
      this.errorsService.default(err, 'Redis error (get).');
    }
  }

  async consumeActiveToken(
    activeKey: string,
    expectedCode: string,
    tokenKey: string,
  ): Promise<string | null> {
    try {
      const result = await this.client.eval(CONSUME_ACTIVE_TOKEN_SCRIPT, {
        keys: [activeKey, tokenKey],
        arguments: [expectedCode],
      });
      return typeof result === 'string' ? result : null;
    } catch (err) {
      this.errorsService.default(err, 'Redis error (consumeActiveToken).');
    }
  }

  async del(key: string) {
    try {
      return await this.client.del(key);
    } catch (err) {
      this.errorsService.default(err, 'Redis error (del).');
    }
  }

  async incr(key: string) {
    try {
      return await this.client.incr(key);
    } catch (err) {
      this.errorsService.default(err, 'Redis error (incr).');
    }
  }

  async incrWithExpire(key: string, seconds: number): Promise<number> {
    try {
      const result = await this.client.eval(INCR_WITH_EXPIRE_SCRIPT, {
        keys: [key],
        arguments: [seconds.toString()],
      });
      if (typeof result !== 'number') {
        throw new Error('Unexpected Redis script result.');
      }
      return result;
    } catch (err) {
      this.errorsService.default(err, 'Redis error (incrWithExpire).');
    }
  }

  async expire(key: string, seconds: number) {
    try {
      return await this.client.expire(key, seconds);
    } catch (err) {
      this.errorsService.default(err, 'Redis error (expire).');
    }
  }

  async ttl(key: string) {
    try {
      return await this.client.ttl(key);
    } catch (err) {
      this.errorsService.default(err, 'Redis error (ttl).');
    }
  }
}
