import { DataSource, Repository } from 'typeorm';
import { ActivityService } from '../activity/activity.service';
import { AuthService } from '../auth/auth.service';
import { AuthSession } from '../auth/entities/auth-session.entity';
import { ErrorsService } from '../common/errors-service/errors.service';
import { HashService } from '../common/hash-service/hash.service';
import { MailService } from '../common/mail-service/mail.service';
import { Role } from '../common/types/role.enum';
import { User } from '../users/entities/user.entity';
import { AdminService } from './admin.service';

describe('administrator account actions', () => {
  let service: AdminService;
  let compare: jest.Mock;
  let manager: {
    findOneOrFail: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(() => {
    compare = jest.fn(() => true);
    manager = {
      findOneOrFail: jest.fn(
        (_entity: unknown, options: { where: { id: number } }) =>
          options.where.id === 1
            ? { id: 1, role: Role.ADMIN, password: 'hash' }
            : {
                id: 2,
                email: 'user@example.test',
                nickname: 'Покупатель',
                role: Role.USER,
                is_blocked: false,
              },
      ),
      update: jest.fn(),
      delete: jest.fn(),
    };
    const queryRunner = {
      manager,
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      isTransactionActive: true,
    };
    service = new AdminService(
      { createQueryRunner: () => queryRunner } as unknown as DataSource,
      {} as Repository<User>,
      {} as AuthService,
      { compare } as unknown as HashService,
      new ErrorsService(),
      { send: jest.fn() } as unknown as MailService,
      {
        deleteUserActivities: jest.fn(() => Promise.resolve()),
      } as unknown as ActivityService,
    );
  });

  it('blocks without requesting the administrator password and revokes sessions', async () => {
    await service.blockUserById(1, 2, ' Причина ');

    expect(compare).not.toHaveBeenCalled();
    expect(manager.update).toHaveBeenCalledWith(
      User,
      { id: 2 },
      expect.objectContaining({
        is_blocked: true,
        blocked_reason: 'Причина',
        blocked_by: 1,
      }),
    );
    expect(manager.update).toHaveBeenCalledWith(
      AuthSession,
      expect.objectContaining({ user_id: 2 }),
      expect.objectContaining({ revoked_reason: 'account_blocked' }),
    );
  });

  it('still requires the administrator password before deleting an account', async () => {
    compare.mockResolvedValue(false);
    await expect(
      service.deleteUserById(1, 2, 'incorrect'),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(manager.delete).not.toHaveBeenCalled();
  });
});
