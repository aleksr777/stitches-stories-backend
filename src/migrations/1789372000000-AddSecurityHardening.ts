import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSecurityHardening1789372000000 implements MigrationInterface {
  name = 'AddSecurityHardening1789372000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "user" ADD COLUMN "mfa_totp_secret" varchar(512)',
    );
    await queryRunner.query(
      'ALTER TABLE "user" ADD COLUMN "mfa_totp_enabled" boolean NOT NULL DEFAULT false',
    );
    await queryRunner.query(`
      CREATE TABLE "security_audit_event" (
        "id" BIGSERIAL NOT NULL,
        "event" varchar(64) NOT NULL,
        "success" boolean NOT NULL DEFAULT true,
        "user_id" integer,
        "session_id" uuid,
        "ip_address" varchar(45),
        "user_agent" varchar(512),
        "details" jsonb,
        "occurred_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_security_audit_event" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_security_audit_event_occurred_at" ON "security_audit_event" ("occurred_at")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_security_audit_event_user_id" ON "security_audit_event" ("user_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_security_audit_event_event" ON "security_audit_event" ("event")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "security_audit_event"');
    await queryRunner.query(
      'ALTER TABLE "user" DROP COLUMN "mfa_totp_enabled"',
    );
    await queryRunner.query('ALTER TABLE "user" DROP COLUMN "mfa_totp_secret"');
  }
}
