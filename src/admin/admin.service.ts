import { HttpException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  DataSource,
  EntityManager,
  IsNull,
  Not,
  Repository,
} from 'typeorm';
import { ActivityService } from '../activity/activity.service';
import { AuthService } from '../auth/auth.service';
import { AuthSession } from '../auth/entities/auth-session.entity';
import { HashService } from '../common/hash-service/hash.service';
import { MailService } from '../common/mail-service/mail.service';
import { ErrorsService } from '../common/errors-service/errors.service';
import { ErrMsg } from '../common/errors-service/error-messages.type';
import { User } from '../users/entities/user.entity';
import {
  ID,
  ROLE,
  EMAIL,
  PASSWORD,
  IS_BLOCKED,
  NICKNAME,
  ADMIN_FIELDS,
  USER_SECRET_FIELDS,
} from '../common/constants/user-select-fields.constants';
import { UserSearchableFieldsType } from '../common/types/search-users-fields.type';
import { Role } from '../common/types/role.enum';

@Injectable()
export class AdminService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly usersRepository: Repository<User>,
    private readonly authService: AuthService,
    private readonly hashService: HashService,
    private readonly errorsService: ErrorsService,
    private readonly mailService: MailService,
    private readonly activityService: ActivityService,
  ) {}

  private async verifyAdministratorPassword(
    manager: EntityManager,
    adminId: number,
    password: string,
  ): Promise<void> {
    const admin = await manager.findOneOrFail(User, {
      where: { id: adminId },
      select: [ID, ROLE, PASSWORD],
      lock: { mode: 'pessimistic_write' },
    });

    if (admin.role !== Role.ADMIN) {
      this.errorsService.forbidden(ErrMsg.INSUFFICIENT_ACCESS_RIGHTS);
    }

    const isPasswordValid = await this.hashService.compare(
      password,
      admin.password,
    );
    if (!isPasswordValid) {
      this.errorsService.badRequest(ErrMsg.CURRENT_PASSWORD_IS_INCORRECT);
    }
  }

  async getUsersByQuery(
    limit: number,
    offset: number,
    field?: UserSearchableFieldsType,
    search?: string,
  ) {
    try {
      if (limit <= 0 || offset < 0)
        this.errorsService.badRequest(ErrMsg.INVALID_PAGINATION_PARAMETERS);
      const qb = this.usersRepository
        .createQueryBuilder('user')
        .select(ADMIN_FIELDS.map((f) => `user.${f}`))
        .where('user.role != :adminRole', { adminRole: Role.ADMIN })
        .take(limit)
        .skip(offset)
        .orderBy('user.id', 'DESC');
      if (search?.trim()) {
        const q = `%${search}%`;
        if (field) qb.andWhere(`user.${field} ILIKE :q`, { q });
        else
          qb.andWhere(
            new Brackets((b) => {
              b.where('user.nickname ILIKE :q', { q })
                .orWhere('user.email ILIKE :q', { q })
                .orWhere('user.phone_number ILIKE :q', { q });
            }),
          );
      }
      const [users, total] = await qb.getManyAndCount();
      return {
        users: this.authService.removeSensitiveInfo(users, [
          ...USER_SECRET_FIELDS,
        ]),
        total,
      };
    } catch (err: unknown) {
      this.errorsService.default(err);
    }
  }

  async getUserById(userId: number) {
    try {
      const user = await this.usersRepository.findOneOrFail({
        where: { id: userId, role: Not(Role.ADMIN) },
        select: [...ADMIN_FIELDS],
      });
      return this.authService.removeSensitiveInfo(user, [
        ...USER_SECRET_FIELDS,
      ]);
    } catch (err: unknown) {
      this.errorsService.userNotFound(err);
      this.errorsService.default(err);
    }
  }

  async deleteUserById(
    adminId: number,
    userId: number,
    password: string,
  ): Promise<void> {
    if (userId === adminId) {
      this.errorsService.badRequest(ErrMsg.ADMINISTRATOR_CANNOT_BE_DELETED);
    }

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await this.verifyAdministratorPassword(qr.manager, adminId, password);

      const user = await qr.manager.findOneOrFail(User, {
        where: { id: userId },
        select: [ID, EMAIL, NICKNAME, ROLE],
        lock: { mode: 'pessimistic_write' },
      });
      if (user.role === Role.ADMIN) {
        this.errorsService.badRequest(ErrMsg.ADMINISTRATOR_CANNOT_BE_DELETED);
      }
      await qr.manager.delete(User, { id: userId });
      await qr.commitTransaction();
      void this.activityService
        .deleteUserActivities(userId)
        .catch(() => undefined);
      const subject = 'Account deleted by administrator';
      const text =
        `Hello, ${user.nickname}!\n\n` +
        `Your account has been permanently deleted by an administrator.\n\n`;
      const html =
        `<p>Hello, ${user.nickname}!</p>` +
        `<p>Your account has been permanently deleted by an administrator.</p>`;
      await this.mailService.send(user.email, subject, text, html);
    } catch (err: unknown) {
      if (qr.isTransactionActive) {
        await qr.rollbackTransaction();
      }
      if (err instanceof HttpException) {
        throw err;
      }
      this.errorsService.userNotFound(err);
      this.errorsService.default(err);
    } finally {
      await qr.release();
    }
  }

  async blockUserById(
    adminId: number,
    userId: number,
    blocked_reason: string,
    password: string,
  ): Promise<void> {
    if (userId === adminId) {
      this.errorsService.badRequest(ErrMsg.ADMINISTRATOR_CANNOT_BE_BLOCKED);
    }
    const reason = blocked_reason.trim();
    let email: string | null = null;
    let nickname: string | null = null;
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await this.verifyAdministratorPassword(qr.manager, adminId, password);

      const user = await qr.manager.findOneOrFail(User, {
        where: { id: userId },
        select: [ID, EMAIL, NICKNAME, ROLE, IS_BLOCKED],
        lock: { mode: 'pessimistic_write' },
      });
      if (user.role === Role.ADMIN) {
        this.errorsService.badRequest(ErrMsg.ADMINISTRATOR_CANNOT_BE_BLOCKED);
      }
      if (user.is_blocked) {
        this.errorsService.badRequest(ErrMsg.ACCOUNT_ALREADY_BLOCKED);
      }
      const blockedAt = new Date();
      await qr.manager.update(
        User,
        { id: userId },
        {
          is_blocked: true,
          blocked_at: blockedAt,
          blocked_by: adminId,
          blocked_reason: reason || null,
        },
      );
      await qr.manager.update(
        AuthSession,
        { user_id: userId, revoked_at: IsNull() },
        {
          revoked_at: blockedAt,
          revoked_reason: 'account_blocked',
        },
      );
      await qr.commitTransaction();
      email = user.email;
      nickname = user.nickname ?? null;
    } catch (err: unknown) {
      if (qr.isTransactionActive) {
        await qr.rollbackTransaction();
      }
      if (err instanceof HttpException) {
        throw err;
      }
      this.errorsService.userNotFound(err);
      this.errorsService.default(err);
    } finally {
      await qr.release();
    }
    void this.activityService
      .deleteUserActivities(userId)
      .catch(() => undefined);
    if (email) {
      const subject = 'Account has been blocked.';
      const greet = nickname ? `Hello, ${nickname}!` : 'Hello!';
      const text =
        `${greet}\n\nYour account has been blocked by an administrator.` +
        (reason ? `\nReason: ${reason}` : '');
      const html =
        `<p>${greet}</p><p>Your account has been blocked by an administrator.</p>` +
        (reason ? `<p>Reason: ${reason}</p>` : '');
      await this.mailService.send(email, subject, text, html);
    }
  }

  async unblockUserById(userId: number): Promise<void> {
    let email: string | null = null;
    let nickname: string | null = null;
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const user = await qr.manager.findOneOrFail(User, {
        where: { id: userId },
        select: [ID, EMAIL, NICKNAME, IS_BLOCKED],
        lock: { mode: 'pessimistic_write' },
      });
      if (!user.is_blocked) {
        this.errorsService.badRequest(ErrMsg.ACCOUNT_NOT_BLOCKED);
      }
      await qr.manager.update(
        User,
        { id: userId },
        {
          is_blocked: false,
          blocked_at: null,
          blocked_by: null,
          blocked_reason: null,
        },
      );
      await qr.commitTransaction();
      email = user.email;
      nickname = user.nickname ?? null;
    } catch (err: unknown) {
      if (qr.isTransactionActive) {
        await qr.rollbackTransaction();
      }
      if (err instanceof HttpException) {
        throw err;
      }
      this.errorsService.userNotFound(err);
      this.errorsService.default(err);
    } finally {
      await qr.release();
    }
    if (email) {
      const subject = 'Account has been unblocked';
      const greet = nickname ? `Hello, ${nickname}!` : 'Hello!';
      const text = `${greet}\n\nYour account has been unblocked by an administrator.`;
      const html = `<p>${greet}</p><p>Your account has been unblocked by an administrator.</p>`;
      await this.mailService.send(email, subject, text, html);
    }
  }
}
