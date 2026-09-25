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
import { DeliveryAddressController } from '../src/shop/delivery-address.controller';
import { DeliveryAddressService } from '../src/shop/delivery-address.service';
import { CustomerOnlyGuard } from '../src/shop/shop.guards';

describe('Saved delivery address HTTP access', () => {
  let app: INestApplication;
  const addresses = {
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 'saved-id' }),
    update: jest.fn().mockResolvedValue({ id: 'saved-id' }),
    remove: jest.fn().mockResolvedValue({ deleted: true }),
  };
  const address = { city: 'Заречный', street: 'Ленина', house: '12' };
  const id = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DeliveryAddressController],
      providers: [
        { provide: DeliveryAddressService, useValue: addresses },
        CustomerOnlyGuard,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest<Request>();
          if (!req.headers.authorization) throw new UnauthorizedException();
          req.user = {
            id: 7,
            role:
              req.headers.authorization === 'Bearer admin' ? 'admin' : 'user',
          };
          return true;
        },
      })
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
  beforeEach(() => jest.clearAllMocks());

  it('requires a customer session for listing, creating, editing and deleting', async () => {
    for (const method of ['get', 'post', 'put', 'delete'] as const) {
      const path =
        '/api/shop/me/addresses' +
        (['put', 'delete'].includes(method) ? '/' + id : '');
      await request(app.getHttpServer() as Server)
        [method](path)
        .send(address)
        .expect(401);
      await request(app.getHttpServer() as Server)
        [method](path)
        .set('Authorization', 'Bearer admin')
        .send(address)
        .expect(403);
    }
    expect(addresses.create).not.toHaveBeenCalled();
  });

  it('validates the whole address and routes every operation to the current owner', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/shop/me/addresses')
      .set('Authorization', 'Bearer user')
      .send({ ...address, city: '  Заречный  ', unexpected: 'ignored' })
      .expect(400);
    await request(app.getHttpServer() as Server)
      .post('/api/shop/me/addresses')
      .set('Authorization', 'Bearer user')
      .send({ ...address, postalCode: '12345' })
      .expect(400);
    await request(app.getHttpServer() as Server)
      .post('/api/shop/me/addresses')
      .set('Authorization', 'Bearer user')
      .send({ ...address, city: '  Заречный  ' })
      .expect(201);
    expect(addresses.create).toHaveBeenCalledWith(
      7,
      expect.objectContaining(address),
    );
    await request(app.getHttpServer() as Server)
      .put('/api/shop/me/addresses/' + id)
      .set('Authorization', 'Bearer user')
      .send(address)
      .expect(200);
    expect(addresses.update).toHaveBeenCalledWith(
      7,
      id,
      expect.objectContaining(address),
    );
    await request(app.getHttpServer() as Server)
      .delete('/api/shop/me/addresses/' + id)
      .set('Authorization', 'Bearer user')
      .expect(200);
    expect(addresses.remove).toHaveBeenCalledWith(7, id);
  });
});
