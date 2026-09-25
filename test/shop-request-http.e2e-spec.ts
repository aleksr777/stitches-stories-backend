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
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { SecurityConfigService } from '../src/common/security/security-config.service';
import { ShopController } from '../src/shop/shop.controller';
import { CustomerOnlyGuard, ShopWriteGuard } from '../src/shop/shop.guards';
import { ShopService } from '../src/shop/shop.service';
import { SubscriptionService } from '../src/shop/subscription.service';

describe('Purchase request HTTP access', () => {
  let app: INestApplication;
  const shop = {
    createRequest: jest.fn().mockResolvedValue({ id: 'request-id' }),
  };
  const body = {
    requestKey: '11111111-1111-4111-8111-111111111111',
    name: 'Тестовый покупатель',
    email: 'buyer@example.test',
    city: 'Заречный',
    items: [
      {
        productId: '22222222-2222-4222-8222-222222222222',
        quantity: 1,
        expectedPriceRub: 1200,
      },
    ],
    document: { id: 'offer', version: 'draft-v1', sha256: 'a'.repeat(64) },
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ShopController],
      providers: [
        { provide: ShopService, useValue: shop },
        { provide: SubscriptionService, useValue: {} },
        {
          provide: SecurityConfigService,
          useValue: {
            getRefreshCookieSecure: () => false,
            getRefreshCookieSameSite: () => 'lax',
          },
        },
        CustomerOnlyGuard,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest<Request>();
          const header = req.headers.authorization;
          if (
            !['Bearer customer', 'Bearer administrator'].includes(header ?? '')
          )
            throw new UnauthorizedException();
          req.user = {
            id: 123,
            role: header === 'Bearer administrator' ? 'admin' : 'user',
          };
          return true;
        },
      })
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
  afterAll(async () => app?.close());
  beforeEach(() => shop.createRequest.mockClear());

  it('allows requests only from an authenticated customer account', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/shop/requests')
      .send(body)
      .expect(401);
    await request(app.getHttpServer() as Server)
      .post('/api/shop/requests')
      .set('Authorization', 'Bearer administrator')
      .send(body)
      .expect(403);
    await request(app.getHttpServer() as Server)
      .post('/api/shop/requests')
      .set('Authorization', 'Bearer customer')
      .send(body)
      .expect(201, { id: 'request-id' });
    expect(shop.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({ requestKey: body.requestKey }),
      123,
      'user',
    );
  });

  it('validates nested delivery details and rejects extra address fields', async () => {
    for (const deliveryAddress of [
      { city: 'Заречный', street: '', house: '12' },
      { city: 'Заречный', street: 'Ленина', house: '12', postalCode: '12345' },
      { city: 'Заречный', street: 'Ленина', house: '12', userId: 99 },
    ]) {
      await request(app.getHttpServer() as Server)
        .post('/api/shop/requests')
        .set('Authorization', 'Bearer customer')
        .send({ ...body, deliveryAddress })
        .expect(400);
    }
    expect(shop.createRequest).not.toHaveBeenCalled();
    await request(app.getHttpServer() as Server)
      .post('/api/shop/requests')
      .set('Authorization', 'Bearer customer')
      .send({
        ...body,
        deliveryAddress: { city: 'Заречный', street: 'Ленина', house: '12' },
        saveAddress: true,
      })
      .expect(201);
    expect(shop.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({ saveAddress: true }),
      123,
      'user',
    );
  });
});
