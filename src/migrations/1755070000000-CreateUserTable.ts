import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserTable1755070000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user" (
        "id" SERIAL NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "last_activity_at" timestamp,
        "email" varchar(255) NOT NULL,
        "phone_number" varchar(30),
        "nickname" varchar(50),
        "password" varchar(100) NOT NULL,
        "role" varchar(20) NOT NULL DEFAULT 'user',
        "is_blocked" boolean NOT NULL DEFAULT false,
        "blocked_at" timestamp,
        "blocked_by" integer,
        "blocked_reason" varchar(255),
        "name" varchar(200),
        "age" varchar(200),
        CONSTRAINT "PK_user_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_user_email" UNIQUE ("email"),
        CONSTRAINT "UQ_user_nickname" UNIQUE ("nickname")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "user"');
  }
}
