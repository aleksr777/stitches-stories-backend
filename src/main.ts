import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { EnvService } from './common/env-service/env.service';
import { SecurityConfigService } from './common/security/security-config.service';
import { configureHttpSecurity } from './common/security/security-http';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const envService = app.get(EnvService);
  const securityConfig = app.get(SecurityConfigService);

  envService.validateVariables();
  securityConfig.validate();
  configureHttpSecurity(app, securityConfig);
  app.enableShutdownHooks();
  app.use(cookieParser());

  app.enableCors({
    origin: securityConfig.getFrontendOrigin(),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.setGlobalPrefix('api');
  const serverPort = envService.get('SERVER_PORT', 'number');
  await app.listen(serverPort);
  logger.log(`Application is running on port ${serverPort}.`);
}

bootstrap().catch((err: unknown) => {
  const message =
    err instanceof Error ? (err.stack ?? err.message) : String(err);
  logger.error(`Application failed to start: ${message}`);
  process.exit(1);
});
