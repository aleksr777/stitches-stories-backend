import { Injectable, Logger } from '@nestjs/common';
import { Cron as CronDecorator } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { ActivityService, type SessionActivity } from './activity.service';
import { SESSION_ACTIVITY_FLUSH_BATCH_SIZE } from './activity.constants';

const CronSafe: (expr: string) => MethodDecorator =
  CronDecorator as unknown as (expr: string) => MethodDecorator;

@Injectable()
export class ActivityFlushService {
  private readonly logger = new Logger(ActivityFlushService.name);

  constructor(
    private readonly activity: ActivityService,
    private readonly dataSource: DataSource,
  ) {}

  private async updateSessions(
    manager: EntityManager,
    updates: SessionActivity[],
  ): Promise<void> {
    const params: Array<string | number> = [];
    const rows = updates.map((update, index) => {
      const offset = index * 3;
      params.push(update.sessionId, update.userId, update.date.toISOString());
      return `($${offset + 1}::uuid, $${offset + 2}::int, $${offset + 3}::timestamptz)`;
    });

    await manager.query(
      `UPDATE auth_session AS session
       SET last_used_at = GREATEST(session.last_used_at, activity.last_used_at)
       FROM (VALUES ${rows.join(', ')}) AS activity(id, user_id, last_used_at)
       WHERE session.id = activity.id AND session.user_id = activity.user_id`,
      params,
    );
  }

  private async updateUsers(
    manager: EntityManager,
    updates: SessionActivity[],
  ): Promise<void> {
    const latestByUser = new Map<number, Date>();
    for (const update of updates) {
      const current = latestByUser.get(update.userId);
      if (!current || update.date > current) {
        latestByUser.set(update.userId, update.date);
      }
    }

    const params: Array<string | number> = [];
    const rows = [...latestByUser.entries()].map(([userId, date], index) => {
      const offset = index * 2;
      params.push(userId, date.toISOString());
      return `($${offset + 1}::int, ($${offset + 2}::timestamptz AT TIME ZONE 'UTC'))`;
    });

    await manager.query(
      `UPDATE "user" AS app_user
       SET last_activity_at = GREATEST(
         COALESCE(app_user.last_activity_at, activity.last_activity_at),
         activity.last_activity_at
       )
       FROM (VALUES ${rows.join(', ')}) AS activity(id, last_activity_at)
       WHERE app_user.id = activity.id`,
      params,
    );
  }

  private async flushBatch(updates: SessionActivity[]): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.updateSessions(manager, updates);
      await this.updateUsers(manager, updates);
    });
    await this.activity.deleteKeys(updates.map((update) => update.key));
  }

  @CronSafe('*/1 * * * *')
  async flush(): Promise<void> {
    const updates = await this.activity.scanSessionActivities();
    for (
      let i = 0;
      i < updates.length;
      i += SESSION_ACTIVITY_FLUSH_BATCH_SIZE
    ) {
      const batch = updates.slice(i, i + SESSION_ACTIVITY_FLUSH_BATCH_SIZE);
      try {
        await this.flushBatch(batch);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.debug(`Session activity flush failed: ${message}`);
      }
    }
  }
}
