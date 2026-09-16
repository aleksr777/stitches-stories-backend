import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveTotpMfa1789408000000 implements MigrationInterface {
  name = 'RemoveTotpMfa1789408000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "user" DROP COLUMN IF EXISTS "mfa_totp_enabled"',
    );
    await queryRunner.query(
      'ALTER TABLE "user" DROP COLUMN IF EXISTS "mfa_totp_secret"',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "user" ADD COLUMN "mfa_totp_secret" varchar(512)',
    );
    await queryRunner.query(
      'ALTER TABLE "user" ADD COLUMN "mfa_totp_enabled" boolean NOT NULL DEFAULT false',
    );
  }
}
