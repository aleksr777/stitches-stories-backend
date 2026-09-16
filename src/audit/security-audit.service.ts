import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { SecurityConfigService } from '../common/security/security-config.service';
import { SecurityAuditEvent } from './security-audit-event.entity';

type SecurityAuditInput = {
  event: string;
  success?: boolean;
  userId?: number | null;
  sessionId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown> | null;
};

@Injectable()
export class SecurityAuditService {
  private readonly logger = new Logger(SecurityAuditService.name);

  constructor(
    @InjectRepository(SecurityAuditEvent)
    private readonly repository: Repository<SecurityAuditEvent>,
    private readonly securityConfig: SecurityConfigService,
  ) {}

  async record(input: SecurityAuditInput): Promise<void> {
    const event = this.repository.create({
      event: input.event.slice(0, 64),
      success: input.success ?? true,
      user_id: input.userId ?? null,
      session_id: input.sessionId ?? null,
      ip_address: input.ipAddress?.slice(0, 45) ?? null,
      user_agent: input.userAgent?.slice(0, 512) ?? null,
      details: input.details ?? null,
    });

    try {
      await this.repository.save(event);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        JSON.stringify({
          event: 'SECURITY_AUDIT_WRITE_FAILED',
          originalEvent: input.event,
          message,
        }),
      );
    }
  }

  async cleanupExpired(): Promise<number> {
    const retentionMs =
      this.securityConfig.getAuditRetentionDays() * 24 * 60 * 60 * 1000;
    const result = await this.repository.delete({
      occurred_at: LessThan(new Date(Date.now() - retentionMs)),
    });
    return result.affected ?? 0;
  }
}
