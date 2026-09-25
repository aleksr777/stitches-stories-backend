import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isEmail } from 'class-validator';
import {
  SocialPendingIdentity,
  SocialProfile,
  SocialProvider,
} from '../entities/social-identity.entity';

export const socialDigest = (value: string) =>
  createHash('sha256').update(value).digest('base64url');

@Injectable()
export class SocialProviderService {
  config(provider: string) {
    if (provider !== 'yandex' && provider !== 'vk')
      throw new BadRequestException('Неизвестный способ входа.');
    const prefix = provider === 'yandex' ? 'YANDEX' : 'VK';
    const clientId = process.env[`${prefix}_OAUTH_CLIENT_ID`]?.trim();
    const secret = process.env[`${prefix}_OAUTH_CLIENT_SECRET`]?.trim();
    const redirectUri = process.env[`${prefix}_OAUTH_REDIRECT_URI`]?.trim();
    if (!clientId || !redirectUri || (provider === 'yandex' && !secret))
      throw new ServiceUnavailableException(
        'Этот способ входа пока не подключён.',
      );
    const url = new URL(redirectUri);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== `/api/auth/social/${provider}/callback` ||
      (url.protocol !== 'https:' &&
        !(
          process.env.NODE_ENV !== 'production' &&
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(url.hostname)
        ))
    )
      throw new ServiceUnavailableException('Некорректная настройка входа.');
    return { clientId, secret, redirectUri };
  }

  available() {
    return (['yandex', 'vk'] as const).filter((provider) => {
      try {
        this.config(provider);
        return true;
      } catch {
        return false;
      }
    });
  }

  authorize(provider: SocialProvider, state: string, verifier: string) {
    const config = this.config(provider);
    const url = new URL(
      provider === 'yandex'
        ? 'https://oauth.yandex.ru/authorize'
        : 'https://id.vk.ru/authorize',
    );
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      state,
      code_challenge: socialDigest(verifier),
      code_challenge_method: provider === 'vk' ? 's256' : 'S256',
      scope:
        provider === 'yandex'
          ? 'login:info login:email login:default_phone'
          : 'vkid.personal_info',
    }).toString();
    return url.toString();
  }

  private async json(
    url: string,
    options: RequestInit,
  ): Promise<Record<string, unknown>> {
    try {
      const response = await fetch(url, {
        ...options,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error();
      const data: unknown = await response.json();
      if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data) ||
        'error' in data
      )
        throw new Error();
      return data as Record<string, unknown>;
    } catch {
      throw new BadRequestException(
        'Не удалось подтвердить вход. Попробуйте ещё раз.',
      );
    }
  }

  async exchange(
    provider: SocialProvider,
    code: string,
    verifier: string,
    state: string,
    deviceId?: string,
  ): Promise<SocialPendingIdentity> {
    const config = this.config(provider);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
    });
    if (provider === 'yandex') body.set('client_secret', config.secret!);
    else {
      if (!deviceId)
        throw new BadRequestException(
          'Не получен идентификатор устройства VK.',
        );
      body.set('device_id', deviceId);
      body.set('state', state);
    }
    const token = await this.json(
      provider === 'yandex'
        ? 'https://oauth.yandex.ru/token'
        : 'https://id.vk.ru/oauth2/auth',
      { method: 'POST', body },
    );
    if (
      typeof token.access_token !== 'string' ||
      (provider === 'vk' && token.state !== state)
    )
      throw new BadRequestException('Некорректное подтверждение входа.');
    const data =
      provider === 'yandex'
        ? await this.json('https://login.yandex.ru/info?format=json', {
            headers: { Authorization: `OAuth ${token.access_token}` },
          })
        : await this.json('https://id.vk.ru/oauth2/user_info', {
            method: 'POST',
            body: new URLSearchParams({
              access_token: token.access_token,
              client_id: config.clientId,
            }),
          });
    const user =
      provider === 'vk'
        ? (data.user as Record<string, unknown> | undefined)
        : data;
    const id = provider === 'vk' ? user?.user_id : user?.id;
    if (
      (typeof id !== 'string' && typeof id !== 'number') ||
      !String(id) ||
      String(id).length > 255 ||
      (provider === 'yandex' && data.client_id !== config.clientId) ||
      (provider === 'vk' && String(token.user_id) !== String(id))
    )
      throw new BadRequestException('Некорректный профиль провайдера.');
    if (provider === 'vk') return { provider, subject: String(id) };
    const clean = (value: unknown, max: number) =>
      typeof value === 'string' && value.trim().length <= max
        ? value.trim()
        : '';
    const first = clean(data.first_name, 100);
    const last = clean(data.last_name, 100);
    const name =
      clean([first, last].filter(Boolean).join(' '), 200) ||
      clean(data.real_name, 200);
    const email = clean(data.default_email, 255).toLowerCase();
    const phone = clean(
      (data.default_phone as { number?: unknown } | null)?.number,
      30,
    );
    const profile: SocialProfile = {
      ...(name.length >= 2 ? { name } : {}),
      ...(data.sex === 'male' || data.sex === 'female'
        ? { sex: data.sex }
        : {}),
      ...(isEmail(email) ? { email } : {}),
      ...(/^[+\d ()-]{6,30}$/.test(phone) ? { phone } : {}),
    };
    return { provider, subject: String(id), profile };
  }
}
