import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProductImages1789650000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE product_image (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "productId" uuid NOT NULL REFERENCES product(id) ON DELETE CASCADE, data bytea NOT NULL, mime varchar(32) NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')), sha256 varchar(64) NOT NULL, width integer NOT NULL CHECK(width > 0), height integer NOT NULL CHECK(height > 0), "byteLength" integer NOT NULL CHECK("byteLength" > 0 AND "byteLength" <= 8388608), "createdAt" timestamptz NOT NULL DEFAULT now())`,
    );
    await q.query(
      `CREATE INDEX product_image_product ON product_image("productId")`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    // Remove only references owned by this table; retain legacy static photos.
    await q.query(
      `UPDATE product SET images = COALESCE((SELECT jsonb_agg(value ORDER BY ordinal) FROM jsonb_array_elements(images) WITH ORDINALITY AS photo(value, ordinal) WHERE (value #>> '{}') NOT LIKE '/shop/images/%'), '[]'::jsonb)`,
    );
    await q.query('DROP TABLE product_image');
  }
}
