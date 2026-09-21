import { HttpException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ErrorsService } from '../common/errors-service/errors.service';
import { HashService } from '../common/hash-service/hash.service';
import { MailService } from '../common/mail-service/mail.service';
import { RedisService } from '../common/redis-service/redis.service';
import { Role } from '../common/types/role.enum';
import { User } from '../users/entities/user.entity';
import { AdminLoginService } from './admin-login.service';

describe('administrator email confirmation', () => {
  let service: AdminLoginService;
  let user: User;
  let now: number;
  let values: Map<string, { value: string; expires: number }>;
  let sentCode: string;
  let send: jest.Mock;
  let findOne: jest.Mock;

  const read = (key: string) => {
    const entry = values.get(key);
    if (!entry || entry.expires <= now) {
      values.delete(key);
      return null;
    }
    return entry.value;
  };

  beforeEach(() => {
    now = 0;
    values = new Map();
    user = {
      id: 1,
      role: Role.ADMIN,
      email: 'admin@example.test',
      password: 'hashed-credential',
      is_blocked: false,
    } as User;
    findOne = jest.fn(() => user);
    send = jest.fn((_email: string, _subject: string, text: string) => {
      sentCode = text.match(/\b\d{6}\b/)![0];
    });
    const redis = {
      get: jest.fn((key: string) => read(key)),
      set: jest.fn(
        (key: string, value: string, options: { EX: number; NX?: boolean }) => {
          if (options.NX && read(key)) return null;
          values.set(key, { value, expires: now + options.EX });
          return 'OK';
        },
      ),
      del: jest.fn((key: string) =>
        Promise.resolve(Number(values.delete(key))),
      ),
      ttl: jest.fn((key: string) =>
        read(key) ? values.get(key)!.expires - now : -2,
      ),
      incrWithExpire: jest.fn((key: string, seconds: number) => {
        const entry = read(key);
        const count = Number(entry ?? 0) + 1;
        values.set(key, {
          value: String(count),
          expires: entry ? values.get(key)!.expires : now + seconds,
        });
        return count;
      }),
      consumeActiveToken: jest.fn(
        (active: string, expected: string, token: string) => {
          const payload = read(token);
          if (read(active) !== expected || !payload)
            return Promise.resolve(null);
          values.delete(active);
          values.delete(token);
          return Promise.resolve(payload);
        },
      ),
    };
    service = new AdminLoginService(
      { findOne } as unknown as Repository<User>,
      redis as unknown as RedisService,
      new HashService(),
      { send } as unknown as MailService,
      new ErrorsService(),
    );
  });

  const wrongCode = () => (sentCode === '000000' ? '111111' : '000000');

  it('sends a short-lived code and stores only its hash', async () => {
    const challenge = await service.request(user);

    expect(challenge).toMatchObject({
      admin_confirmation_required: true,
      expires_in: 300,
      retry_after: 60,
      max_attempts: 5,
    });
    expect(challenge.challenge_id).toMatch(/^[a-f0-9]{64}$/);
    expect(sentCode).toMatch(/^\d{6}$/);
    const stored = read(`admin-login:challenge:${challenge.challenge_id}`)!;
    expect(stored).not.toContain(sentCode);
    expect(JSON.parse(stored)).not.toHaveProperty('code');
    await expect(
      service.confirm(challenge.challenge_id, sentCode),
    ).resolves.toMatchObject({
      id: user.id,
    });
    await expect(
      service.confirm(challenge.challenge_id, sentCode),
    ).rejects.toMatchObject({
      status: 401,
    });
  });

  it('keeps the valid code after a wrong attempt and limits repeated guesses', async () => {
    const challenge = await service.request(user);
    await expect(
      service.confirm(challenge.challenge_id, wrongCode()),
    ).rejects.toMatchObject({
      response: { attempts_remaining: 4 },
    });
    await expect(
      service.confirm(challenge.challenge_id, sentCode),
    ).resolves.toMatchObject({
      id: user.id,
    });

    const next = await service.request(user).catch((err: HttpException) => err);
    expect(next).toBeInstanceOf(HttpException);
  });

  it('does not issue a challenge for an ordinary or blocked account', async () => {
    await expect(
      service.request({ ...user, role: Role.USER } as User),
    ).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      service.request({ ...user, is_blocked: true } as User),
    ).rejects.toMatchObject({
      status: 401,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('invalidates an undelivered code and lets the owner try again', async () => {
    send.mockRejectedValueOnce(new Error('SMTP failed'));
    await expect(service.request(user)).rejects.toMatchObject({ status: 503 });
    expect(
      [...values.keys()].filter(
        (key) => key.includes('active:') || key.includes('challenge:'),
      ),
    ).toHaveLength(0);
    await expect(service.request(user)).resolves.toHaveProperty('challenge_id');
  });
});
