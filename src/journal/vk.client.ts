import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type JsonObject = Record<string, unknown>;
const record = (value: unknown): JsonObject =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
const nonzeroId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value !== 0;
export type VkPhoto = { sourceUrl: string; width: number; height: number };
export type VkPost = {
  vkOwnerId: string;
  vkPostId: string;
  text: string;
  sourcePublishedAt: Date;
  photos: VkPhoto[];
  otherAttachments: string[];
};
export const VK_BATCH_SIZE = 20;
export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

export function vkDomain(input: string): string {
  const value = input.trim();
  try {
    const url = new URL(
      /^https?:\/\//i.test(value)
        ? value
        : 'https://' +
          (/^(?:www\.|m\.)?vk\.(?:com|ru)\//i.test(value)
            ? value
            : 'vk.com/' + value),
    );
    const domain = url.pathname.replace(/^\//, '').replace(/\/$/, '');
    if (
      url.protocol !== 'https:' ||
      ![
        'vk.com',
        'vk.ru',
        'www.vk.com',
        'www.vk.ru',
        'm.vk.com',
        'm.vk.ru',
      ].includes(url.hostname) ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^[a-zA-Z0-9_][a-zA-Z0-9_.]{1,99}$/.test(domain) ||
      /^(wall|photo|video|clip)-?\d/i.test(domain)
    )
      throw new Error();
    return domain;
  } catch {
    throw new BadRequestException(
      'Укажите HTTPS-ссылку на страницу или сообщество VK, без ссылки на отдельный пост.',
    );
  }
}

export function isVkPhotoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      [
        'userapi.com',
        'vkuserphoto.ru',
        'vkuserphoto.net',
        'vkuserphoto.com',
      ].some((host) => url.hostname.endsWith('.' + host))
    );
  } catch {
    return false;
  }
}

// Only ordinary public posts by the wall owner. No private posts, reposts or paid content.
export function decodeVkPost(input: unknown): VkPost | null {
  const p = record(input);
  if (
    !nonzeroId(p.owner_id) ||
    !nonzeroId(p.id) ||
    p.id < 1 ||
    p.from_id !== p.owner_id ||
    p.post_type !== 'post' ||
    p.friends_only ||
    p.is_deleted ||
    p.is_archived ||
    record(p.donut).is_donut ||
    p.access_key ||
    (Array.isArray(p.copy_history) && p.copy_history.length)
  )
    return null;
  if (
    typeof p.date !== 'number' ||
    !Number.isSafeInteger(p.date) ||
    p.date < 1 ||
    p.date * 1000 > Date.now() ||
    typeof p.text !== 'string' ||
    p.text.length > 100000
  )
    return null;
  const photos: VkPhoto[] = [];
  const otherAttachments: string[] = [];
  for (const attachment of Array.isArray(p.attachments) ? p.attachments : []) {
    const item = record(attachment);
    if (item.type !== 'photo') {
      otherAttachments.push(
        typeof item.type === 'string' ? item.type.slice(0, 40) : 'other',
      );
      continue;
    }
    const photo = record(item.photo);
    // VK's s/m/x/y/z/w sizes preserve proportions; o/p/q/r are cropped previews.
    const sizes = (Array.isArray(photo.sizes) ? photo.sizes : [])
      .map(record)
      .filter(
        (size) =>
          typeof size.url === 'string' &&
          isVkPhotoUrl(size.url) &&
          ['s', 'm', 'x', 'y', 'z', 'w'].includes(String(size.type)) &&
          typeof size.width === 'number' &&
          Number.isSafeInteger(size.width) &&
          size.width > 0 &&
          size.width <= 20000 &&
          typeof size.height === 'number' &&
          Number.isSafeInteger(size.height) &&
          size.height > 0 &&
          size.height <= 20000,
      )
      .sort(
        (a, b) =>
          Number(b.width) * Number(b.height) -
          Number(a.width) * Number(a.height),
      );
    const size = sizes[0];
    if (!size || photos.length >= 10) return null;
    photos.push({
      sourceUrl: size.url as string,
      width: Number(size.width),
      height: Number(size.height),
    });
  }
  if (!p.text.trim() && !photos.length && !otherAttachments.length) return null;
  return {
    vkOwnerId: String(p.owner_id),
    vkPostId: String(p.id),
    text: p.text,
    sourcePublishedAt: new Date(p.date * 1000),
    photos,
    otherAttachments: [...new Set(otherAttachments)],
  };
}

