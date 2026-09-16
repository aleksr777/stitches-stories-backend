import { DataSource } from 'typeorm';
import { RedisService } from '../common/redis-service/redis.service';
import { HealthController } from './health.controller';

const createController = () => {
  const query = jest.fn();
  const ping = jest.fn();
  const controller = new HealthController(
    { query } as unknown as DataSource,
    { ping } as unknown as RedisService,
  );
  return { controller, query, ping };
};

describe('HealthController', () => {
  it('reports process liveness without checking dependencies', () => {
    const { controller, query, ping } = createController();

    expect(controller.live()).toEqual({ status: 'ok' });
    expect(query).not.toHaveBeenCalled();
    expect(ping).not.toHaveBeenCalled();
  });

  it('reports ready only when PostgreSQL and Redis are available', async () => {
    const { controller, query, ping } = createController();
    query.mockResolvedValue([{ '?column?': 1 }]);
    ping.mockResolvedValue(true);

    await expect(controller.ready()).resolves.toEqual({
      status: 'ok',
      database: true,
      redis: true,
    });
    expect(query).toHaveBeenCalledWith('SELECT 1');
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('returns a degraded readiness result when PostgreSQL is unavailable', async () => {
    const { controller, query, ping } = createController();
    query.mockRejectedValue(new Error('database unavailable'));
    ping.mockResolvedValue(true);

    await expect(controller.ready()).rejects.toMatchObject({
      status: 503,
      response: {
        status: 'degraded',
        database: false,
        redis: true,
      },
    });
  });

  it('returns a degraded readiness result when Redis is unavailable', async () => {
    const { controller, query, ping } = createController();
    query.mockResolvedValue([{ '?column?': 1 }]);
    ping.mockResolvedValue(false);

    await expect(controller.ready()).rejects.toMatchObject({
      status: 503,
      response: {
        status: 'degraded',
        database: true,
        redis: false,
      },
    });
  });
});
