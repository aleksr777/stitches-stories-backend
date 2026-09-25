import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSocialIdentities1790250000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE "social_identity" (
      "id" SERIAL PRIMARY KEY,
      "provider" varchar(16) NOT NULL CHECK ("provider" IN ('yandex', 'vk')),
      "subject" varchar(255) NOT NULL,
      "userId" integer NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      UNIQUE ("provider", "subject"), UNIQUE ("userId", "provider")
    )`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE "social_identity"');
  }
}
