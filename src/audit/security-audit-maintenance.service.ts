import { Injectable, Logger } from '@nestjs/common';
import { Cron as CronDecorator } from '@nestjs/schedule';
import { SecurityAuditService } from './security-audit.service';

const CronSafe: (expr: string) => MethodDecorator =
  CronDecorator as unknown as (expr: string) => MethodDecorator;

@Injectable()
export class SecurityAuditMaintenanceService {
  private readonly logger = new Logger(SecurityAuditMaintenanceService.name);

  constructor(private readonly audit: SecurityAuditService) {}

  @CronSafe('15 3 * * *')
  async cleanup(): Promise<void> {
    try {
      const deleted = await this.audit.cleanupExpired();
      if (deleted > 0) {
        this.logger.log(`Deleted ${deleted} expired security audit events.`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Security audit cleanup failed: ${message}`);
    }
  }
}
