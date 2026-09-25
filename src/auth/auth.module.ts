import { LegalModule } from '../legal/legal.module';
import { SocialController } from './social/social.controller';
import { SocialProviderService } from './social/social-provider.service';
import { SocialFlowService } from './social/social-flow.service';
import { SocialAccountService } from './social/social-account.service';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { CoreModule } from '../common/core.module';
import { EnvService } from '../common/env-service/env.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { User } from '../users/entities/user.entity';
import { AuthController } from './auth.controller';
import { AdminLoginService } from './admin-login.service';
import { AuthService } from './auth.service';
import { AuthSession } from './entities/auth-session.entity';
import { RefreshOriginGuard } from './guards/refresh-origin.guard';
import { LoginRateLimitService } from './login-rate-limit.service';
import { PasswordResetService } from './password-reset.service';
import { PublicVerificationRateLimitService } from './public-verification-rate-limit.service';
import { RegistrationService } from './registration.service';
import { SessionMaintenanceService } from './session-maintenance.service';
import { SessionRateLimitService } from './session-rate-limit.service';
import { SessionTokenService } from './session-token.service';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    LegalModule,
    TypeOrmModule.forFeature([User, AuthSession]),
    PassportModule,
    ConfigModule,
    ActivityModule,
    JwtModule.registerAsync({
      imports: [LegalModule, CoreModule],
      inject: [EnvService],
      useFactory: (envService: EnvService) => ({
        secret: envService.get('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: envService.get('JWT_ACCESS_EXPIRES_IN'),
        },
      }),
    }),
  ],
  providers: [
    SocialProviderService,
    SocialFlowService,
    SocialAccountService,
    AuthService,
    AdminLoginService,
    RegistrationService,
    PasswordResetService,
    LoginRateLimitService,
    PublicVerificationRateLimitService,
    SessionRateLimitService,
    SessionMaintenanceService,
    SessionTokenService,
    RefreshOriginGuard,
    RolesGuard,
    LocalStrategy,
    JwtStrategy,
    JwtRefreshStrategy,
    TokensService,
  ],
  controllers: [AuthController, SocialController],
  exports: [AuthService, TokensService],
})
export class AuthModule {}
