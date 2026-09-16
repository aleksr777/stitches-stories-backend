import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RedisService } from '../common/redis-service/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    const database = await this.checkDatabase();
    const redis = await this.redis.ping();

    if (!database || !redis) {
      throw new ServiceUnavailableException({
        status: 'degraded',
        database,
        redis,
      });
    }

    return { status: 'ok', database, redis };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
