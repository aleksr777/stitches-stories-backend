import { UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuthSession } from '../src/auth/entities/auth-session.entity';
import { AuthResponse, JwtTokens } from '../src/common/types/jwt-tokens.type';
import { TokenType } from '../src/common/types/token-type.type';
import { User } from '../src/users/entities/user.entity';
import {
  CODE,
  createCredentialFixture,
  NEW_PASSWORD,
  PASSWORD,
} from './helpers/credential-fixture';

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseTests = databaseUrl ? describe : describe.skip;

databaseTests('Credential changes with PostgreSQL sessions', () => {
  const schema = `credential_test_${randomUUID().replace(/-/g, '')}`;
  let adminDb: DataSource;
  let db: DataSource;
  let fixture: Awaited<ReturnType<typeof createCredentialFixture>>;
  let oldSessions: JwtTokens[];
  const response = {
    cookie: jest.fn<void, [string, string, unknown]>(),
    clearCookie: jest.fn(),
  };

  const currentRequest = (): Request =>
    ({
      user: fixture.user,
      authSessionId: fixture.auth.getSessionIdFromToken(
        oldSessions[0].access_token,
      ),
      ip: '127.0.0.1',
      socket: {},
      get: () => 'credential-test',
    }) as unknown as Request;

  const expectAccess = async (
    tokens: Pick<JwtTokens, 'access_token'>,
    valid: boolean,
  ) => {
    const result = fixture.auth.validateSession(
      fixture.user.id,
      fixture.auth.getSessionIdFromToken(tokens.access_token) ?? undefined,
      TokenType.ACCESS,
    );
    if (valid)
      await expect(result).resolves.toMatchObject({ revoked_at: null });
    else await expect(result).rejects.toBeInstanceOf(UnauthorizedException);
  };

  beforeAll(async () => {
    adminDb = await new DataSource({
      type: 'postgres',
      url: databaseUrl,
    }).initialize();
    await adminDb.query(`CREATE SCHEMA "${schema}"`);
    db = await new DataSource({
      type: 'postgres',
      url: databaseUrl,
      schema,
      entities: [User, AuthSession],
      synchronize: true,
    }).initialize();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    fixture = await createCredentialFixture(db);
    oldSessions = [];
    for (let i = 0; i < 3; i++)
      oldSessions.push(await fixture.auth.loginNewSession(fixture.user.id));
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (adminDb?.isInitialized) {
      await adminDb.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminDb.destroy();
    }
  });

  it('recovery creates one new usable session and invalidates all old access and refresh tokens', async () => {
    const body = (await fixture.authController.resetPassword(
      currentRequest(),
      {
        code: CODE,
        email: fixture.user.email!,
        new_password: NEW_PASSWORD,
      },
      response as unknown as Response,
    )) as AuthResponse;

    expect(body.access_token).toEqual(expect.any(String));
    const sessionId = fixture.auth.getSessionIdFromToken(body.access_token);
    const sessions = await fixture.auth.getSessions(fixture.user.id, sessionId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: sessionId,
      current: true,
      user_agent: 'credential-test',
    });
    await expectAccess(body, true);
    for (const old of oldSessions) {
      await expectAccess(old, false);
      await expect(
        fixture.auth.refreshJwtTokens(fixture.user.id, old.refresh_token),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    const refreshToken = response.cookie.mock.calls[0][1];
    await expect(
      fixture.auth.refreshJwtTokens(fixture.user.id, refreshToken),
    ).resolves.toHaveProperty('access_token');
    await expect(
      fixture.auth.validateUserByEmailAndPassword(
        fixture.user.email!,
        NEW_PASSWORD,
      ),
    ).resolves.toHaveProperty('id', fixture.user.id);
    await expect(
      fixture.auth.validateUserByEmailAndPassword(
        fixture.user.email!,
        PASSWORD,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(response.clearCookie).not.toHaveBeenCalled();
  });

  it.each(['wrong code', 'wrong email'])(
    'an invalid recovery (%s) leaves credentials and sessions unchanged',
    async (reason) => {
      await expect(
        fixture.authController.resetPassword(
          currentRequest(),
          {
            code: reason === 'wrong code' ? '654321' : CODE,
            email:
              reason === 'wrong email'
                ? 'someone-else@example.com'
                : fixture.user.email!,
            new_password: NEW_PASSWORD,
          },
          response as unknown as Response,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      for (const old of oldSessions) await expectAccess(old, true);
      await expect(
        fixture.auth.validateUserByEmailAndPassword(
          fixture.user.email!,
          PASSWORD,
        ),
      ).resolves.toHaveProperty('id', fixture.user.id);
      expect(response.cookie).not.toHaveBeenCalled();
    },
  );

  it('email change preserves the current session, revokes other sessions, and does not affect another user', async () => {
    const other = await fixture.users.save(
      fixture.users.create({
        email: `${randomUUID()}@example.com`,
        password: fixture.user.password,
      }),
    );
    const unrelated = await fixture.auth.loginNewSession(other.id);
    await fixture.usersController.confirmUpdateEmail(
      { code: CODE },
      currentRequest(),
    );

    await expectAccess(oldSessions[0], true);
    for (const old of oldSessions.slice(1)) {
      await expectAccess(old, false);
      await expect(
        fixture.auth.refreshJwtTokens(fixture.user.id, old.refresh_token),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(
      fixture.auth.refreshJwtTokens(
        fixture.user.id,
        oldSessions[0].refresh_token,
      ),
    ).resolves.toHaveProperty('access_token');
    await expect(
      fixture.auth.refreshJwtTokens(other.id, unrelated.refresh_token),
    ).resolves.toHaveProperty('access_token');
    await expect(
      fixture.usersController.getCurrentProfile(currentRequest()),
    ).resolves.toHaveProperty('email', fixture.newEmail);
    const sessions = await fixture.auth.getSessions(
      fixture.user.id,
      fixture.auth.getSessionIdFromToken(oldSessions[0].access_token),
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].current).toBe(true);
  });

  it('an invalid email code keeps the existing email and all sessions', async () => {
    await expect(
      fixture.usersController.confirmUpdateEmail(
        { code: '654321' },
        currentRequest(),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    for (const old of oldSessions) await expectAccess(old, true);
    await expect(
      fixture.usersController.getCurrentProfile(currentRequest()),
    ).resolves.toHaveProperty('email', fixture.user.email);
  });

  it.each(['change', 'reset'])(
    'authenticated password %s preserves only the current session',
    async (method) => {
      const dto = { code: CODE, new_password: NEW_PASSWORD };
      if (method === 'change')
        await fixture.usersController.changePasswordByToken(
          dto,
          currentRequest(),
        );
      else
        await fixture.usersController.confirmCurrentUserPasswordReset(
          dto,
          currentRequest(),
        );
      await expectAccess(oldSessions[0], true);
      for (const old of oldSessions.slice(1)) await expectAccess(old, false);
      await expect(
        fixture.auth.refreshJwtTokens(
          fixture.user.id,
          oldSessions[0].refresh_token,
        ),
      ).resolves.toHaveProperty('access_token');
    },
  );
});
