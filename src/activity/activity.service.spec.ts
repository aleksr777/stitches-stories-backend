import { RedisService } from '../common/redis-service/redis.service';
import { ActivityService } from './activity.service';
import { SESSION_ACTIVITY_TTL_SECONDS } from './activity.constants';

describe('ActivityService session activity', () => {
  const createService = () => {
    const set = jest.fn();
    const client = {
      mGet: jest.fn(),
      scan: jest.fn(),
      del: jest.fn(),
    };
    const redis = {
      set,
      getClient: jest.fn(() => client),
    } as unknown as RedisService;

    return {
      service: new ActivityService(redis),
      set,
      client,
    };
  };

  it('stores one Redis activity key per user session', async () => {
    const { service, set } = createService();
    const date = new Date('2026-09-14T08:00:00.000Z');

    await service.setSessionActivity(
      7,
      '11111111-1111-4111-8111-111111111111',
      date,
    );

    expect(set).toHaveBeenCalledWith(
      'session:last_activity:7:11111111-1111-4111-8111-111111111111',
      date.toISOString(),
      { EX: SESSION_ACTIVITY_TTL_SECONDS },
    );
  });

  it('returns pending activity only for valid Redis timestamps', async () => {
    const { service, client } = createService();
    client.mGet.mockResolvedValue(['2026-09-14T08:01:00.000Z', 'invalid-date']);

    const result = await service.getSessionActivities(7, [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);

    expect(result.get('11111111-1111-4111-8111-111111111111')).toEqual(
      new Date('2026-09-14T08:01:00.000Z'),
    );
    expect(result.has('22222222-2222-4222-8222-222222222222')).toBe(false);
  });
});
