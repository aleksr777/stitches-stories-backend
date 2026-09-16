import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Strategy } from 'passport-local';
import { SecurityAuditService } from '../../audit/security-audit.service';
import { AuthService } from '../auth.service';
import { LoginRateLimitService } from '../login-rate-limit.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly authService: AuthService,
    private readonly loginRateLimitService: LoginRateLimitService,
    private readonly audit: SecurityAuditService,
  ) {
    super({
      usernameField: 'email',
      passwordField: 'password',
      passReqToCallback: true,
    });
  }

  async validate(req: Request, email: string, password: string) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    await this.loginRateLimitService.assertAllowed(email, ip);

    try {
      const user = await this.authService.validateUserByEmailAndPassword(
        email,
        password,
      );
      await this.loginRateLimitService.clearEmailFailures(email);
      return user;
    } catch (err: unknown) {
      await this.loginRateLimitService.registerFailure(email, ip);
      void this.audit.record({
        event: 'LOGIN_FAILED',
        success: false,
        ipAddress: ip,
        userAgent: req.get('user-agent') ?? null,
      });
      throw err;
    }
  }
}
