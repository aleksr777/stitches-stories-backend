import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { User } from '../../users/entities/user.entity';
import { Role } from '../../common/types/role.enum';
import { RegistrationDetails } from '../../legal/legal.types';
import { AuthService } from '../auth.service';
import { RegistrationService } from '../registration.service';
import {
  SocialIdentity,
  SocialIdentityRef,
} from '../entities/social-identity.entity';

@Injectable()
export class SocialAccountService {
  constructor(
    private readonly db: DataSource,
    private readonly auth: AuthService,
    private readonly registration: RegistrationService,
  ) {}
  async find(identity: SocialIdentityRef) {
    return this.db.getRepository(SocialIdentity).findOneBy(identity);
  }
  async customer(userId: number) {
    const user = await this.auth.validateUserById(userId);
    this.auth.isUserBlocked(user);
    if (user.role !== Role.USER)
      throw new ForbiddenException(
        'Для входа владельца используйте пароль и код из письма.',
      );
    return user;
  }
  async register(
    identity: SocialIdentityRef,
    email: string,
    details: RegistrationDetails,
  ) {
    if (await this.find(identity))
      throw new ConflictException(
        'Этот аккаунт сервиса уже подключён. Начните вход заново.',
      );
    return this.registration.request(
      email,
      randomBytes(48).toString('base64url'),
      details,
      identity,
    );
  }
  async login(identity: SocialIdentityRef) {
    const link = await this.find(identity);
    if (!link)
      throw new UnauthorizedException(
        'Завершите регистрацию или привяжите аккаунт.',
      );
    return this.customer(link.userId);
  }
  async link(identity: SocialIdentityRef, user: User) {
    await this.customer(user.id);
    await this.db
      .transaction(async (manager) => {
        const current = await manager.findOneOrFail(User, {
          where: { id: user.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (current.is_blocked || current.role !== Role.USER)
          throw new ForbiddenException();
        const existing = await manager.findOneBy(SocialIdentity, identity);
        if (existing?.userId === user.id) return;
        if (
          existing ||
          (await manager.findOneBy(SocialIdentity, {
            userId: user.id,
            provider: identity.provider,
          }))
        )
          throw new ConflictException('Этот сервис уже привязан к аккаунту.');
        await manager.save(
          SocialIdentity,
          manager.create(SocialIdentity, { ...identity, userId: user.id }),
        );
      })
      .catch((err: unknown) => {
        if (err instanceof QueryFailedError)
          throw new ConflictException(
            'Не удалось привязать сервис. Начните вход заново.',
          );
        throw err;
      });
    return user;
  }
}
