import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProductCategories1790085600000
  implements MigrationInterface
{
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE product_category (id varchar(36) PRIMARY KEY, name varchar(100) NOT NULL, "nameKey" varchar(100) NOT NULL)`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_product_category_name_key" ON product_category ("nameKey")`,
    );
    await q.query(
      `INSERT INTO product_category (id, name, "nameKey") VALUES ('keychains', 'Брелоки', 'брелоки'), ('covers', 'Обложки на паспорт', 'обложки на паспорт')`,
    );
    await q.query(`ALTER TABLE product DROP CONSTRAINT product_category_check`);
    await q.query(
      `ALTER TABLE product ALTER COLUMN category TYPE varchar(36), ALTER COLUMN category DROP NOT NULL`,
    );
    await q.query(
      `ALTER TABLE product ADD CONSTRAINT "FK_product_category" FOREIGN KEY (category) REFERENCES product_category(id) ON DELETE RESTRICT ON UPDATE RESTRICT`,
    );
    await q.query(`CREATE INDEX "IDX_product_category" ON product(category)`);
  }

  async down(q: QueryRunner): Promise<void> {
    const incompatible = (await q.query(
      `SELECT 1 FROM product WHERE category IS NULL OR category NOT IN ('keychains', 'covers') LIMIT 1`,
    )) as unknown[];
    if (incompatible.length)
      throw new Error(
        'Перед откатом перенесите все изделия в категории keychains или covers.',
      );
    await q.query(`ALTER TABLE product DROP CONSTRAINT "FK_product_category"`);
    await q.query(`DROP INDEX "IDX_product_category"`);
    await q.query(
      `ALTER TABLE product ALTER COLUMN category TYPE varchar(30), ALTER COLUMN category SET NOT NULL`,
    );
    await q.query(
      `ALTER TABLE product ADD CONSTRAINT product_category_check CHECK(category IN ('keychains','covers'))`,
    );
    await q.query(`DROP TABLE product_category`);
  }
}
