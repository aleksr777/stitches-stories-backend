import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { SecurityConfigService } from './security-config.service';

const HSTS_MAX_AGE_SECONDS = 15_552_000;

export const configureHttpSecurity = (
  app: NestExpressApplication,
  securityConfig: SecurityConfigService,
): void => {
  app.set('trust proxy', securityConfig.getTrustProxy());

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
      strictTransportSecurity: securityConfig.getRefreshCookieSecure()
        ? {
            maxAge: HSTS_MAX_AGE_SECONDS,
            includeSubDomains: false,
            preload: false,
          }
        : false,
    }),
  );
};
