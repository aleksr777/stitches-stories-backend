import { randomBytes, randomInt } from 'node:crypto';
import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ErrorsService } from '../common/errors-service/errors.service';
import { HashService } from '../common/hash-service/hash.service';
import { MailService } from '../common/mail-service/mail.service';
import { RedisService } from '../common/redis-service/redis.service';
import { Role } from '../common/types/role.enum';
import { User } from '../users/entities/user.entity';

const CODE_TTL = 300;
const RESEND_DELAY = 60;
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW = 900;

type PendingLogin = {
  userId: number;
  email: string;
  credentialStamp: string;
  codeHash: string;
};

@Injectable()
export class AdminLoginService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly redis: RedisService,
    private readonly hash: HashService,
    private readonly mail: MailService,
    private readonly errors: ErrorsService,
  ) {}

  private activeKey(id: number) {
    return `admin-login:active:${id}`;
  }

  private challengeKey(id: string) {
    return `admin-login:challenge:${id}`;
  }

  private attemptsKey(id: number) {
    return `admin-login:attempts:${id}`;
  }

  private invalid(): never {
    throw new UnauthorizedException(
      'Код подтверждения входа недействителен или истёк. Войдите заново.',
    );
  }

  private async assertAttemptsAvailable(userId: number) {
    const key = this.attemptsKey(userId);
    if (Number(await this.redis.get(key)) >= MAX_ATTEMPTS) {
      this.errors.tooManyRequests(
        'Слишком много попыток подтверждения. Повторите вход позже.',
        Math.max(await this.redis.ttl(key), 1),
        true,
      );
    }
  }

  private async pending(challengeId: string): Promise<PendingLogin> {
    const raw = await this.redis.get(this.challengeKey(challengeId));
    if (!raw) return this.invalid();
    const pending = JSON.parse(raw) as PendingLogin;
    if (
      (await this.redis.get(this.activeKey(pending.userId))) !== challengeId
    ) {
      return this.invalid();
    }
    return pending;
  }

  private async currentUser(pending: PendingLogin) {
    const user = await this.users.findOne({
      where: { id: pending.userId },
      select: ['id', 'email', 'password', 'role', 'is_blocked'],
    });
    if (
      !user ||
      user.role !== Role.ADMIN ||
      user.is_blocked ||
      user.email !== pending.email ||
      !this.hash.compareToken(user.password, pending.credentialStamp)
    ) {
      return this.invalid();
    }
    return user;
  }

  async request(user: User) {
    if (user.role !== Role.ADMIN || user.is_blocked || !user.email)
      return this.invalid();
    await this.assertAttemptsAvailable(user.id);

    const cooldownKey = `admin-login:cooldown:${user.id}`;
    const reserved = await this.redis.set(cooldownKey, '1', {
      NX: true,
      EX: RESEND_DELAY,
    });
    if (!reserved) {
      this.errors.tooManyRequests(
        'Подождите перед повторной отправкой кода.',
        Math.max(await this.redis.ttl(cooldownKey), 1),
      );
    }

    const challengeId = randomBytes(32).toString('hex');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const payload: PendingLogin = {
      userId: user.id,
      email: user.email,
      credentialStamp: this.hash.hashToken(user.password),
      codeHash: this.hash.hashToken(`${challengeId}:${code}`),
    };

    try {
      const previous = await this.redis.get(this.activeKey(user.id));
      await this.redis.set(
        this.challengeKey(challengeId),
        JSON.stringify(payload),
        { EX: CODE_TTL },
      );
      await this.redis.set(this.activeKey(user.id), challengeId, {
        EX: CODE_TTL,
      });
      if (previous) await this.redis.del(this.challengeKey(previous));

      const text =
        `Stitches & Stories\n\nПодтвердите вход в управление магазином кодом: ${code}. ` +
        `Код действует ${CODE_TTL / 60} минут.\n\n` +
        'Если вы не запрашивали вход, просто проигнорируйте это письмо.';
      const html = `
        <p style="font-weight: bold; font-size: 17px;">Stitches &amp; Stories</p>
        <p style="font-weight: bold; font-size: 17px;">Подтвердите вход в управление магазином кодом:</p>
        <p style="font-weight: bold; font-size: 30px;">${code}</p>
        <p style="font-weight: bold; font-size: 17px;">Код действует ${CODE_TTL / 60} минут.</p>
        <p style="font-weight: bold; font-size: 17px;">Если вы не запрашивали вход, просто проигнорируйте это письмо.</p>`;
      await this.mail.send(
        user.email,
        'Подтвердите вход владельца — Stitches & Stories',
        text,
        html,
      );
    } catch {
      await this.redis
        .consumeActiveToken(
          this.activeKey(user.id),
          challengeId,
          this.challengeKey(challengeId),
        )
        .catch(() => undefined);
      await this.redis.del(cooldownKey).catch(() => undefined);
      throw new ServiceUnavailableException(
        'Не удалось отправить код входа. Повторите попытку.',
      );
    }

    return {
      admin_confirmation_required: true as const,
      challenge_id: challengeId,
      message: 'Код для входа отправлен на вашу почту. Он действует 5 минут.',
      expires_in: CODE_TTL,
      retry_after: RESEND_DELAY,
      max_attempts: MAX_ATTEMPTS,
    };
  }

  async resend(challengeId: string) {
    const pending = await this.pending(challengeId);
    return this.request(await this.currentUser(pending));
  }

  async confirm(challengeId: string, code: string) {
    const pending = await this.pending(challengeId);
    await this.assertAttemptsAvailable(pending.userId);
    const attempts = await this.redis.incrWithExpire(
      this.attemptsKey(pending.userId),
      ATTEMPT_WINDOW,
    );
    if (attempts > MAX_ATTEMPTS) {
      await this.assertAttemptsAvailable(pending.userId);
    }
    if (!this.hash.compareToken(`${challengeId}:${code}`, pending.codeHash)) {
      throw new UnauthorizedException({
        message: 'Неверный код подтверждения входа.',
        attempts_remaining: Math.max(0, MAX_ATTEMPTS - attempts),
        ...(attempts >= MAX_ATTEMPTS
          ? {
              locked: true,
              retry_after: Math.max(
                await this.redis.ttl(this.attemptsKey(pending.userId)),
                1,
              ),
            }
          : {}),
      });
    }

    const consumed = await this.redis.consumeActiveToken(
      this.activeKey(pending.userId),
      challengeId,
      this.challengeKey(challengeId),
    );
    if (!consumed) return this.invalid();
    const user = await this.currentUser(pending);
    await this.redis.del(this.attemptsKey(user.id));
    return user;
  }
}
