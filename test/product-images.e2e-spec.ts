import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import sharp from 'sharp';
import {
  Favorite,
  OrderRequest,
  Product,
  ProductImage,
  shopEntities,
} from '../src/shop/shop.entities';
import { ShopService } from '../src/shop/shop.service';
import { ProductDto } from '../src/shop/shop.dto';
import { LegalService } from '../src/legal/legal.service';
import { ProductCategory } from '../src/shop/category.entity';
import { User } from '../src/users/entities/user.entity';

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)('Product images in PostgreSQL', () => {
  const schema = 'images_test_' + randomUUID().replace(/-/g, '');
  let control: DataSource;
  let db: DataSource;
  let shop: ShopService;
  let buffer: Buffer;
  const dto = (): ProductDto => ({
    slug: 'test-' + randomUUID(),
    name: 'Тестовая обложка',
    category: 'covers',
    priceRub: 1200,
    description: 'Обложка с ручной вышивкой',
    materials: 'Хлопок',
    dimensions: '10 × 15 см',
    productionTime: 'По согласованию',
    images: ['upload:0'],
    stock: 1,
    featured: false,
    active: true,
    isDemo: false,
  });
  beforeAll(async () => {
    control = await new DataSource({ type: 'postgres', url }).initialize();
    await control.query(`CREATE SCHEMA "${schema}"`);
    db = await new DataSource({
      type: 'postgres',
      url,
      schema,
      entities: [User, ...shopEntities],
      synchronize: true,
    }).initialize();
    shop = new ShopService(db, {} as LegalService);
    await db
      .getRepository(ProductCategory)
      .insert({ id: 'covers', name: 'Обложки', nameKey: 'обложки' });
    buffer = await sharp({
      create: { width: 3, height: 4, channels: 3, background: '#d9b7b1' },
    })
      .png()
      .toBuffer();
  });
  beforeEach(async () => {
    await db
      .getRepository(OrderRequest)
      .createQueryBuilder()
      .delete()
      .execute();
    await db.getRepository(Favorite).createQueryBuilder().delete().execute();
    await db.getRepository(Product).createQueryBuilder().delete().execute();
  });
  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (control?.isInitialized) {
      await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await control.destroy();
    }
  });
  it('saves bytes with the product, returns only URLs in the catalog and reads the original bytes back', async () => {
    const saved = await shop.saveProduct(dto(), undefined, [{ buffer }]);
    expect(saved.images[0]).toMatch(/^\/shop\/images\//);
    const image = await shop.image(saved.images[0].split('/').pop()!);
    expect(image.data).toEqual(buffer);
    expect(image.mime).toBe('image/png');
    expect(image.productId).toBe(saved.id);
    expect(
      (await db.getRepository(ProductImage).findOneByOrFail({ id: image.id }))
        .data,
    ).toBeUndefined();
    expect(JSON.stringify(await shop.products())).not.toContain('"data":');
  });
  it('creates neither a product nor orphan photos on invalid upload or duplicate slug', async () => {
    await expect(
      shop.saveProduct(dto(), undefined, [
        { buffer: Buffer.from('not a photo') },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await db.getRepository(Product).count()).toBe(0);
    expect(await db.getRepository(ProductImage).count()).toBe(0);
    const data = dto();
    await shop.saveProduct(data, undefined, [{ buffer }]);
    await expect(
      shop.saveProduct(data, undefined, [{ buffer }]),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await db.getRepository(Product).count()).toBe(1);
    expect(await db.getRepository(ProductImage).count()).toBe(1);
  });
  it('keeps selected images, changes the cover and deletes removed bytes in the same save', async () => {
    const data = dto();
    const first = await shop.saveProduct(
      { ...data, images: ['upload:0', 'upload:1'] },
      undefined,
      [{ buffer }, { buffer }],
    );
    const next = await shop.saveProduct(
      { ...data, images: [first.images[1], 'upload:0'] },
      first.id,
      [{ buffer }],
    );
    expect(next.images[0]).toBe(first.images[1]);
    expect(await db.getRepository(ProductImage).count()).toBe(2);
    await expect(
      shop.image(first.images[0].split('/').pop()!),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((await shop.image(next.images[1].split('/').pop()!)).data).toEqual(
      buffer,
    );
    await shop.saveProduct({ ...data, images: [] }, first.id);
    expect(await db.getRepository(ProductImage).count()).toBe(0);
  });
  it('protects hidden photos while allowing the administrator to preview them', async () => {
    const data = { ...dto(), active: false };
    const saved = await shop.saveProduct(data, undefined, [{ buffer }]);
    const id = saved.images[0].split('/').pop()!;
    await expect(shop.image(id)).rejects.toBeInstanceOf(NotFoundException);
    expect((await shop.image(id, true)).data).toEqual(buffer);
    await shop.saveProduct(
      { ...data, active: true, images: saved.images },
      saved.id,
    );
    expect((await shop.image(id)).data).toEqual(buffer);
  });
  it('deletes product photos and favorites but keeps request snapshots intact', async () => {
    const saved = await shop.saveProduct(dto(), undefined, [{ buffer }]);
    const imageId = saved.images[0].split('/').pop()!;
    await db.getRepository(Favorite).save({ userId: 7, productId: saved.id });
    const request = await db.getRepository(OrderRequest).save({
      requestKey: randomUUID(),
      payloadHash: 'a'.repeat(64),
      userId: null,
      name: 'Тестовая заявка',
      email: 'buyer@example.test',
      phone: null,
      city: 'Москва',
      comment: '',
      items: [
        {
          productId: saved.id,
          slug: saved.slug,
          name: saved.name,
          quantity: 1,
          priceRub: saved.priceRub,
        },
      ],
      subtotalRub: saved.priceRub,
      document: { id: 'offer', version: 'draft-v1', sha256: 'a'.repeat(64) },
    });

    await expect(shop.removeProduct(saved.id)).resolves.toEqual({
      deleted: true,
    });

    expect(await db.getRepository(Product).existsBy({ id: saved.id })).toBe(
      false,
    );
    expect(await db.getRepository(ProductImage).count()).toBe(0);
    expect(
      await db.getRepository(Favorite).countBy({ productId: saved.id }),
    ).toBe(0);
    expect(
      await db.getRepository(OrderRequest).countBy({ id: request.id }),
    ).toBe(1);
    await expect(shop.image(imageId, true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(shop.removeProduct(saved.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it('refuses references to another product and unmatched uploads', async () => {
    const saved = await shop.saveProduct(dto(), undefined, [{ buffer }]);
    await expect(
      shop.saveProduct({ ...dto(), images: saved.images }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      shop.saveProduct({ ...dto(), images: [] }, undefined, [{ buffer }]),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      shop.saveProduct({ ...dto(), images: ['upload:1'] }, undefined, [
        { buffer },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await db.getRepository(Product).count()).toBe(1);
    expect(await db.getRepository(ProductImage).count()).toBe(1);
  });
});
