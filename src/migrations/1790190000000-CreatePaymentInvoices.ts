import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePaymentInvoices1790190000000 implements MigrationInterface {
  name = 'CreatePaymentInvoices1790190000000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE "payment_invoice" (
      "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "number" BIGSERIAL NOT NULL UNIQUE,
      "orderId" uuid NOT NULL UNIQUE REFERENCES "order_request"("id") ON DELETE RESTRICT,
      "accountId" varchar(64) NOT NULL, "merchantLogin" varchar(100) NOT NULL, "isTest" boolean NOT NULL,
      "sellerName" varchar(200) NOT NULL, "sellerInn" varchar(12) NOT NULL,
      "status" varchar(20) NOT NULL DEFAULT 'ready', "items" jsonb NOT NULL,
      "subtotalRub" integer NOT NULL, "deliveryRub" integer NOT NULL, "amountRub" integer NOT NULL,
      "fulfillment" varchar(1000) NOT NULL, "documents" jsonb NOT NULL,
      "acceptedDocuments" jsonb, "acceptedByUserId" integer, "acceptedAt" timestamptz,
      "stockReserved" boolean NOT NULL DEFAULT false, "expiresAt" timestamptz NOT NULL,
      "paidAt" timestamptz, "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CHK_payment_amount" CHECK ("amountRub" = "subtotalRub" + "deliveryRub" AND "subtotalRub" > 0 AND "deliveryRub" >= 0 AND "amountRub" <= 1000000)
    )`);
    await runner.query(
      'CREATE INDEX "IDX_payment_invoice_expiry" ON "payment_invoice" ("status", "expiresAt")',
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE "payment_invoice"');
  }
}
