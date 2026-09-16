import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SecurityAuditEvent } from './security-audit-event.entity';
import { SecurityAuditMaintenanceService } from './security-audit-maintenance.service';
import { SecurityAuditService } from './security-audit.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([SecurityAuditEvent])],
  providers: [SecurityAuditService, SecurityAuditMaintenanceService],
  exports: [SecurityAuditService],
})
export class SecurityAuditModule {}
