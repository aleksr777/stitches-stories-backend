import { randomUUID } from 'node:crypto';
import {
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  MoreThan,
  Repository,
} from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { SessionTokenService } from './session-token.service';
import { ActivityService } from '../activity/activity.service';
import { SecurityAuditService } from '../audit/security-audit.service';
import { HashService } from '../common/hash-service/hash.service';
import { ErrorsService } from '../common/errors-service/errors.service';
import { SecurityConfigService } from '../common/security/security-config.service';
import { User } from '../users/entities/user.entity';
import { AuthSession } from './entities/auth-session.entity';
import {
  ID,
  ROLE,
  EMAIL,
  IS_BLOCKED,
  USER_PROFILE_FIELDS,
  PASSWORD,
  BLOCKED_REASON,
} from '../common/constants/user-select-fields.constants';
import { TokenType } from '../common/types/token-type.type';
import { Role } from '../common/types/role.enum';
import { JwtTokens } from '../common/types/jwt-tokens.type';

type SessionContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(AuthSession)
    private readonly sessionsRepository: Repository<AuthSession>,
    private readonly dataSource: DataSource,
    private readonly sessionTokenService: SessionTokenService,
    private readonly activityService: ActivityService,
    private readonly hashService: HashService,
    private readonly errorsService: ErrorsService,
    private readonly securityConfig: SecurityConfigService,
    private readonly audit: SecurityAuditService,
  ) {}

  removeSensitiveInfo<T extends object, K extends keyof T>(
    source: T | T[],
    keysToRemove: readonly K[],
  ): Omit<T, K> | Omit<T, K>[] {
    const remove = (item: T): Omit<T, K> => {
      const result = { ...item } as Partial<T>;
      for (const key of keysToRemove) delete result[key];
      return result as Omit<T, K>;
    };
    return Array.isArray(source) ? source.map(remove) : remove(source);
  }

  isUserBlocked(user: User): void {
    if (user.is_blocked) this.errorsService.accountBlocked(user.blocked_reason);
  }

  async validateUserByEmailAndPassword(email: string, password: string) {
    let user: User;
    try {
      user = await this.usersRepository.findOneOrFail({
        where: { email: email.trim().toLowerCase() },
        select: [...USER_PROFILE_FIELDS, PASSWORD, IS_BLOCKED, BLOCKED_REASON],
      });
      const isPasswordValid = await this.hashService.compare(
        password,
        user.password,
      );
      this.errorsService.invalidEmailOrPassword(null, isPasswordValid);
      return user;
    } catch (err: unknown) {
      this.errorsService.invalidEmailOrPassword(err);
      this.errorsService.default(err);
    }
  }

  async verifyUserPassword(userId: number, password: string): Promise<void> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: [ID, PASSWORD],
    });
    if (!user || !(await this.hashService.compare(password, user.password))) {
      throw new UnauthorizedException('Invalid password.');
    }
  }

  async getAdministratorEmail() {
    try {
      const administrator = await this.usersRepository.findOneOrFail({
        where: { role: Role.ADMIN },
        select: [EMAIL],
      });
      return administrator.email;
    } catch (err: unknown) {
      this.errorsService.userNotFound(err, 'Administrator not found');
      this.errorsService.default(err);
    }
  }

  async validateUserById(id: number) {
    try {
      const user = await this.usersRepository.findOne({
        where: { id },
        select: [ID, ROLE, IS_BLOCKED, BLOCKED_REASON],
      });
      if (!user) this.errorsService.invalidToken(null, TokenType.ACCESS);
      return user;
    } catch (err: unknown) {
      if (err instanceof HttpException) throw err;
      this.errorsService.userNotFound(err);
      this.errorsService.default(err);
    }
  }

  private getRefreshExpiration(tokens: JwtTokens): Date {
    if (typeof tokens.refresh_token_expires !== 'number') {
      this.errorsService.invalidToken(null, TokenType.REFRESH);
    }
    return new Date(tokens.refresh_token_expires * 1000);
  }

  private async enforceActiveSessionLimit(
    manager: EntityManager,
    userId: number,
  ): Promise<number> {
    const active = await manager.find(AuthSession, {
      where: {
        user_id: userId,
        revoked_at: IsNull(),
        expires_at: MoreThan(new Date()),
      },
      select: ['id', 'created_at'],
      order: { created_at: 'DESC' },
    });
    const keepBeforeCreate = Math.max(
      this.securityConfig.getMaxActiveSessions() - 1,
      0,
    );
    const overflow = active
      .slice(keepBeforeCreate)
      .map((session) => session.id);
    if (overflow.length === 0) return 0;

    await manager.update(
      AuthSession,
      { user_id: userId, id: In(overflow) },
      { revoked_at: new Date(), revoked_reason: 'session_limit' },
    );
    return overflow.length;
  }

  private async createSession(
    userId: number,
    context: SessionContext = {},
  ): Promise<JwtTokens> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    let sessionId: string | null = null;
    let now: Date | null = null;
    let revokedByLimit = 0;
    try {
      await qr.manager.findOneOrFail(User, {
        where: { id: userId },
        select: [ID],
        lock: { mode: 'pessimistic_write' },
      });
      revokedByLimit = await this.enforceActiveSessionLimit(qr.manager, userId);

      sessionId = randomUUID();
      const tokens = this.sessionTokenService.generate(userId, sessionId);
      now = new Date();
      const session = qr.manager.create(AuthSession, {
        id: sessionId,
        user_id: userId,
        refresh_token_hash: this.hashService.hashToken(tokens.refresh_token),
        ip_address: context.ipAddress ?? null,
        user_agent: context.userAgent?.slice(0, 512) ?? null,
        last_used_at: now,
        expires_at: this.getRefreshExpiration(tokens),
        revoked_at: null,
        revoked_reason: null,
      });
      await qr.manager.save(AuthSession, session);
      await qr.commitTransaction();

      if (revokedByLimit > 0) {
        void this.audit.record({
          event: 'SESSION_LIMIT_REVOKED',
          userId,
          details: { count: revokedByLimit },
        });
      }
      void this.activityService
        .setSessionActivity(userId, sessionId, now)
        .catch(() => undefined);
      void this.audit.record({
        event: 'SESSION_CREATED',
        userId,
        sessionId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      return tokens;
    } catch (err: unknown) {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      if (err instanceof HttpException) throw err;
      this.errorsService.default(err);
    } finally {
      await qr.release();
    }
  }

  async login(userId: number, context: SessionContext = {}) {
    try {
      await this.revokeAllSessions(userId, 'security_context_changed');
      return await this.createSession(userId, context);
    } catch (err: unknown) {
      if (err instanceof HttpException) throw err;
      this.errorsService.default(err);
    }
  }

  async loginNewSession(userId: number, context: SessionContext = {}) {
    try {
      return await this.createSession(userId, context);
    } catch (err: unknown) {
      if (err instanceof HttpException) throw err;
      this.errorsService.default(err);
    }
  }

  getSessionIdFromToken(token: string | undefined | null): string | null {
    return this.sessionTokenService.getSessionId(token);
  }

  async validateSession(
    userId: number,
    sessionId: string | undefined,
    tokenType: TokenType,
  ): Promise<AuthSession> {
    if (!sessionId) this.errorsService.invalidToken(null, tokenType);

    const session = await this.sessionsRepository.findOne({
      where: { id: sessionId, user_id: userId },
    });
    if (
      !session ||
      session.revoked_at !== null ||
      session.expires_at.getTime() <= Date.now()
    ) {
      this.errorsService.invalidToken(null, tokenType);
    }
    return session;
  }

  async logout(userId: number, accessToken: string | undefined) {
    if (!accessToken) this.errorsService.tokenNotDefined(TokenType.ACCESS);
    try {
      const sessionId = this.getSessionIdFromToken(accessToken);
      if (!sessionId) this.errorsService.invalidToken(null, TokenType.ACCESS);
      await this.revokeSession(userId, sessionId, 'logout');
    } catch (err: unknown) {
      if (err instanceof UnauthorizedException) {
        this.errorsService.invalidToken(err, TokenType.ACCESS);
      }
      if (err instanceof HttpException) throw err;
      this.errorsService.default(err);
    }
  }

  async logoutAll(userId: number): Promise<void> {
    await this.revokeAllSessions(userId, 'logout_all');
  }

  async revokeAllSessions(
    userId: number,
    reason = 'revoked',
    manager?: EntityManager,
  ): Promise<void> {
    const now = new Date();
    if (manager) {
      await manager.update(
        AuthSession,
        { user_id: userId, revoked_at: IsNull() },
        { revoked_at: now, revoked_reason: reason },
      );
    } else {
      await this.sessionsRepository.update(
        { user_id: userId, revoked_at: IsNull() },
        { revoked_at: now, revoked_reason: reason },
      );
    }
    void this.audit.record({
      event: 'SESSIONS_REVOKED_ALL',
      userId,
      details: { reason },
    });
  }

  async revokeOtherSessions(
    userId: number,
    currentSessionId: string,
    reason = 'security_context_changed',
    manager?: EntityManager,
  ): Promise<void> {
    const queryBuilder = manager
      ? manager.createQueryBuilder()
      : this.sessionsRepository.createQueryBuilder();
    await queryBuilder
      .update(AuthSession)
      .set({ revoked_at: new Date(), revoked_reason: reason })
      .where('user_id = :userId', { userId })
      .andWhere('id <> :currentSessionId', { currentSessionId })
      .andWhere('revoked_at IS NULL')
      .execute();
    void this.audit.record({
      event: 'OTHER_SESSIONS_REVOKED',
      userId,
      sessionId: currentSessionId,
      details: { reason },
    });
  }

  async revokeSession(userId: number, sessionId: string, reason = 'revoked') {
    const result = await this.sessionsRepository.update(
      { id: sessionId, user_id: userId, revoked_at: IsNull() },
      { revoked_at: new Date(), revoked_reason: reason },
    );
    if ((result.affected ?? 0) > 0) {
      void this.audit.record({
        event: 'SESSION_REVOKED',
        userId,
        sessionId,
        details: { reason },
      });
    }
    return (result.affected ?? 0) > 0;
  }

  async getSessions(userId: number, currentSessionId: string | null) {
    const sessions = await this.sessionsRepository.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
    });
    const activeSessions = sessions.filter(
      (session) =>
        session.revoked_at === null &&
        session.expires_at.getTime() > Date.now(),
    );

    let liveActivity = new Map<string, Date>();
    try {
      liveActivity = await this.activityService.getSessionActivities(
        userId,
        activeSessions.map((session) => session.id),
      );
    } catch {
      // Database timestamps remain a safe fallback if Redis is unavailable.
    }

    return activeSessions.map((session) => {
      const pending = liveActivity.get(session.id);
      const lastUsedAt =
        pending && pending > session.last_used_at
          ? pending
          : session.last_used_at;
      return {
        id: session.id,
        ip_address: session.ip_address,
        user_agent: session.user_agent,
        created_at: session.created_at,
        last_used_at: lastUsedAt,
        expires_at: session.expires_at,
        current: session.id === currentSessionId,
      };
    });
  }

  async refreshJwtTokens(userId: number, currentRefreshToken: string | null) {
    if (!currentRefreshToken) {
      this.errorsService.tokenNotDefined(TokenType.REFRESH);
    }

    const sessionId = this.getSessionIdFromToken(currentRefreshToken);
    if (!sessionId) this.errorsService.invalidToken(null, TokenType.REFRESH);

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const session = await qr.manager.findOne(AuthSession, {
        where: { id: sessionId, user_id: userId },
        select: [
          'id',
          'user_id',
          'refresh_token_hash',
          'expires_at',
          'revoked_at',
        ],
        lock: { mode: 'pessimistic_write' },
      });

      if (
        !session ||
        session.revoked_at !== null ||
        session.expires_at.getTime() <= Date.now()
      ) {
        this.errorsService.invalidToken(null, TokenType.REFRESH);
      }

      const isCurrentRefreshToken = this.hashService.compareToken(
        currentRefreshToken,
        session.refresh_token_hash,
      );

      if (!isCurrentRefreshToken) {
        await qr.manager.update(
          AuthSession,
          { id: sessionId, user_id: userId },
          { revoked_at: new Date(), revoked_reason: 'refresh_reuse' },
        );
        await qr.commitTransaction();
        void this.audit.record({
          event: 'REFRESH_TOKEN_REUSE',
          success: false,
          userId,
          sessionId,
        });
        this.errorsService.invalidToken(null, TokenType.REFRESH);
      }

      const tokens = this.sessionTokenService.generate(userId, sessionId);
      await qr.manager.update(
        AuthSession,
        { id: sessionId, user_id: userId },
        {
          refresh_token_hash: this.hashService.hashToken(tokens.refresh_token),
          last_used_at: new Date(),
          expires_at: this.getRefreshExpiration(tokens),
        },
      );
      await qr.commitTransaction();
      return tokens;
    } catch (err: unknown) {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      if (err instanceof HttpException) throw err;
      this.errorsService.invalidToken(err, TokenType.REFRESH);
    } finally {
      await qr.release();
    }
  }
}
