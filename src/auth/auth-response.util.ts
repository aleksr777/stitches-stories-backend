import { CookieOptions, Response } from 'express';
import { SecurityConfigService } from '../common/security/security-config.service';

const getRefreshCookieOptions = (
  securityConfig: SecurityConfigService,
): CookieOptions => ({
  httpOnly: true,
  secure: securityConfig.getRefreshCookieSecure(),
  sameSite: securityConfig.getRefreshCookieSameSite(),
  priority: 'high',
  path: '/api/auth',
});

export const clearRefreshCookie = (
  res: Response,
  securityConfig: SecurityConfigService,
): void => {
  res.clearCookie('refresh_token', getRefreshCookieOptions(securityConfig));
};
