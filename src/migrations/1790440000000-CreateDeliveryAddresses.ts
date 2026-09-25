import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDeliveryAddresses1790440000000
  implements MigrationInterface
{
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE "delivery_address" (
      "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      "userId" integer NOT NULL,
      "region" varchar(150),
      "city" varchar(150) NOT NULL,
      "street" varchar(200) NOT NULL,
      "house" varchar(40) NOT NULL,
      "apartment" varchar(40),
      "postalCode" varchar(6),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_delivery_address_user" FOREIGN KEY ("userId")
        REFERENCES "user"("id") ON DELETE CASCADE
    )`);
    await runner.query(
      'CREATE INDEX "IDX_delivery_address_user" ON "delivery_address" ("userId")',
    );
    await runner.query(
      'ALTER TABLE "order_request" ADD COLUMN "deliveryAddress" jsonb',
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE "order_request" DROP COLUMN "deliveryAddress"',
    );
    await runner.query('DROP TABLE "delivery_address"');
  }
}
