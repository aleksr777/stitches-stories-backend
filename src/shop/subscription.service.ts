import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomBytes } from 'node:crypto';
import { DataSource, EntityManager, LessThan } from 'typeorm';
import { LegalService, digest } from '../legal/legal.service';
import { AuthService } from '../auth/auth.service';
import { MailService } from '../common/mail-service/mail.service';
import { EnvService } from '../common/env-service/env.service';
import { HashService } from '../common/hash-service/hash.service';
import { User } from '../users/entities/user.entity';
import { Role } from '../common/types/role.enum';
import { NewsletterDto } from './shop.dto';
import { Favorite, Subscription } from './shop.entities';
const ids = ['pd-marketing', 'ads-email'];
const neutral = {
  message: 'Если адресу требуется подтверждение, на него отправлено письмо.',
};
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);
  constructor(
    private readonly db: DataSource,
    private readonly legal: LegalService,
    private readonly mail: MailService,
    private readonly env: EnvService,
    private readonly hash: HashService,
    private readonly auth: AuthService,
  ) {}
  async request(dto: NewsletterDto) {
    this.legal.assertReferences(dto.documents, ids);
    const token = randomBytes(32).toString('hex');
    const shouldSend = await this.db.transaction(async (m) => {
      await m
        .createQueryBuilder()
        .insert()
        .into(Subscription)
        .values({ email: dto.email, documents: dto.documents, active: false })
        .orIgnore()
        .execute();
      const row = await m.findOneOrFail(Subscription, {
        where: { email: dto.email },
        lock: { mode: 'pessimistic_write' },
      });
      if (row.active && row.activeUntil && row.activeUntil > new Date())
        return false;
      if (row.tokenHash && Date.now() - row.updatedAt.getTime() < 60000)
        return false;
      row.tokenHash = digest(token);
      row.tokenExpiresAt = new Date(Date.now() + 86400000);
      row.documents = dto.documents;
      await m.save(row);
      return true;
    });
    if (shouldSend) {
      const link =
        this.env.get('FRONTEND_URL') + '/newsletter/confirm#token=' + token;
      try {
        await this.mail.send(
          dto.email,
          'Подтверждение подписки — Stitches & Stories',
          'Подтвердите подписку в течение 24 часов: ' +
            link +
            ' Если вы не запрашивали подписку, проигнорируйте письмо.',
        );
      } catch (e) {
        await this.db.getRepository(Subscription).delete({
          email: dto.email,
          tokenHash: digest(token),
          active: false,
        });
        throw e;
      }
    }
    return neutral;
  }
  async confirm(token: string) {
    const unsubscribeToken = randomBytes(32).toString('hex');
    const email = await this.db.transaction(async (m) => {
      const row = await m.findOne(Subscription, {
        where: { tokenHash: digest(token) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row || !row.tokenExpiresAt || row.tokenExpiresAt < new Date())
        throw new BadRequestException(
          'Ссылка недействительна или уже использована.',
        );
      const user = await m.findOne(User, {
        where: { email: row.email },
        select: ['id'],
      });
      await this.legal.record(m, row.documents, ids, {
        userId: user?.id,
        subscriptionId: row.id,
        source: 'newsletter',
        verification: 'email-one-time-token',
      });
      row.userId = user?.id ?? null;
      row.active = true;
      row.activeUntil = new Date(Date.now() + 365 * 86400000);
      row.tokenHash = null;
      row.tokenExpiresAt = null;
      row.unsubscribeHash = digest(unsubscribeToken);
      await m.save(row);
      return row.email;
    });
    await this.mail
      .send(
        email,
        'Подписка подтверждена — Stitches & Stories',
        'Вы подписались на новости. Отписаться: ' +
          this.env.get('FRONTEND_URL') +
          '/newsletter/unsubscribe#token=' +
          unsubscribeToken,
      )
      .catch(() =>
        this.logger.warn(
          'Subscription confirmation email failed; unsubscribe link remains available on confirmation screen.',
        ),
      );
    return { confirmed: true, unsubscribeToken };
  }
  private async remove(
    m: EntityManager,
    row: Subscription,
    userId: number | null,
  ) {
    await this.legal.withdraw(m, userId, ids, row.id);
    await m.delete(Subscription, { id: row.id });
  }
  async unsubscribe(token: string) {
    await this.db.transaction(async (m) => {
      const row = await m.findOne(Subscription, {
        where: { unsubscribeHash: digest(token) },
        lock: { mode: 'pessimistic_write' },
      });
      if (row) await this.remove(m, row, null);
    });
    return { unsubscribed: true };
  }
  async status(userId: number) {
    const user = await this.db
      .getRepository(User)
      .findOneOrFail({ where: { id: userId }, select: ['id', 'email'] });
    const row = await this.db
      .getRepository(Subscription)
      .findOneBy({ email: user.email });
    return {
      marketing: !!(
        row?.active &&
        row.activeUntil &&
        row.activeUntil > new Date()
      ),
      activeUntil: row?.activeUntil ?? null,
    };
  }
  async withdraw(userId: number, purpose: string, password?: string) {
    return this.db.transaction(async (m) => {
      const user = await m.findOneOrFail(User, {
        where: { id: userId },
        select: ['id', 'email', 'role', 'password'],
        lock: { mode: 'pessimistic_write' },
      });
      if (purpose === 'marketing') {
        const row = await m.findOne(Subscription, {
          where: { email: user.email },
          lock: { mode: 'pessimistic_write' },
        });
        if (row) await this.remove(m, row, userId);
        return { accountClosed: false };
      }
      if (user.role === Role.ADMIN)
        throw new ConflictException(
          'Кабинет администратора закрывается после передачи управления.',
        );
      if (!password || !(await this.hash.compare(password, user.password))) {
        throw new BadRequestException('Неверный текущий пароль.');
      }
      await this.legal.withdraw(m, userId, ['pd-account']);
      await m.delete(Favorite, { userId });
      await m.update(Subscription, { userId }, { userId: null });
      await this.auth.revokeAllSessions(userId, 'account_deleted', m);
      await m.delete(User, { id: userId });
      return { accountClosed: true };
    });
  }
  @Cron('0 * * * *') async expire() {
    await this.db
      .getRepository(Subscription)
      .createQueryBuilder()
      .delete()
      .where(
        '"active" = false AND "unsubscribeHash" IS NULL AND "tokenExpiresAt" < NOW()',
      )
      .execute();
    await this.db
      .getRepository(Subscription)
      .update(
        { active: true, activeUntil: LessThan(new Date()) },
        { active: false },
      );
  }
}
