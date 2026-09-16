# nestjs-routing-authorization

NestJS backend template for routing, authentication, authorization, account management, persistent sessions, and administrator workflows.

Companion frontend: [react-routing-authorization](https://github.com/aleksr777/react-routing-authorization)

## Security model

The backend uses a server-side session model instead of relying on JWT validity alone:

- access JWTs are short-lived and returned to the frontend;
- refresh JWTs are stored only in an HttpOnly cookie on the client;
- every access/refresh token is bound to a persistent `AuthSession` through `sid`;
- only a SHA-256 hash of the current refresh token is stored in PostgreSQL;
- refresh tokens rotate under a pessimistic database lock;
- reuse of an old refresh token revokes the affected session;
- logout and remote session revocation take effect for access tokens because every protected request validates the server-side session;
- the access token is not maintained in a Redis blacklist;
- account owners can list and individually revoke their active sessions;
- administrators can inspect and revoke active sessions of managed users;
- a configurable maximum number of active sessions is enforced transactionally per user.

Authentication and authorization are enforced by backend guards. Frontend route guards are a UX layer, not the authorization boundary.

## Main protections

- bcrypt password hashing;
- minimum 12-character passwords for registration/change/reset flows;
- persistent server-side authentication sessions;
- atomic refresh-token rotation and replay detection;
- Redis-backed login, public-verification, global API, auth-route, and per-session throttling;
- one-time/latest-only verification codes with attempt limits and resend cooldowns;
- transactionally coupled password/email security-context changes and session revocation;
- structured request logging with `X-Request-Id`;
- persistent security-audit events with retention cleanup;
- PostgreSQL and Redis TLS options;
- Helmet security headers and configurable HSTS;
- strict production configuration validation;
- health/liveness and dependency-readiness endpoints;
- scheduled cleanup of stale sessions and old audit events.

Multi-factor authentication is intentionally not part of this base template. Add the MFA mechanism and recovery policy appropriate to each application separately.

## Requirements

- Node.js 22+
- PostgreSQL
- Redis
- SMTP provider for verification mail

## Local setup

Copy the example environment file and replace placeholders. `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` must be set before the first migration because the migration chain creates the initial administrator on a clean database.

```bash
cp .env.example .env
npm ci
npm run migration:run
npm run start:dev
```

The application uses `/api` as the global route prefix. The default example port is `5174`.

Do not commit `.env` or production secrets.

## Database migrations

Schema changes are managed through TypeORM migrations. The migration chain is self-contained and can initialize a clean PostgreSQL database, including the base `user` table. `DB_TYPEORM_SYNC=true` is rejected when `NODE_ENV=production`.

```bash
npm run migration:show
npm run migration:run
npm run migration:revert
```

`migration:revert` is intended for a controlled rollback and should not replace restoring a tested database backup when a migration has changed or removed production data.

## Production configuration

Start from `.env.example`. At minimum, production must use:

- `NODE_ENV=production`;
- independent random `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`, each at least 32 characters;
- `FRONTEND_URL` with HTTPS;
- `REFRESH_COOKIE_SECURE=true`;
- `DB_TYPEORM_SYNC=false`;
- an exact `TRUST_PROXY` configuration matching the real proxy chain, never a blanket `true`;
- PostgreSQL TLS and Redis TLS/authentication where required by the hosting environment.

For cross-site frontend/backend deployments, configure `REFRESH_COOKIE_SAME_SITE` deliberately. `SameSite=None` requires a secure cookie and HTTPS.

## Production deployment order

Use this order for deployments containing migrations:

1. Create and verify a PostgreSQL backup/snapshot.
2. Confirm that the backup can be restored according to the provider's documented procedure.
3. Deploy environment/configuration changes without exposing secrets in source control or logs.
4. Run `npm ci` and `npm run build` in the release environment.
5. Run `npm run migration:show` and review pending migrations.
6. Run `npm run migration:run` exactly once for the release.
7. Start/restart the application.
8. Verify `GET /api/health/live` and `GET /api/health/ready`.
9. Verify login, refresh, logout, and an authenticated request.

Do not enable automatic TypeORM synchronization as a migration substitute in production.

## Backup policy

The application cannot create provider-level database backups by itself. Configure backups in the PostgreSQL hosting layer.

A reasonable minimum operational policy is:

- automated daily backups;
- point-in-time recovery where the provider supports it;
- retention appropriate to the deployment's data-loss requirements;
- a manual snapshot immediately before schema migrations or other destructive maintenance;
- periodic restore tests to a separate database;
- documented ownership and recovery steps.

Redis contains short-lived coordination/rate-limit/verification state and should not be treated as the authoritative store for users or authentication sessions. PostgreSQL is authoritative for users, sessions, and security-audit records.

## Health endpoints

- `GET /api/health/live` — process liveness;
- `GET /api/health/ready` — readiness check for PostgreSQL and Redis.

Readiness returns an unavailable status when a required dependency cannot be reached. Health endpoints bypass the Redis API rate limiter so an unhealthy Redis instance does not hide health information.

## Sessions

Each login creates an `AuthSession` containing session metadata, refresh-token hash, expiry, revocation state, and last-use information.

Session creation is serialized for the same user with a database row lock so concurrent logins cannot bypass `SESSION_MAX_ACTIVE`. When the limit is exceeded, the oldest sessions are revoked before the new session is committed.

Email/password changes from account settings preserve the current session and revoke the user's other sessions. Public password recovery revokes all old sessions and returns a new access token plus an HttpOnly refresh cookie for automatic sign-in. Registration confirmation also returns authentication credentials. The frontend sends successful registration, recovery, and account changes to `/users/me`.

Authenticated users can inspect their own active sessions through `GET /api/auth/sessions` and revoke a session through `DELETE /api/auth/sessions/:sessionId`.

Administrators can inspect and manage sessions for users available through User management:

- `GET /api/admin/users/:id/sessions` — list the user's active sessions;
- `DELETE /api/admin/users/:id/sessions/:sessionId` — revoke one session;
- `DELETE /api/admin/users/:id/sessions` — revoke all active sessions for the user.

These administrator endpoints remain behind `JwtAuthGuard`, `RolesGuard`, and `Role.ADMIN`. Administrative session viewing and revocation are written to the security audit log.

Session activity is buffered through Redis and periodically persisted to PostgreSQL. If Redis activity lookup is unavailable, persisted timestamps remain the fallback for session-list responses.

Revoked and long-expired sessions are removed by scheduled retention cleanup.

## Verification codes

Six-digit codes are stored in Redis with TTLs and are protected by attempt counters. Relevant flows use an active-code key so only the latest issued code can be consumed. Consumption is atomic.

`VERIFICATION_CODE_RESEND_COOLDOWN` limits code re-issuance. Failed mail delivery releases the request reservation and invalidates the newly issued challenge where applicable, allowing a legitimate retry rather than leaving an unusable cooldown/code pair.

Public registration and password-reset requests are also protected by an IP-based verification request limit.

## Rate limiting and Redis availability

Authentication-sensitive rate limiting fails closed if Redis is unavailable. General API and per-session throttling fail open so an infrastructure problem in Redis does not unnecessarily take down ordinary authenticated API traffic.

Redis connection failures are logged and the client uses reconnection logic. Readiness still reports Redis as unavailable so orchestration/monitoring can detect the degraded state.

## Security audit logging

Security events are stored in PostgreSQL separately from ordinary request logs. Examples include session creation/revocation, refresh-token reuse, failed login, password/email changes, administrator user-management actions, and administrator session inspection/revocation.

Audit-write failure is logged but does not interrupt the authentication operation itself. Old audit records are removed according to `AUDIT_RETENTION_DAYS`.

Do not place passwords, JWTs, verification codes, cookie contents, or Authorization headers in audit `details` or application logs.

## CI

The backend workflow validates pushes to `develop`/`main` and pull requests targeting either branch. It runs:

```text
npm ci
npm audit --omit=dev
TypeScript unused-symbol check
ESLint
build
migrations against a clean PostgreSQL database
unit tests
e2e tests
```

A change should not be deployed when the current commit has a failing security/audit/migration/build/test check.

The credential/session integration suite uses a real PostgreSQL database and creates a uniquely named, temporary schema. CI sets `TEST_DATABASE_URL` and always runs this suite. To run it locally, point `TEST_DATABASE_URL` at a disposable PostgreSQL test database and run `npm run test:e2e -- --runInBand`. Without this variable, the database suite is skipped; the HTTP contract suite still runs. Mail delivery and short-lived verification-code storage are mocked in these tests, while credential updates, session persistence, revocation, and refresh-token validation use the real services and database.
