import { Injectable } from '@nestjs/common';
import { EnvService } from '../env-service/env.service';
import { ErrorsService } from '../errors-service/errors.service';

type RefreshCookieSameSite = 'lax' | 'strict' | 'none';
type TrustProxySetting = boolean | number | string;

const MIN_SECRET_LENGTH = 32;
const DEFAULT_REDIS_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_ACTIVE_SESSIONS = 10;
const DEFAULT_SESSION_RETENTION_DAYS = 90;
const DEFAULT_AUDIT_RETENTION_DAYS = 180;

@Injectable()
export class SecurityConfigService {
  constructor(
    private readonly envService: EnvService,
    private readonly errorsService: ErrorsService,
  ) {}

  isProduction(): boolean {
    return (
      (this.envService.getOptional('NODE_ENV') ?? 'development') ===
      'production'
    );
  }

  getRefreshCookieSecure(): boolean {
    return this.envService.get('REFRESH_COOKIE_SECURE', 'boolean');
  }

  getRefreshCookieSameSite(): RefreshCookieSameSite {
    const value = this.envService
      .get('REFRESH_COOKIE_SAME_SITE')
      .trim()
      .toLowerCase();
    if (value === 'lax' || value === 'strict' || value === 'none') return value;
    this.errorsService.default(
      null,
      'Env var "REFRESH_COOKIE_SAME_SITE" must be one of: lax, strict, none.',
    );
  }

  getFrontendOrigin(): string {
    const frontendUrl = this.envService.get('FRONTEND_URL');
    try {
      return new URL(frontendUrl).origin;
    } catch {
      this.errorsService.default(
        null,
        'Env var "FRONTEND_URL" must be a valid absolute URL.',
      );
    }
  }

  getTrustProxy(): TrustProxySetting {
    const value = this.envService.get('TRUST_PROXY').trim();
    if (value === 'false') return false;
    if (value === 'true') {
      this.errorsService.default(
        null,
        'TRUST_PROXY=true is not allowed. Configure an exact proxy hop count, IP, subnet, or keep it false.',
      );
    }
    if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
    return value;
  }

  getDatabaseSsl(): boolean {
    return this.envService.getOptional('DB_SSL', 'boolean') ?? false;
  }

  getDatabaseSslRejectUnauthorized(): boolean {
    return (
      this.envService.getOptional('DB_SSL_REJECT_UNAUTHORIZED', 'boolean') ??
      true
    );
  }

  getRedisTls(): boolean {
    return this.envService.getOptional('REDIS_TLS', 'boolean') ?? false;
  }

  getRedisUsername(): string | undefined {
    return this.envService.getOptional('REDIS_USERNAME');
  }

  getRedisPassword(): string | undefined {
    return this.envService.getOptional('REDIS_PASSWORD');
  }

  getRedisConnectTimeoutMs(): number {
    return (
      this.envService.getOptional('REDIS_CONNECT_TIMEOUT_MS', 'number') ??
      DEFAULT_REDIS_CONNECT_TIMEOUT_MS
    );
  }

  getMaxActiveSessions(): number {
    return (
      this.envService.getOptional('SESSION_MAX_ACTIVE', 'number') ??
      DEFAULT_MAX_ACTIVE_SESSIONS
    );
  }

  getSessionRetentionDays(): number {
    return (
      this.envService.getOptional('SESSION_RETENTION_DAYS', 'number') ??
      DEFAULT_SESSION_RETENTION_DAYS
    );
  }

  getAuditRetentionDays(): number {
    return (
      this.envService.getOptional('AUDIT_RETENTION_DAYS', 'number') ??
      DEFAULT_AUDIT_RETENTION_DAYS
    );
  }

  isFrontendOrigin(origin: string | undefined): boolean {
    if (!origin) return false;
    try {
      return new URL(origin).origin === this.getFrontendOrigin();
    } catch {
      return false;
    }
  }

  private validatePositiveInteger(name: string, value: number): void {
    if (!Number.isInteger(value) || value <= 0) {
      this.errorsService.default(null, `${name} must be a positive integer.`);
    }
  }

  validate(): void {
    const secure = this.getRefreshCookieSecure();
    const sameSite = this.getRefreshCookieSameSite();
    const frontendOrigin = this.getFrontendOrigin();
    const accessSecret = this.envService.get('JWT_ACCESS_SECRET');
    const refreshSecret = this.envService.get('JWT_REFRESH_SECRET');

    this.getTrustProxy();
    this.validatePositiveInteger(
      'REDIS_CONNECT_TIMEOUT_MS',
      this.getRedisConnectTimeoutMs(),
    );
    this.validatePositiveInteger(
      'SESSION_MAX_ACTIVE',
      this.getMaxActiveSessions(),
    );
    this.validatePositiveInteger(
      'SESSION_RETENTION_DAYS',
      this.getSessionRetentionDays(),
    );
    this.validatePositiveInteger(
      'AUDIT_RETENTION_DAYS',
      this.getAuditRetentionDays(),
    );

    if (sameSite === 'none' && !secure) {
      this.errorsService.default(
        null,
        'REFRESH_COOKIE_SAME_SITE=none requires REFRESH_COOKIE_SECURE=true.',
      );
    }
    if (
      accessSecret.length < MIN_SECRET_LENGTH ||
      refreshSecret.length < MIN_SECRET_LENGTH
    ) {
      this.errorsService.default(
        null,
        `JWT secrets must be at least ${MIN_SECRET_LENGTH} characters long.`,
      );
    }
    if (accessSecret === refreshSecret) {
      this.errorsService.default(
        null,
        'JWT access and refresh secrets must be different.',
      );
    }

    if (this.isProduction()) {
      if (!frontendOrigin.startsWith('https://')) {
        this.errorsService.default(
          null,
          'FRONTEND_URL must use HTTPS in production.',
        );
      }
      if (!secure) {
        this.errorsService.default(
          null,
          'REFRESH_COOKIE_SECURE must be true in production.',
        );
      }
      if (this.envService.get('DB_TYPEORM_SYNC', 'boolean')) {
        this.errorsService.default(
          null,
          'DB_TYPEORM_SYNC=true is not allowed in production. Use migrations.',
        );
      }
    }
  }
}
