import {
  BadRequestException,
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
import { ErrorsService } from '../src/common/errors-service/errors.service';
import { OptionalJwtGuard, ShopWriteGuard } from '../src/shop/shop.guards';
import {
  AdminPaymentController,
  PaymentController,
} from '../src/shop/payments/payment.controller';
import { PaymentConfigService } from '../src/shop/payments/payment-config.service';
import { PaymentService } from '../src/shop/payments/payment.service';
import {
  parseNotification,
  verifyNotification,
} from '../src/shop/payments/robokassa';
import {
  notification,
  paymentFixture,
  testAccount,
} from './helpers/payment-fixture';

describe('SBP HTTP permissions and callback validation', () => {
  let app: INestApplication;
  const invoice = paymentFixture();
  const service = {
    issue: jest.fn().mockResolvedValue({ id: invoice.id }),
    adminView: jest.fn().mockResolvedValue(null),
    view: jest.fn().mockResolvedValue({ id: invoice.id }),
    start: jest.fn().mockResolvedValue({
      action: 'https://auth.robokassa.ru/Merchant/Index.aspx',
    }),
    receive: jest.fn((body: unknown) => {
      const value = parseNotification(body);
      if (!verifyNotification(value, invoice, testAccount))
        throw new BadRequestException();
      return 'OK' + invoice.number;
    }),
  };
  const authenticate = (context: ExecutionContext, optional = false) => {
    const req = context.switchToHttp().getRequest<Request>();
    const value = req.headers.authorization;
    if (!value && optional) return true;
    if (!['Bearer admin', 'Bearer customer'].includes(value ?? ''))
      throw new UnauthorizedException();
    req.user = { id: 123, role: value === 'Bearer admin' ? 'admin' : 'user' };
    return true;
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PaymentController, AdminPaymentController],
      providers: [
        ErrorsService,
        { provide: PaymentService, useValue: service },
        {
          provide: PaymentConfigService,
          useValue: { publicConfig: () => ({ enabled: false }) },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => authenticate(context),
      })
      .overrideGuard(OptionalJwtGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => authenticate(context, true),
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
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => jest.clearAllMocks());
  it('protects merchant settings and invoice creation with the real roles guard', async () => {
    const url = '/api/shop/admin/requests/' + invoice.orderId + '/payment';
    const body = { deliveryRub: 0, fulfillment: 'Самовывоз через 5 дней.' };
    await request(app.getHttpServer() as Server)
      .post(url)
      .send(body)
      .expect(401);
    await request(app.getHttpServer() as Server)
      .post(url)
      .set('Authorization', 'Bearer customer')
      .send(body)
      .expect(403);
    await request(app.getHttpServer() as Server)
      .post(url)
      .set('Authorization', 'Bearer admin')
      .send(body)
      .expect(201);
    expect(service.issue).toHaveBeenCalledTimes(1);
    await request(app.getHttpServer() as Server)
      .get('/api/shop/admin/payments/config')
      .expect(401);
  });
  it('rejects owner payment, forged totals, keys, and incomplete contract acceptance', async () => {
    const url = '/api/shop/payments/' + invoice.id + '/start';
    await request(app.getHttpServer() as Server)
      .post(url)
      .set('Authorization', 'Bearer admin')
      .send({})
      .expect(403);
    await request(app.getHttpServer() as Server)
      .post(url)
      .send({ accessToken: 'x', documents: [] })
      .expect(400);
    const documents = ['offer', 'payment', 'returns', 'seller'].map((id) => ({
      id,
      version: 'v1',
      sha256: 'a'.repeat(64),
    }));
    await request(app.getHttpServer() as Server)
      .post(url)
      .send({
        accessToken: 'a'.repeat(64),
        documents,
        amountRub: 1,
        merchantLogin: 'attacker',
      })
      .expect(400);
    expect(service.start).not.toHaveBeenCalled();
    await request(app.getHttpServer() as Server)
      .post(url)
      .send({ accessToken: 'a'.repeat(64), documents })
      .expect(200)
      .expect('Cache-Control', 'no-store');
  });
  it('accepts form-encoded signed ResultURL without a customer session and rejects forgeries', async () => {
    const body = notification(invoice);
    const url = '/api/shop/payments/robokassa/result';
    await request(app.getHttpServer() as Server)
      .post(url)
      .type('form')
      .send(body)
      .expect(200, 'OK' + invoice.number);
    await request(app.getHttpServer() as Server)
      .post(url)
      .type('form')
      .send({ ...body, SignatureValue: '0'.repeat(64) })
      .expect(400);
    await request(app.getHttpServer() as Server)
      .post(url)
      .type('form')
      .send({ ...body, OutSum: '1.00' })
      .expect(400);
  });
});
