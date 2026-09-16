import { Injectable, Logger } from '@nestjs/common';
import { Cron as CronDecorator } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SecurityConfigService } from '../common/security/security-config.service';
import { AuthSession } from './entities/auth-session.entity';

const CronSafe: (expr: string) => MethodDecorator =
  CronDecorator as unknown as (expr: string) => MethodDecorator;

@Injectable()
export class SessionMaintenanceService {
  private readonly logger = new Logger(SessionMaintenanceService.name);

  constructor(
    @InjectRepository(AuthSession)
    private readonly sessions: Repository<AuthSession>,
    private readonly securityConfig: SecurityConfigService,
  ) {}

  @CronSafe('0 3 * * *')
  async cleanup(): Promise<void> {
    const retentionMs =
      this.securityConfig.getSessionRetentionDays() * 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - retentionMs);

    try {
      const result = await this.sessions
        .createQueryBuilder()
        .delete()
        .from(AuthSession)
        .where('(revoked_at IS NOT NULL AND revoked_at < :cutoff)', { cutoff })
        .orWhere('expires_at < :cutoff', { cutoff })
        .execute();

      if ((result.affected ?? 0) > 0) {
        this.logger.log(
          `Deleted ${result.affected} stale authentication sessions.`,
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Session cleanup failed: ${message}`);
    }
  }
}
