import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { LegalService } from '../src/legal/legal.service';
import { CreateShop1789560000000 } from '../src/migrations/1789560000000-CreateShop';
import { CreateProductImages1789650000000 } from '../src/migrations/1789650000000-CreateProductImages';
import { CreateProductCategories1790085600000 } from '../src/migrations/1790085600000-CreateProductCategories';
import { CategoryService } from '../src/shop/category.service';
import { Product, shopEntities } from '../src/shop/shop.entities';
import { ProductDto } from '../src/shop/shop.dto';
import { ShopService } from '../src/shop/shop.service';

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'Categories on a migrated PostgreSQL database',
  () => {
    const schema = 'categories_test_' + randomUUID().replace(/-/g, '');
    let control: DataSource;
    let db: DataSource;
    let runner: QueryRunner;
    let categories: CategoryService;
    let shop: ShopService;
    let legacy: Product;
    const data = (category: string | null): ProductDto => ({
      slug: 'test-' + randomUUID(),
      name: 'Вышитое панно',
      category,
      priceRub: 2500,
      description: 'Панно с ручной вышивкой',
      materials: 'Лён',
      dimensions: '20 × 20 см',
      productionTime: 'По согласованию',
      images: [],
      stock: 1,
      active: false,
      featured: false,
      isDemo: true,
    });
    beforeAll(async () => {
      control = await new DataSource({ type: 'postgres', url }).initialize();
      await control.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
      await control.query(`CREATE SCHEMA "${schema}"`);
      db = await new DataSource({
        type: 'postgres',
        url,
        schema,
        entities: shopEntities,
        synchronize: false,
      }).initialize();
      runner = db.createQueryRunner();
      await runner.connect();
      await runner.query(`SET search_path TO "${schema}", public`);
      await runner.query(`CREATE TABLE "user" (id integer PRIMARY KEY)`);
      await new CreateShop1789560000000().up(runner);
      await new CreateProductImages1789650000000().up(runner);
      legacy = await runner.manager.getRepository(Product).save(data('covers'));
      await new CreateProductCategories1790085600000().up(runner);
      categories = new CategoryService(db);
      shop = new ShopService(db, {} as LegalService);
    });
    afterAll(async () => {
      await runner?.release();
      if (db?.isInitialized) await db.destroy();
      if (control?.isInitialized) {
        await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await control.destroy();
      }
    });

    it('preserves existing products and category links during migration', async () => {
      expect(
        (await db.getRepository(Product).findOneByOrFail({ id: legacy.id }))
          .category,
      ).toBe('covers');
      expect(await categories.list()).toEqual(
        expect.arrayContaining([
          { id: 'covers', name: 'Обложки на паспорт' },
          { id: 'keychains', name: 'Брелоки' },
        ]),
      );
    });

    it('renames a category without changing its ID or its products', async () => {
      const category = await categories.save({ name: 'Панно' });
      const product = await shop.saveProduct(data(category.id));
      await categories.save({ name: 'Картины с вышивкой' }, category.id);
      expect(
        (await categories.list()).find((item) => item.id === category.id)?.name,
      ).toBe('Картины с вышивкой');
      expect(
        (await db.getRepository(Product).findOneByOrFail({ id: product.id }))
          .category,
      ).toBe(category.id);
    });

    it('counts hidden/demo products and rejects deletion until the last product moves', async () => {
      const category = await categories.save({ name: 'Текстиль' });
      const product = await shop.saveProduct(data(category.id));
      expect(
        (await categories.adminList()).find((item) => item.id === category.id)
          ?.productCount,
      ).toBe(1);
      await expect(categories.remove(category.id)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await shop.saveProduct({ ...data(null), slug: product.slug }, product.id);
      await expect(categories.remove(category.id)).resolves.toEqual({
        deleted: true,
      });
      expect(
        (await db.getRepository(Product).findOneByOrFail({ id: product.id }))
          .category,
      ).toBeNull();
      await expect(categories.remove(category.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects normalized duplicate names and renaming to an existing name', async () => {
      const category = await categories.save({
        name: '  Подарочные   наборы  ',
      });
      await expect(
        categories.save({ name: 'подарочные наборы' }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        categories.save({ name: 'БРЕЛОКИ' }, category.id),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        categories.save({ name: 'Нет' }, randomUUID()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects unknown product categories and permits uncategorized products', async () => {
      await expect(shop.saveProduct(data(randomUUID()))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      const dto = data(null);
      delete dto.category;
      expect((await shop.saveProduct(dto)).category).toBeNull();
    });

    it('cannot leave an orphan category reference when saving and deleting concurrently', async () => {
      const category = await categories.save({
        name: 'Одновременное сохранение',
      });
      const dto = data(category.id);
      const results = await Promise.allSettled([
        shop.saveProduct(dto),
        categories.remove(category.id),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const saved = await db
        .getRepository(Product)
        .findOneBy({ slug: dto.slug });
      const remaining = (await categories.list()).some(
        (item) => item.id === category.id,
      );
      if (saved) expect(remaining).toBe(true);
      else expect(remaining).toBe(false);
    });

    it('refuses a rollback that would discard new product assignments', async () => {
      await expect(
        new CreateProductCategories1790085600000().down(runner),
      ).rejects.toThrow('Перед откатом');
      expect((await categories.list()).length).toBeGreaterThan(0);
    });
  },
);
