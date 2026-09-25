import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveUserAge1790361000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE "user" DROP COLUMN IF EXISTS "age"');
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE "user" ADD COLUMN "age" smallint');
    await runner.query(
      'ALTER TABLE "user" ADD CONSTRAINT "CHK_user_age_range" CHECK ("age" IS NULL OR "age" BETWEEN 0 AND 200)',
    );
  }
}
