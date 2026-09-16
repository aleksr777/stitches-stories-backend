import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptionsWithRequest } from 'passport-jwt';
import { Request } from 'express';
import { AuthService } from '../auth.service';
import { EnvService } from '../../common/env-service/env.service';
import { ErrorsService } from '../../common/errors-service/errors.service';
import { JwtPayload } from '../../common/types/jwt-tokens.type';
import { TokenType } from '../../common/types/token-type.type';

type RequestWithSafeCookies = Omit<Request, 'cookies'> & {
  cookies?: Record<string, unknown>;
};
type SessionRequest = Request & { authSessionId?: string };

const getRefreshTokenFromCookie = (req: Request): string | null => {
  const request = req as RequestWithSafeCookies;
  const token = request.cookies?.['refresh_token'];

  return typeof token === 'string' ? token : null;
};

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(
    envService: EnvService,
    private readonly authService: AuthService,
    private readonly errorsService: ErrorsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([getRefreshTokenFromCookie]),
      ignoreExpiration: false,
      secretOrKey: envService.get('JWT_REFRESH_SECRET'),
      algorithms: ['HS256'],
      passReqToCallback: true,
    } as StrategyOptionsWithRequest);
  }

  async validate(req: Request, payload: JwtPayload) {
    const refreshToken = getRefreshTokenFromCookie(req);
    const userId = +payload.sub;

    if (!refreshToken) {
      this.errorsService.tokenNotDefined(TokenType.REFRESH);
    }

    const user = await this.authService.validateUserById(userId);
    this.authService.isUserBlocked(user);
    await this.authService.validateSession(
      userId,
      payload.sid,
      TokenType.REFRESH,
    );
    if (typeof payload.sid === 'string') {
      (req as SessionRequest).authSessionId = payload.sid;
    }

    return user;
  }
}
