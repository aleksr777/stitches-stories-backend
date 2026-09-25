import { UnauthorizedException } from '@nestjs/common';
import { RedisService } from '../../common/redis-service/redis.service';
import { SocialFlowService } from './social-flow.service';
import { SocialProviderService } from './social-provider.service';

describe('OAuth browser binding and replay protection', () => {
  let flow: SocialFlowService;
  let exchange: jest.Mock;
  let values: Map<string, string>;
  beforeEach(() => {
    values = new Map();
    const redis = {
      set: jest.fn((key: string, value: string) => {
        values.set(key, value);
        return Promise.resolve('OK');
      }),
      get: jest.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
      getClient: () => ({
        getDel: (key: string) => {
          const result = values.get(key) ?? null;
          values.delete(key);
          return Promise.resolve(result);
        },
      }),
    } as unknown as RedisService;
    exchange = jest
      .fn()
      .mockResolvedValue({ provider: 'yandex', subject: '123' });
    flow = new SocialFlowService(redis, {
      authorize: (_provider: string, state: string) =>
        `https://provider.example/?state=${state}`,
      exchange,
    } as unknown as SocialProviderService);
  });
  it('rejects callbacks from a different browser or provider before exchanging the code', async () => {
    const start = await flow.begin('yandex');
    const state = new URL(start.url).searchParams.get('state')!;
    await expect(
      flow.callback('yandex', state, 'x'.repeat(43), 'code'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      flow.callback('vk', state, start.binding, 'code'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(exchange).not.toHaveBeenCalled();
    await expect(
      flow.callback('yandex', state, start.binding, 'code'),
    ).resolves.toHaveLength(43);
  });
  it('accepts only one concurrent callback and one consumption of its pending identity', async () => {
    const start = await flow.begin('yandex');
    const state = new URL(start.url).searchParams.get('state')!;
    const results = await Promise.allSettled([
      flow.callback('yandex', state, start.binding, 'code'),
      flow.callback('yandex', state, start.binding, 'code'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(exchange).toHaveBeenCalledTimes(1);
    const accepted = results.find(
      (r) => r.status === 'fulfilled',
    ) as PromiseFulfilledResult<string>;
    expect(await flow.pending(accepted.value)).toEqual({
      provider: 'yandex',
      subject: '123',
    });
    await flow.pending(accepted.value, true);
    await expect(flow.pending(accepted.value, true)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
  it('rejects expired flows and malformed pending cookies', async () => {
    const start = await flow.begin('yandex');
    values.clear();
    await expect(
      flow.callback(
        'yandex',
        new URL(start.url).searchParams.get('state')!,
        start.binding,
        'code',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(flow.pending('../invalid')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(exchange).not.toHaveBeenCalled();
  });
});
