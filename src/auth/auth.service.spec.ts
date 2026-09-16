import { UnauthorizedException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ActivityService } from '../activity/activity.service';
import { SecurityAuditService } from '../audit/security-audit.service';
import { ErrorsService } from '../common/errors-service/errors.service';
import { HashService } from '../common/hash-service/hash.service';
import { SecurityConfigService } from '../common/security/security-config.service';
import { JwtTokens } from '../common/types/jwt-tokens.type';
import { User } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import { AuthSession } from './entities/auth-session.entity';
import { SessionTokenService } from './session-token.service';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

const createTokens = (refreshToken: string): JwtTokens => ({
  access_token: 'access-token',
  refresh_token: refreshToken,
  access_token_expires: 1_900_000_000,
  refresh_token_expires: 1_900_000_100,
});

describe('AuthService persistent sessions', () => {
  const hashService = new HashService();
  const errorsService = new ErrorsService();

  const createService = (
    storedRefreshTokenHash: string,
    nextToken: string,
    activeSessions: AuthSession[] = [],
  ) => {
    const managerFindOne = jest.fn().mockResolvedValue({
      id: SESSION_ID,
      user_id: 7,
      refresh_token_hash: storedRefreshTokenHash,
      expires_at: new Date('2030-01-01T00:00:00.000Z'),
      revoked_at: null,
    });
    const managerFindOneOrFail = jest.fn().mockResolvedValue({ id: 7 });
    const managerFind = jest.fn().mockResolvedValue(activeSessions);
    const managerUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    const managerCreate = jest.fn(
      (_entity: typeof AuthSession, value: Partial<AuthSession>) =>
        value as AuthSession,
    );
    const managerSave = jest.fn(
      (_entity: typeof AuthSession, value: AuthSession) =>
        Promise.resolve(value),
    );
    const queryRunner = {
      isTransactionActive: false,
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn(function (this: {
        isTransactionActive: boolean;
      }) {
        this.isTransactionActive = true;
        return Promise.resolve();
      }),
      commitTransaction: jest.fn(function (this: {
        isTransactionActive: boolean;
      }) {
        this.isTransactionActive = false;
        return Promise.resolve();
      }),
      rollbackTransaction: jest.fn(function (this: {
        isTransactionActive: boolean;
      }) {
        this.isTransactionActive = false;
        return Promise.resolve();
      }),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {
        findOne: managerFindOne,
        findOneOrFail: managerFindOneOrFail,
        find: managerFind,
        update: managerUpdate,
        create: managerCreate,
        save: managerSave,
      },
    };

    const dataSource = {
      createQueryRunner: jest.fn(() => queryRunner),
    } as unknown as DataSource;
    const usersRepository = {} as Repository<User>;
    const sessionsRepository = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
    } as unknown as Repository<AuthSession>;
    const sessionTokenService = {
      generate: jest.fn(() => createTokens(nextToken)),
      getSessionId: jest.fn(() => SESSION_ID),
    } as unknown as SessionTokenService;
    const activityService = {
      setSessionActivity: jest.fn().mockResolvedValue(undefined),
      getSessionActivities: jest.fn().mockResolvedValue(new Map()),
    } as unknown as ActivityService;
    const securityConfig = {
      getMaxActiveSessions: jest.fn(() => 10),
    } as unknown as SecurityConfigService;
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as SecurityAuditService;

    const service = new AuthService(
      usersRepository,
      sessionsRepository,
      dataSource,
      sessionTokenService,
      activityService,
      hashService,
      errorsService,
      securityConfig,
      audit,
    );

    return {
      service,
      queryRunner,
      sessionsRepository,
      activityService,
      managerFindOneOrFail,
      managerFind,
      managerUpdate,
      managerSave,
    };
  };

  it('rotates a valid refresh token inside the same session', async () => {
    const currentToken = 'current-refresh-token';
    const nextToken = 'next-refresh-token';
    const { service, queryRunner } = createService(
      hashService.hashToken(currentToken),
      nextToken,
    );

    const result = await service.refreshJwtTokens(7, currentToken);

    expect(result?.refresh_token).toBe(nextToken);
    expect(queryRunner.manager.update).toHaveBeenCalledWith(
      AuthSession,
      { id: SESSION_ID, user_id: 7 },
      expect.objectContaining({
        refresh_token_hash: hashService.hashToken(nextToken),
      }),
    );
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('revokes only the affected session when an old refresh token is replayed', async () => {
    const { service, queryRunner } = createService(
      hashService.hashToken('new-current-token'),
      'unused-next-token',
    );

    await expect(
      service.refreshJwtTokens(7, 'old-replayed-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(queryRunner.manager.update).toHaveBeenCalledWith(
      AuthSession,
      { id: SESSION_ID, user_id: 7 },
      expect.objectContaining({
        revoked_reason: 'refresh_reuse',
      }),
    );
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('serializes session-limit enforcement with a per-user database lock', async () => {
    const activeSessions = Array.from({ length: 10 }, (_, index) => ({
      id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      created_at: new Date(Date.now() - index * 1_000),
    })) as AuthSession[];
    const {
      service,
      queryRunner,
      managerFindOneOrFail,
      managerFind,
      managerUpdate,
      managerSave,
    } = createService(
      hashService.hashToken('current-refresh-token'),
      'new-session-refresh-token',
      activeSessions,
    );

    await expect(
      service.loginNewSession(7, {
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      }),
    ).resolves.toEqual(createTokens('new-session-refresh-token'));

    expect(managerFindOneOrFail).toHaveBeenCalledWith(
      User,
      expect.objectContaining({
        where: { id: 7 },
        lock: { mode: 'pessimistic_write' },
      }),
    );
    expect(managerFind).toHaveBeenCalledWith(
      AuthSession,
      expect.objectContaining({
        order: { created_at: 'DESC' },
      }),
    );
    expect(managerUpdate).toHaveBeenCalledWith(
      AuthSession,
      expect.objectContaining({ user_id: 7 }),
      expect.objectContaining({ revoked_reason: 'session_limit' }),
    );
    expect(managerSave).toHaveBeenCalledWith(
      AuthSession,
      expect.objectContaining({ user_id: 7, revoked_at: null }),
    );
    expect(managerFindOneOrFail.mock.invocationCallOrder[0]).toBeLessThan(
      managerFind.mock.invocationCallOrder[0],
    );
    expect(managerFind.mock.invocationCallOrder[0]).toBeLessThan(
      managerSave.mock.invocationCallOrder[0],
    );
    expect(managerSave.mock.invocationCallOrder[0]).toBeLessThan(
      queryRunner.commitTransaction.mock.invocationCallOrder[0],
    );
  });

  it('uses newer pending activity when listing active sessions', async () => {
    const { service, sessionsRepository, activityService } = createService(
      hashService.hashToken('current-refresh-token'),
      'next-refresh-token',
    );
    const persisted = new Date('2026-09-14T08:00:00.000Z');
    const live = new Date('2026-09-14T08:01:00.000Z');

    (sessionsRepository.find as jest.Mock).mockResolvedValue([
      {
        id: SESSION_ID,
        user_id: 7,
        ip_address: '127.0.0.1',
        user_agent: 'test-agent',
        created_at: new Date('2026-09-14T07:00:00.000Z'),
        last_used_at: persisted,
        expires_at: new Date('2030-01-01T00:00:00.000Z'),
        revoked_at: null,
      } as AuthSession,
    ]);
    (activityService.getSessionActivities as jest.Mock).mockResolvedValue(
      new Map([[SESSION_ID, live]]),
    );

    const sessions = await service.getSessions(7, SESSION_ID);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].last_used_at).toEqual(live);
    expect(sessions[0].current).toBe(true);
  });
});
