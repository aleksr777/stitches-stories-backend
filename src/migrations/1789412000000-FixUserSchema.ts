import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixUserSchema1789412000000 implements MigrationInterface {
  name = 'FixUserSchema1789412000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM "user"
          WHERE "age" IS NOT NULL
            AND (
              btrim("age"::text) !~ '^[0-9]{1,3}$'
              OR btrim("age"::text)::integer NOT BETWEEN 0 AND 200
            )
        ) THEN
          RAISE EXCEPTION 'Cannot migrate user.age: values must be integers from 0 to 200';
        END IF;
      END
      $$
    `);

    await queryRunner.query(`
      ALTER TABLE "user"
      ALTER COLUMN "age" TYPE smallint
      USING CASE
        WHEN "age" IS NULL THEN NULL
        ELSE btrim("age"::text)::smallint
      END
    `);

    await queryRunner.query(
      'ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "CHK_user_age_range"',
    );
    await queryRunner.query(
      'ALTER TABLE "user" ADD CONSTRAINT "CHK_user_age_range" CHECK ("age" IS NULL OR "age" BETWEEN 0 AND 200)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "CHK_user_age_range"',
    );
    await queryRunner.query(`
      ALTER TABLE "user"
      ALTER COLUMN "age" TYPE varchar(200)
      USING "age"::text
    `);
  }
}
