import { BadRequestException } from '@nestjs/common';
import { SocialProviderService } from './social-provider.service';

describe('Social provider protocol validation', () => {
  const saved = { ...process.env };
  const originalFetch = global.fetch;
  const service = new SocialProviderService();
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), { status: 200 });
  beforeEach(() => {
    process.env.YANDEX_OAUTH_CLIENT_ID = 'yandex-app';
    process.env.YANDEX_OAUTH_CLIENT_SECRET = 'synthetic-secret';
    process.env.YANDEX_OAUTH_REDIRECT_URI =
      'https://api.example.test/api/auth/social/yandex/callback';
    process.env.VK_OAUTH_CLIENT_ID = '123';
    process.env.VK_OAUTH_REDIRECT_URI =
      'https://api.example.test/api/auth/social/vk/callback';
  });
  afterEach(() => {
    process.env = { ...saved };
    global.fetch = originalFetch;
  });
  it('hides unconfigured providers and sends PKCE without exposing client secrets', () => {
    delete process.env.VK_OAUTH_CLIENT_ID;
    expect(service.available()).toEqual(['yandex']);
    const url = new URL(service.authorize('yandex', 'state', 'v'.repeat(43)));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toHaveLength(43);
    expect(url.toString()).not.toContain('synthetic-secret');
    expect(url.searchParams.get('scope')).toBe('login:info');
  });
  it('checks Yandex application identity and ignores profile email for account matching', async () => {
    const mock = jest
      .fn()
      .mockResolvedValueOnce(json({ access_token: 'test-provider-token' }))
      .mockResolvedValueOnce(
        json({
          id: '42',
          client_id: 'yandex-app',
          default_email: 'owner@example.test',
        }),
      );
    global.fetch = mock;
    expect(
      await service.exchange('yandex', 'code', 'verifier', 'state'),
    ).toEqual({ provider: 'yandex', subject: '42' });
    expect(mock).toHaveBeenNthCalledWith(
      2,
      'https://login.yandex.ru/info?format=json',
      expect.objectContaining({
        headers: { Authorization: 'OAuth test-provider-token' },
        redirect: 'error',
      }),
    );
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(json({ access_token: 'test' }))
      .mockResolvedValueOnce(json({ id: '42', client_id: 'different-app' }));
    await expect(
      service.exchange('yandex', 'code', 'verifier', 'state'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('checks VK state, device ID and user ID against the authenticated user_info endpoint', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        json({ access_token: 'test', user_id: 42, state: 'expected' }),
      )
      .mockResolvedValueOnce(json({ user: { user_id: '42' } }));
    expect(
      await service.exchange('vk', 'code', 'verifier', 'expected', 'device'),
    ).toEqual({ provider: 'vk', subject: '42' });
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        json({ access_token: 'test', user_id: 42, state: 'wrong' }),
      );
    await expect(
      service.exchange('vk', 'code', 'verifier', 'expected', 'device'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await expect(
      service.exchange('vk', 'code', 'verifier', 'expected'),
    ).rejects.toBeInstanceOf(BadRequestException);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        json({ access_token: 'test', user_id: 42, state: 'expected' }),
      )
      .mockResolvedValueOnce(json({ user: { user_id: '99' } }));
    await expect(
      service.exchange('vk', 'code', 'verifier', 'expected', 'device'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
