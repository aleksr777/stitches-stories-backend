import { EnvService } from '../common/env-service/env.service';
import { ErrorsService } from '../common/errors-service/errors.service';
import { RedisService } from '../common/redis-service/redis.service';
import { TokensService } from './tokens.service';

const createService = () => {
  const get = jest.fn();
  const set = jest.fn();
  const del = jest.fn();
  const consumeActiveToken = jest.fn();
  const redis = {
    get,
    set,
    del,
    consumeActiveToken,
  } as unknown as RedisService;
  const values: Record<string, string | number> = {
    RESET_TOKEN_EXPIRES_IN: 300,
    REGISTRATION_TOKEN_EXPIRES_IN: 300,
    EMAIL_CHANGE_TOKEN_EXPIRES_IN: 300,
    PASSWORD_CHANGE_TOKEN_EXPIRES_IN: 300,
    VERIFICATION_CODE_RESEND_COOLDOWN: 60,
  };
  const env = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as EnvService;
  const service = new TokensService(redis, env, new ErrorsService());
  return { service, get, set, del, consumeActiveToken };
};

describe('TokensService latest-only authenticated verification codes', () => {
  it('invalidates the previous current-user password reset code', async () => {
    const { service, get, set, del } = createService();
    jest.spyOn(service, 'generateVerificationCode').mockReturnValue('222222');
    set.mockResolvedValue('OK');
    get.mockResolvedValue('111111');

    await expect(service.getCurrentUserPasswordResetCode(7)).resolves.toBe(
      '222222',
    );

    expect(set).toHaveBeenNthCalledWith(
      1,
      'current-user-password-reset:222222',
      '7',
      { EX: 300, NX: true },
    );
    expect(set).toHaveBeenNthCalledWith(
      2,
      'current-user-password-reset:active:7',
      '222222',
      { EX: 300 },
    );
    expect(del).toHaveBeenCalledWith('current-user-password-reset:111111');
  });

  it('atomically consumes only the active current-user password reset code', async () => {
    const { service, consumeActiveToken } = createService();
    consumeActiveToken.mockResolvedValue('7');

    await expect(
      service.consumeCurrentUserPasswordResetCode(7, '222222'),
    ).resolves.toBe(7);

    expect(consumeActiveToken).toHaveBeenCalledWith(
      'current-user-password-reset:active:7',
      '222222',
      'current-user-password-reset:222222',
    );
  });

  it('invalidates the previous password-change code', async () => {
    const { service, get, set, del } = createService();
    jest.spyOn(service, 'generateVerificationCode').mockReturnValue('444444');
    set.mockResolvedValue('OK');
    get.mockResolvedValue('333333');

    await expect(service.getPasswordChangeCode(7)).resolves.toBe('444444');

    expect(set).toHaveBeenNthCalledWith(1, 'password-change:444444', '7', {
      EX: 300,
      NX: true,
    });
    expect(set).toHaveBeenNthCalledWith(
      2,
      'password-change:active:7',
      '444444',
      { EX: 300 },
    );
    expect(del).toHaveBeenCalledWith('password-change:333333');
  });

  it('atomically consumes only the active password-change code', async () => {
    const { service, consumeActiveToken } = createService();
    consumeActiveToken.mockResolvedValue('7');

    await expect(service.consumePasswordChangeCode(7, '444444')).resolves.toBe(
      7,
    );

    expect(consumeActiveToken).toHaveBeenCalledWith(
      'password-change:active:7',
      '444444',
      'password-change:444444',
    );
  });
});
