import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateShop1789560000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE legal_document (id varchar(80) NOT NULL, version varchar(100) NOT NULL, sha256 varchar(64) NOT NULL, content jsonb NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(id,version))`,
    );
    await q.query(
      `CREATE TABLE consent_event (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "userId" integer, "subscriptionId" uuid, "documentId" varchar(80) NOT NULL, version varchar(100) NOT NULL, sha256 varchar(64) NOT NULL, purpose varchar(60) NOT NULL, action varchar(20) NOT NULL CHECK(action IN ('grant','accept','withdraw')), source varchar(60) NOT NULL, verification varchar(80) NOT NULL, "documentStatus" varchar(16) NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), FOREIGN KEY("documentId",version) REFERENCES legal_document(id,version))`,
    );
    await q.query(
      `CREATE INDEX consent_event_user_time ON consent_event("userId","createdAt")`,
    );
    await q.query(
      `CREATE TABLE product (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), slug varchar(100) NOT NULL UNIQUE, name varchar(200) NOT NULL, category varchar(30) NOT NULL CHECK(category IN ('keychains','covers')), "priceRub" integer NOT NULL CHECK("priceRub">0), description text NOT NULL, materials varchar(250) NOT NULL, dimensions varchar(100) NOT NULL, "productionTime" varchar(160) NOT NULL, images jsonb NOT NULL DEFAULT '[]', stock integer NOT NULL DEFAULT 0 CHECK(stock>=0), featured boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true, "isDemo" boolean NOT NULL DEFAULT true, "updatedAt" timestamptz NOT NULL DEFAULT now())`,
    );
    await q.query(
      `CREATE TABLE order_request (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "requestKey" uuid NOT NULL UNIQUE, "payloadHash" varchar(64) NOT NULL, "userId" integer, name varchar(200) NOT NULL, email varchar(255) NOT NULL, phone varchar(30), city varchar(150) NOT NULL, comment varchar(1500) NOT NULL DEFAULT '', items jsonb NOT NULL, "subtotalRub" integer NOT NULL CHECK("subtotalRub">0), status varchar(20) NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','agreed','closed')), document jsonb NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now())`,
    );
    await q.query(
      `CREATE INDEX order_request_user_time ON order_request("userId","createdAt")`,
    );
    await q.query(
      `CREATE TABLE favorite ("userId" integer NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, "productId" uuid NOT NULL REFERENCES product(id) ON DELETE CASCADE, PRIMARY KEY("userId","productId"))`,
    );
    await q.query(
      `CREATE TABLE subscription (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), email varchar(255) NOT NULL UNIQUE, "userId" integer REFERENCES "user"(id) ON DELETE SET NULL, active boolean NOT NULL DEFAULT false, "activeUntil" timestamptz, "tokenHash" varchar(64), "tokenExpiresAt" timestamptz, "unsubscribeHash" varchar(64), documents jsonb NOT NULL, "updatedAt" timestamptz NOT NULL DEFAULT now())`,
    );
    await q.query(
      `CREATE INDEX subscription_token ON subscription("tokenHash")`,
    );
    await q.query(
      `CREATE INDEX subscription_unsubscribe ON subscription("unsubscribeHash")`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    for (const table of [
      'subscription',
      'favorite',
      'order_request',
      'product',
      'consent_event',
      'legal_document',
    ])
      await q.query('DROP TABLE ' + table);
  }
}
