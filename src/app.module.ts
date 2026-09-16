import { ShopModule } from './shop/shop.module';
import { LegalModule } from './legal/legal.module';
import { shopEntities } from './shop/shop.entities';
import { LegalDocumentEntity, ConsentEvent } from './legal/legal.entities';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from './admin/admin.module';
import { SecurityAuditEvent } from './audit/security-audit-event.entity';
import { SecurityAuditModule } from './audit/security-audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthSession } from './auth/entities/auth-session.entity';
import { CoreModule } from './common/core.module';
import { EnvService } from './common/env-service/env.service';
import { SecurityConfigService } from './common/security/security-config.service';
import { HealthModule } from './health/health.module';
import { User } from './users/entities/user.entity';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [CoreModule],
      inject: [EnvService, SecurityConfigService],
      useFactory: (
        envService: EnvService,
        securityConfig: SecurityConfigService,
      ) => ({
        type: 'postgres',
        host: envService.get('DB_HOST'),
        port: envService.get('DB_PORT', 'number'),
        database: envService.get('DB_NAME'),
        username: envService.get('DB_USERNAME'),
        password: envService.get('DB_PASSWORD'),
        entities: [
          User,
          AuthSession,
          SecurityAuditEvent,
          ...shopEntities,
          LegalDocumentEntity,
          ConsentEvent,
        ],
        synchronize: envService.get('DB_TYPEORM_SYNC', 'boolean'),
        ssl: securityConfig.getDatabaseSsl()
          ? {
              rejectUnauthorized:
                securityConfig.getDatabaseSslRejectUnauthorized(),
            }
          : false,
      }),
    }),
    SecurityAuditModule,
    AuthModule,
    UsersModule,
    CoreModule,
    AdminModule,
    HealthModule,
    LegalModule,
    ShopModule,
  ],
})
export class AppModule {}
