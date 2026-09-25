import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveUserNickname1790360000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE "user" DROP COLUMN IF EXISTS "nickname"');
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE "user" ADD COLUMN "nickname" varchar(50)');
    await runner.query(
      'ALTER TABLE "user" ADD CONSTRAINT "UQ_user_nickname" UNIQUE ("nickname")',
    );
  }
}
