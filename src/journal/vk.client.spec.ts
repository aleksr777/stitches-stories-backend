import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  decodeVkPost,
  isVkPhotoUrl,
  MAX_PHOTO_BYTES,
  VkClient,
  vkDomain,
} from './vk.client';

const source = () => ({
  id: 11,
  owner_id: -123,
  from_id: -123,
  post_type: 'post',
  text: 'История мастерской',
  date: 1700000000,
  attachments: [
    {
      type: 'photo',
      photo: {
        sizes: [
          {
            type: 'x',
            url: 'https://sun9.userapi.com/small.jpg',
            width: 600,
            height: 800,
          },
          {
            type: 'w',
            url: 'https://sun9.userapi.com/large.jpg',
            width: 1200,
            height: 1600,
          },
          {
            type: 'r',
            url: 'https://sun9.userapi.com/crop.jpg',
            width: 2000,
            height: 2000,
          },
        ],
      },
    },
  ],
});

describe('VK import boundary', () => {
  afterEach(() => jest.restoreAllMocks());
  it('normalizes only VK page URLs and refuses post links and arbitrary hosts', () => {
    expect(vkDomain('https://vk.ru/craft_studio/')).toBe('craft_studio');
    expect(vkDomain('id123')).toBe('id123');
    for (const value of [
      'https://example.com/studio',
      'http://vk.com/studio',
      'https://vk.com@evil.test/studio',
      'https://vk.com/wall-1_2',
      'https://vk.com/studio?token=secret',
      'https://vk.com/studio#fragment',
    ])
      expect(() => vkDomain(value)).toThrow();
    for (const value of [
      'http://sun9.userapi.com/a',
      'https://userapi.com.evil.test/a',
      'https://127.0.0.1/a',
      'https://sun9.userapi.com:8443/a',
      'https://user:pass@sun9.userapi.com/a',
    ])
      expect(isVkPhotoUrl(value)).toBe(false);
  });
  it('copies the original text and largest uncropped photo, leaving video in VK', () => {
    const input = source();
    const post = decodeVkPost({
      ...input,
      attachments: [...input.attachments, { type: 'video' }],
    });
    expect(post?.text).toBe(input.text);
    expect(post?.photos).toEqual([
      {
        sourceUrl: 'https://sun9.userapi.com/large.jpg',
        width: 1200,
        height: 1600,
      },
    ]);
    expect(post?.otherAttachments).toEqual(['video']);
  });
  it.each([
    { friends_only: 1 },
    { is_deleted: true },
    { is_archived: true },
    { donut: { is_donut: true } },
    { copy_history: [{}] },
    { from_id: 2 },
    { post_type: 'suggest' },
    { access_key: 'private' },
    { date: 0 },
    { text: null },
  ])('skips restricted, foreign or malformed posts: %j', (extra) => {
    expect(decodeVkPost({ ...source(), ...extra })).toBeNull();
  });
  it('never returns an access token echoed in a VK error', async () => {
    const token = 'synthetic-test-token';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            error_code: 5,
            request_params: [{ key: 'access_token', value: token }],
          },
        }),
      ),
    );
    const client = new VkClient(new ConfigService({ VK_ACCESS_TOKEN: token }));
    await expect(client.posts('craft_studio', 0)).rejects.toThrow(
      'VK не вернул публикации',
    );
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.vk.com/method/wall.get');
    expect(options?.body).toBeInstanceOf(URLSearchParams);
    expect((options?.body as URLSearchParams).get('filter')).toBe('owner');
    expect(options?.redirect).toBe('error');
  });
  it('does not connect when no token is configured', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(
      new VkClient(new ConfigService()).posts('craft_studio', 0),
    ).rejects.toThrow('VK_ACCESS_TOKEN');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('bounds streamed photo bytes even without Content-Length, and rejects HTML', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(Buffer.alloc(MAX_PHOTO_BYTES + 1)))
      .mockResolvedValueOnce(new Response('<svg onload="alert(1)"/>'));
    const client = new VkClient(new ConfigService());
    await expect(
      client.photo('https://sun9.userapi.com/photo'),
    ).rejects.toBeInstanceOf(BadGatewayException);
    await expect(
      client.photo('https://sun9.userapi.com/photo'),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(
      fetchMock.mock.calls.every(
        ([, options]) => options?.redirect === 'error',
      ),
    ).toBe(true);
  });
});
