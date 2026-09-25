import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { RemoveUserAge1790361000000 } from '../src/migrations/1790361000000-RemoveUserAge';

const url = process.env.TEST_DATABASE_URL;

(url ? describe : describe.skip)(
  'Age removal from existing PostgreSQL accounts',
  () => {
    it('removes stored ages while preserving the accounts and their contacts', async () => {
      const schema = `remove_age_${randomUUID().replace(/-/g, '')}`;
      const db = await new DataSource({ type: 'postgres', url }).initialize();
      const runner = db.createQueryRunner();
      try {
        await runner.connect();
        await runner.query(`CREATE SCHEMA "${schema}"`);
        await runner.query(`SET search_path TO "${schema}"`);
        await runner.query(
          'CREATE TABLE "user" (id serial PRIMARY KEY, email text NOT NULL, age smallint)',
        );
        await runner.query('INSERT INTO "user" (email, age) VALUES ($1, $2)', [
          'buyer@example.test',
          42,
        ]);

        await new RemoveUserAge1790361000000().up(runner);

        expect(await runner.query('SELECT id, email FROM "user"')).toEqual([
          { id: 1, email: 'buyer@example.test' },
        ]);
        const columnsUnknown: unknown = await runner.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'user'`,
          [schema],
        );
        if (!Array.isArray(columnsUnknown))
          throw new Error('Unexpected column data');
        const columns = columnsUnknown as Array<{ column_name: string }>;
        expect(columns.map(({ column_name }) => column_name)).not.toContain(
          'age',
        );
      } finally {
        if (!runner.isReleased) await runner.release();
        await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await db.destroy();
      }
    });
  },
);
