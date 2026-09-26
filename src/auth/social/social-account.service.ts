import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { User } from '../../users/entities/user.entity';
import { HashService } from '../../common/hash-service/hash.service';
import { Role } from '../../common/types/role.enum';
import { LegalService } from '../../legal/legal.service';
import { RegistrationDetails } from '../../legal/legal.types';
import { AuthService } from '../auth.service';
import {
  SocialIdentity,
  SocialIdentityRef,
  SocialPendingIdentity,
} from '../entities/social-identity.entity';

@Injectable()
export class SocialAccountService {
  constructor(
    private readonly db: DataSource,
    private readonly auth: AuthService,
    private readonly legal: LegalService,
    private readonly hash: HashService,
  ) {}
  async find({ provider, subject }: SocialIdentityRef) {
    return this.db
      .getRepository(SocialIdentity)
      .findOneBy({ provider, subject });
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
  async registerSocial(
    identity: SocialPendingIdentity,
    documents: RegistrationDetails['documents'],
  ) {
    this.legal.assertReferences(documents, ['pd-account', 'account-terms']);
    const password = await this.hash.hash(
      randomBytes(48).toString('base64url'),
    );
    const { provider, subject, profile } = identity;
    try {
      return await this.db.transaction(async (manager) => {
        if (await manager.findOneBy(SocialIdentity, { provider, subject }))
          throw new ConflictException(
            'Этот аккаунт сервиса уже подключён. Войдите в него.',
          );
        const user = await manager.save(
          User,
          manager.create(User, {
            email: null,
            contact_email: profile?.email ?? null,
            name: profile?.name ?? null,
            sex: profile?.sex ?? null,
            phone_number: profile?.phone ?? null,
            password,
            role: Role.USER,
          }),
        );
        await manager.save(
          SocialIdentity,
          manager.create(SocialIdentity, {
            provider,
            subject,
            userId: user.id,
          }),
        );
        await this.legal.record(
          manager,
          documents,
          ['pd-account', 'account-terms'],
          {
            userId: user.id,
            source: 'registration',
            verification: `${provider}-oauth`,
          },
        );
        return user;
      });
    } catch (err) {
      if (err instanceof QueryFailedError)
        throw new ConflictException(
          'Не удалось создать аккаунт. Начните вход через сервис заново.',
        );
      throw err;
    }
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
