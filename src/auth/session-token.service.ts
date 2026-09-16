import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EnvService } from '../common/env-service/env.service';
import { JwtPayload, JwtTokens } from '../common/types/jwt-tokens.type';

@Injectable()
export class SessionTokenService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessExpiresIn: string;
  private readonly refreshExpiresIn: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly envService: EnvService,
  ) {
    this.accessSecret = this.envService.get('JWT_ACCESS_SECRET');
    this.refreshSecret = this.envService.get('JWT_REFRESH_SECRET');
    this.accessExpiresIn = this.envService.get('JWT_ACCESS_EXPIRES_IN');
    this.refreshExpiresIn = this.envService.get('JWT_REFRESH_EXPIRES_IN');
  }

  generate(userId: number, sessionId: string): JwtTokens {
    const accessToken = this.jwtService.sign(
      { sub: userId, sid: sessionId },
      {
        secret: this.accessSecret,
        expiresIn: this.accessExpiresIn,
      },
    );
    const refreshToken = this.jwtService.sign(
      { sub: userId, sid: sessionId, jti: randomUUID() },
      {
        secret: this.refreshSecret,
        expiresIn: this.refreshExpiresIn,
      },
    );
    const decodedAccess = this.jwtService.decode<JwtPayload>(accessToken);
    const decodedRefresh = this.jwtService.decode<JwtPayload>(refreshToken);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      access_token_expires: decodedAccess?.exp ?? null,
      refresh_token_expires: decodedRefresh?.exp ?? null,
    };
  }

  getSessionId(token: string | undefined | null): string | null {
    if (!token) return null;
    const cleanedToken = token.startsWith('Bearer ')
      ? token.slice(7).trim()
      : token.trim();
    const payload = this.jwtService.decode<JwtPayload>(cleanedToken);
    return typeof payload?.sid === 'string' ? payload.sid : null;
  }
}
