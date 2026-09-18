import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Request } from 'express';
import { Server } from 'node:http';
import request from 'supertest';
import sharp from 'sharp';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { ErrorsService } from '../src/common/errors-service/errors.service';
import { RolesGuard } from '../src/common/guards/roles.guard';
import {
  ShopAdminController,
  ShopController,
} from '../src/shop/shop.controller';
import { OptionalJwtGuard, ShopWriteGuard } from '../src/shop/shop.guards';
import { ShopService } from '../src/shop/shop.service';
import { SubscriptionService } from '../src/shop/subscription.service';
import { MAX_PRODUCT_IMAGE_BYTES } from '../src/shop/product-upload';

describe('Product photo HTTP boundary', () => {
  let app: INestApplication;
  let png: Buffer;
  const id = '11111111-1111-4111-8111-111111111111';
  const product = {
    slug: 'test-photo',
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
    active: false,
    isDemo: false,
  };
  const shop = {
    saveProduct: jest.fn(),
    removeProduct: jest.fn(),
    image: jest.fn(),
  };
  beforeAll(async () => {
    png = await sharp({
      create: { width: 3, height: 4, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    const module = await Test.createTestingModule({
      controllers: [ShopController, ShopAdminController],
      providers: [
        { provide: ShopService, useValue: shop },
        { provide: SubscriptionService, useValue: {} },
        RolesGuard,
        ErrorsService,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(ctx: ExecutionContext) {
          const req = ctx.switchToHttp().getRequest<Request>();
          if (!req.headers.authorization) throw new UnauthorizedException();
          req.user = {
            role:
              req.headers.authorization === 'Bearer administrator'
                ? 'admin'
                : 'user',
          };
          return true;
        },
      })
      .overrideGuard(OptionalJwtGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ShopWriteGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });
  beforeEach(() => {
    shop.saveProduct
      .mockReset()
      .mockResolvedValue({ ...product, id, images: ['/shop/images/' + id] });
    shop.removeProduct.mockReset().mockResolvedValue({ deleted: true });
    shop.image.mockReset().mockResolvedValue({
      id,
      data: png,
      mime: 'image/png',
      sha256: 'a'.repeat(64),
    });
  });
  afterAll(async () => {
    await app?.close();
  });
  it('accepts multipart files and typed JSON together through the real Nest interceptor', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/shop/admin/products')
      .set('Authorization', 'Bearer administrator')
      .field('data', JSON.stringify(product))
      .attach('files', png, 'photo.png')
      .expect(201);
    const [body, target, files] = shop.saveProduct.mock.calls[0] as [
      typeof product,
      undefined,
      Array<{ buffer: Buffer }>,
    ];
    expect(body).toMatchObject({
      active: false,
      isDemo: false,
      priceRub: 1200,
    });
    expect(target).toBeUndefined();
    expect(files[0].buffer).toEqual(png);
    await request(app.getHttpServer() as Server)
      .patch('/api/shop/admin/products/' + id)
      .set('Authorization', 'Bearer administrator')
      .send({ ...product, images: [] })
      .expect(200);
    expect(shop.saveProduct).toHaveBeenLastCalledWith(
      expect.objectContaining({ images: [] }),
      id,
      undefined,
    );
  });
  it('rejects guests and ordinary users before accepting uploads or private image reads', async () => {
    for (const [token, status] of [
      ['', 401],
      ['Bearer customer', 403],
    ] as const) {
      await request(app.getHttpServer() as Server)
        .post('/api/shop/admin/products')
        .set('Authorization', token)
        .field('data', JSON.stringify(product))
        .attach('files', png, 'photo.png')
        .expect(status);
      await request(app.getHttpServer() as Server)
        .get('/api/shop/admin/images/' + id)
        .set('Authorization', token)
        .expect(status);
      await request(app.getHttpServer() as Server)
        .delete('/api/shop/admin/products/' + id)
        .set('Authorization', token)
        .expect(status);
    }
    expect(shop.saveProduct).not.toHaveBeenCalled();
    expect(shop.removeProduct).not.toHaveBeenCalled();
    expect(shop.image).not.toHaveBeenCalled();
  });
  it('lets only the administrator delete a product', async () => {
    await request(app.getHttpServer() as Server)
      .delete('/api/shop/admin/products/' + id)
      .set('Authorization', 'Bearer administrator')
      .expect(200)
      .expect({ deleted: true });
    expect(shop.removeProduct).toHaveBeenCalledWith(id);
  });
  it('rejects excessive uploads and invalid metadata without calling persistence', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/shop/admin/products')
      .set('Authorization', 'Bearer administrator')
      .field('data', JSON.stringify(product))
      .attach('files', Buffer.alloc(MAX_PRODUCT_IMAGE_BYTES + 1), 'large.png')
      .expect(413);
    await request(app.getHttpServer() as Server)
      .post('/api/shop/admin/products')
      .set('Authorization', 'Bearer administrator')
      .field('data', JSON.stringify({ ...product, active: 'false' }))
      .expect(400);
    await request(app.getHttpServer() as Server)
      .post('/api/shop/admin/products')
      .set('Authorization', 'Bearer administrator')
      .field('data', '{')
      .expect(400);
    expect(shop.saveProduct).not.toHaveBeenCalled();
  });
  it('returns original binary bytes and safe headers, with separate administrator access', async () => {
    const result = await request(app.getHttpServer() as Server)
      .get('/api/shop/images/' + id)
      .expect(200)
      .expect('Content-Type', 'image/png')
      .expect('X-Content-Type-Options', 'nosniff')
      .expect('Cache-Control', 'private, no-cache');
    expect(result.body).toEqual(png);
    expect(shop.image).toHaveBeenCalledWith(id);
    await request(app.getHttpServer() as Server)
      .get('/api/shop/images/' + id)
      .set('If-None-Match', result.headers.etag)
      .expect(304);
    await request(app.getHttpServer() as Server)
      .get('/api/shop/admin/images/' + id)
      .set('Authorization', 'Bearer administrator')
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(shop.image).toHaveBeenCalledWith(id, true);
    await request(app.getHttpServer() as Server)
      .get('/api/shop/images/not-a-uuid')
      .expect(400);
  });
});
