# Security configuration

## HTTP headers

The backend applies Helmet to API responses. Because this service returns JSON rather than HTML, Content Security Policy and document-oriented cross-origin policies are disabled here; CSP should be configured by the frontend that serves HTML.

When `REFRESH_COOKIE_SECURE=true`, the backend also sends HSTS with a 180-day max age. HSTS subdomain inheritance and preload are intentionally disabled to avoid applying policy to unrelated hosts.

## Refresh cookie

Local development defaults:

```env
REFRESH_COOKIE_SECURE=false
REFRESH_COOKIE_SAME_SITE='lax'
```

For a production deployment over HTTPS, use:

```env
REFRESH_COOKIE_SECURE=true
```

If the frontend and API are cross-site, also use:

```env
REFRESH_COOKIE_SAME_SITE='none'
```

`SameSite=None` is rejected at startup unless `Secure=true`.

The refresh cookie is HttpOnly, scoped to `/api/auth`, and uses high cookie priority. The raw refresh token is not exposed to frontend JavaScript.

## Persistent authentication sessions

Every login creates a persistent server-side authentication session. Access and refresh JWTs contain a `sid` claim that identifies that session; a valid JWT is not sufficient by itself if the corresponding server-side session is revoked or expired.

Only a SHA-256 hash of the current refresh token is stored in the session row. Refresh rotation is performed while holding a pessimistic database lock on that session. If an older refresh token is replayed, only the affected session/token family is revoked with the `refresh_reuse` reason, so unrelated devices remain signed in.

Normal login can create multiple device sessions. An authenticated email or password change (including password reset from account settings) preserves the session performing the change and revokes the user's other sessions in the same database transaction as the credential update. The current refresh cookie remains valid.

Public password recovery revokes all old sessions in the password-update transaction. After successful verification, the recovery endpoint creates a new session, sets its HttpOnly refresh cookie, and returns an access token so the frontend can continue directly to the profile. Blocked accounts cannot use recovery to sign in. Registration confirmation likewise returns authentication credentials for immediate access to the profile.

Authenticated session-management endpoints are:

- `GET /api/auth/sessions` — list the current user's active sessions;
- `DELETE /api/auth/sessions/:sessionId` — revoke one of the current user's sessions;
- `POST /api/auth/logout` — revoke the current session;
- `POST /api/auth/logout-all` — revoke all sessions for the current user.

Session responses expose only session metadata such as IP address, user agent and timestamps. Refresh-token hashes are never selected for these responses.

The migration that introduces the session table invalidates legacy refresh-token hashes. Access and refresh JWTs issued before this migration do not contain `sid` and are therefore rejected after deployment. Existing users must sign in again once after the migration. In production, run the database migration before serving traffic with the new application version.

## Refresh Origin protection

`POST /api/auth/refresh-tokens` authenticates with an HttpOnly cookie, so it additionally requires an `Origin` header matching the origin derived from `FRONTEND_URL`.

Requests with a missing, malformed, or different Origin are rejected with HTTP 403 before refresh-token validation or rotation runs.

This protection is intentionally applied to the cookie-authenticated refresh endpoint. Endpoints authenticated by the `Authorization` header do not rely on browser cookies for authentication and therefore do not use this Origin guard.

## Reverse proxies and client IP addresses

IP-based login and API rate limits use Express `req.ip`. The application therefore configures Express `trust proxy` from `TRUST_PROXY`.

Local/default configuration:

```env
TRUST_PROXY='false'
```

Behind a reverse proxy, configure the exact trusted topology, for example a fixed hop count:

```env
TRUST_PROXY='1'
```

or a trusted proxy address/subnet supported by Express proxy settings.

`TRUST_PROXY=true` is deliberately rejected because trusting arbitrary forwarded client IP values allows attackers to spoof `X-Forwarded-For` and undermine IP-based rate limiting. A hop-count configuration is safe only when the application cannot be reached through a shorter untrusted network path; trusted proxy IP/subnet configuration is preferable for more complex production networks.

## Deployment requirements

Production should terminate HTTPS before requests reach browser clients, use `REFRESH_COOKIE_SECURE=true`, and keep PostgreSQL and Redis off the public network. Configure `FRONTEND_URL` to the exact browser origin allowed to call the API.
