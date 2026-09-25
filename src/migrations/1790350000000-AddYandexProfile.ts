import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddYandexProfile1790350000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE "user" ALTER COLUMN "email" DROP NOT NULL');
    await runner.query(
      'ALTER TABLE "user" ADD COLUMN "contact_email" varchar(255)',
    );
    await runner.query(
      'ALTER TABLE "user" ADD COLUMN "sex" varchar(6) CHECK ("sex" IN (\'male\', \'female\'))',
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE "user" DROP COLUMN "sex"');
    await runner.query('ALTER TABLE "user" DROP COLUMN "contact_email"');
    await runner.query('ALTER TABLE "user" ALTER COLUMN "email" SET NOT NULL');
  }
}
