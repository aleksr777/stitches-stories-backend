import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { RedisService } from '../../common/redis-service/redis.service';
import {
  SocialIdentityRef,
  SocialProvider,
} from '../entities/social-identity.entity';
import { socialDigest, SocialProviderService } from './social-provider.service';

type Flow = { provider: SocialProvider; verifier: string; binding: string };
const nonce = () => randomBytes(32).toString('base64url');
const valid = (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value);

@Injectable()
export class SocialFlowService {
  constructor(
    private readonly redis: RedisService,
    private readonly providers: SocialProviderService,
  ) {}
  async begin(provider: SocialProvider) {
    const state = nonce(),
      binding = nonce(),
      verifier = nonce();
    const url = this.providers.authorize(provider, state, verifier);
    await this.redis.set(
      `social:state:${socialDigest(state)}`,
      JSON.stringify({ provider, verifier, binding: socialDigest(binding) }),
      { EX: 600 },
    );
    return { url, binding };
  }
  async callback(
    provider: SocialProvider,
    state: string,
    binding: string,
    code: string,
    deviceId?: string,
  ) {
    if (!valid(state) || !valid(binding)) throw new UnauthorizedException();
    const key = `social:state:${socialDigest(state)}`;
    const raw = await this.redis.get(key);
    if (!raw) throw new UnauthorizedException();
    const flow = JSON.parse(raw) as Flow;
    if (flow.provider !== provider || flow.binding !== socialDigest(binding))
      throw new UnauthorizedException();
    // GETDEL makes a callback single-use, including concurrent callbacks.
    if (!(await this.redis.getClient().getDel(key)))
      throw new UnauthorizedException();
    const identity = await this.providers.exchange(
      provider,
      code,
      flow.verifier,
      state,
      deviceId,
    );
    const pending = nonce();
    await this.redis.set(
      `social:pending:${socialDigest(pending)}`,
      JSON.stringify(identity),
      { EX: 600 },
    );
    return pending;
  }
  async pending(token: string, consume = false): Promise<SocialIdentityRef> {
    if (!valid(token))
      throw new UnauthorizedException('Начните вход через сервис заново.');
    const key = `social:pending:${socialDigest(token)}`;
    const raw = consume
      ? await this.redis.getClient().getDel(key)
      : await this.redis.get(key);
    if (!raw)
      throw new UnauthorizedException(
        'Время подтверждения истекло. Начните вход заново.',
      );
    return JSON.parse(raw) as SocialIdentityRef;
  }
}