async function boundedBody(
  response: Response,
  maximum: number,
): Promise<Buffer> {
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('upstream');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    if (Number(response.headers.get('content-length')) > maximum)
      throw new Error('size');
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) throw new Error('size');
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

@Injectable()
export class VkClient {
  constructor(private readonly config: ConfigService) {}
  get configured(): boolean {
    return !!this.config.get<string>('VK_ACCESS_TOKEN')?.trim();
  }

  private async call(
    method: 'wall.get' | 'wall.getById',
    parameters: Record<string, string>,
  ): Promise<unknown> {
    const token = this.config.get<string>('VK_ACCESS_TOKEN')?.trim();
    if (!token)
      throw new ServiceUnavailableException(
        'Подключение VK не настроено: добавьте VK_ACCESS_TOKEN в .env бэкенда и перезапустите его.',
      );
    try {
      const response = await fetch('https://api.vk.com/method/' + method, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          ...parameters,
          access_token: token,
          v: '5.199',
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      const result = record(
        JSON.parse(
          (await boundedBody(response, 4 * 1024 * 1024)).toString(),
        ) as unknown,
      );
      if (result.error || result.response === undefined) throw new Error('vk');
      return result.response;
    } catch {
      // VK errors can echo the access token in request_params. Never forward or log them.
      throw new BadGatewayException(
        'VK не вернул публикации. Проверьте доступ токена к этой странице и повторите запрос.',
      );
    }
  }

  async posts(domain: string, offset: number) {
    const data = record(
      await this.call('wall.get', {
        domain,
        filter: 'owner',
        count: String(VK_BATCH_SIZE),
        offset: String(offset),
        extended: '0',
      }),
    );
    if (
      !Array.isArray(data.items) ||
      data.items.length > VK_BATCH_SIZE ||
      typeof data.count !== 'number' ||
      !Number.isSafeInteger(data.count) ||
      data.count < 0
    )
      throw new BadGatewayException(
        'VK вернул неожиданный формат списка публикаций.',
      );
    const posts = data.items.map(decodeVkPost);
    return {
      posts: posts.filter((p): p is VkPost => p !== null),
      skipped: posts.filter((p) => p === null).length,
      total: data.count,
      nextOffset:
        offset + data.items.length < data.count && data.items.length
          ? offset + data.items.length
          : null,
    };
  }

  async post(ownerId: string, postId: string): Promise<VkPost> {
    const data = await this.call('wall.getById', {
      posts: ownerId + '_' + postId,
      extended: '0',
    });
    const items = Array.isArray(data) ? data : record(data).items;
    const post = Array.isArray(items) ? decodeVkPost(items[0]) : null;
    if (!post || post.vkOwnerId !== ownerId || post.vkPostId !== postId)
      throw new BadGatewayException(
        'Пост удалён, ограничен или недоступен для переноса.',
      );
    return post;
  }

  async photo(url: string): Promise<{ data: Buffer; mime: string }> {
    if (!isVkPhotoUrl(url))
      throw new BadGatewayException(
        'Не удалось проверить адрес фотографии VK.',
      );
    try {
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      const data = await boundedBody(response, MAX_PHOTO_BYTES);
      let mime = '';
      if (data.subarray(0, 3).equals(Buffer.from([255, 216, 255])))
        mime = 'image/jpeg';
      if (
        data
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        mime = 'image/png';
      if (
        data.toString('ascii', 0, 4) === 'RIFF' &&
        data.toString('ascii', 8, 12) === 'WEBP'
      )
        mime = 'image/webp';
      if (!mime) throw new Error('format');
      return { data, mime };
    } catch {
      throw new BadGatewayException(
        'Не удалось сохранить фото VK (JPEG, PNG или WebP, до 6 МБ). Обновите пост из VK и повторите просмотр.',
      );
    }
  }
}
