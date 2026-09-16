import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Injectable } from '@nestjs/common';
import { EnvService } from '../../common/env-service/env.service';
import { JwtPayload } from '../../common/types/jwt-tokens.type';
import { TokenType } from '../../common/types/token-type.type';
import { AuthService } from '../auth.service';
import { SessionRateLimitService } from '../session-rate-limit.service';
import { ErrorsService } from '../../common/errors-service/errors.service';

type SessionRequest = Request & { authSessionId?: string };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    envService: EnvService,
    private readonly authService: AuthService,
    private readonly sessionRateLimit: SessionRateLimitService,
    private readonly errorsService: ErrorsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: envService.get('JWT_ACCESS_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtPayload) {
    if (!req.headers.authorization) {
      this.errorsService.tokenNotDefined(TokenType.ACCESS);
    }

    const user = await this.authService.validateUserById(+payload.sub);
    if (!user) return user;

    this.authService.isUserBlocked(user);
    await this.authService.validateSession(
      +payload.sub,
      payload.sid,
      TokenType.ACCESS,
    );

    if (typeof payload.sid === 'string') {
      (req as SessionRequest).authSessionId = payload.sid;
      await this.sessionRateLimit.consume(payload.sid);
    }

    return user;
  }
}
