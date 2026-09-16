import { Injectable } from '@nestjs/common';
import { RedisService } from '../common/redis-service/redis.service';
import {
  SESSION_ACTIVITY_KEY_PREFIX,
  SESSION_ACTIVITY_TTL_SECONDS,
} from './activity.constants';

export type SessionActivity = {
  userId: number;
  sessionId: string;
  date: Date;
  key: string;
};

@Injectable()
export class ActivityService {
  constructor(private readonly redis: RedisService) {}

  private key(userId: number | string, sessionId: string) {
    return `${SESSION_ACTIVITY_KEY_PREFIX}:${userId}:${sessionId}`;
  }

  async setSessionActivity(
    userId: number | string,
    sessionId: string,
    date: Date = new Date(),
  ): Promise<void> {
    await this.redis.set(this.key(userId, sessionId), date.toISOString(), {
      EX: SESSION_ACTIVITY_TTL_SECONDS,
    });
  }

  async getSessionActivities(
    userId: number,
    sessionIds: string[],
  ): Promise<Map<string, Date>> {
    if (sessionIds.length === 0) return new Map();

    const keys = sessionIds.map((sessionId) => this.key(userId, sessionId));
    const values = await this.redis.getClient().mGet(keys);
    const activities = new Map<string, Date>();

    for (let i = 0; i < sessionIds.length; i++) {
      const value = values[i];
      if (!value) continue;
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        activities.set(sessionIds[i], date);
      }
    }

    return activities;
  }

  async scanSessionActivities(): Promise<SessionActivity[]> {
    const client = this.redis.getClient();
    const pattern = `${SESSION_ACTIVITY_KEY_PREFIX}:*:*`;
    let cursor = 0;
    const out: SessionActivity[] = [];

    do {
      const { cursor: nextCursor, keys } = await client.scan(cursor, {
        MATCH: pattern,
        COUNT: 200,
      });
      cursor = nextCursor;
      if (keys.length === 0) continue;

      const values = await client.mGet(keys);
      for (let i = 0; i < keys.length; i++) {
        const value = values[i];
        if (!value) continue;

        const suffix = keys[i].slice(`${SESSION_ACTIVITY_KEY_PREFIX}:`.length);
        const separatorIndex = suffix.indexOf(':');
        if (separatorIndex <= 0) continue;

        const userId = Number(suffix.slice(0, separatorIndex));
        const sessionId = suffix.slice(separatorIndex + 1);
        const date = new Date(value);
        if (
          Number.isInteger(userId) &&
          sessionId.length > 0 &&
          !Number.isNaN(date.getTime())
        ) {
          out.push({ userId, sessionId, date, key: keys[i] });
        }
      }
    } while (cursor !== 0);

    return out;
  }

  async deleteKeys(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.redis.getClient().del(keys);
  }

  async deleteUserActivities(userId: number | string): Promise<void> {
    const client = this.redis.getClient();
    const pattern = `${SESSION_ACTIVITY_KEY_PREFIX}:${userId}:*`;
    let cursor = 0;
    const keysToDelete: string[] = [];

    do {
      const result = await client.scan(cursor, { MATCH: pattern, COUNT: 200 });
      cursor = result.cursor;
      keysToDelete.push(...result.keys);
    } while (cursor !== 0);

    await this.deleteKeys(keysToDelete);
  }
}
