import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ActivityModule } from '../activity/activity.module';
import { ActivityInterceptor } from '../activity/activity.interceptor';
import { EnvService } from './env-service/env.service';
import { ErrorsService } from './errors-service/errors.service';
import { HashService } from './hash-service/hash.service';
import { RequestLoggingInterceptor } from './logging/request-logging.interceptor';
import { MailService } from './mail-service/mail.service';
import { ApiRateLimitGuard } from './rate-limit-service/api-rate-limit.guard';
import { RedisService } from './redis-service/redis.service';
import { SecurityConfigService } from './security/security-config.service';

@Global()
@Module({
  imports: [ConfigModule, ScheduleModule.forRoot(), ActivityModule],
  providers: [
    HashService,
    RedisService,
    ErrorsService,
    EnvService,
    MailService,
    SecurityConfigService,
    ApiRateLimitGuard,
    { provide: APP_GUARD, useExisting: ApiRateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ActivityInterceptor },
  ],
  exports: [
    HashService,
    RedisService,
    ErrorsService,
    EnvService,
    MailService,
    SecurityConfigService,
  ],
})
export class CoreModule {}
