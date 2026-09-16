import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { Response } from 'express';
import { LegalService } from '../src/legal/legal.service';
import { ConsentEvent, LegalDocumentEntity } from '../src/legal/legal.entities';
import {
  Product,
  OrderRequest,
  Subscription,
  shopEntities,
} from '../src/shop/shop.entities';
import { ShopService } from '../src/shop/shop.service';
import { SubscriptionService } from '../src/shop/subscription.service';
import { CreateRequestDto } from '../src/shop/shop.dto';
import { User } from '../src/users/entities/user.entity';
import { AuthSession } from '../src/auth/entities/auth-session.entity';
import { EnvService } from '../src/common/env-service/env.service';
import { MailService } from '../src/common/mail-service/mail.service';
import { CODE, createCredentialFixture } from './helpers/credential-fixture';

const url = process.env.TEST_DATABASE_URL;
const databaseTests = url ? describe : describe.skip;
databaseTests('Shop and consent persistence in PostgreSQL', () => {
  const schema = 'shop_test_' + randomUUID().replace(/-/g, '');
  let control: DataSource;
  let db: DataSource;
  let legal: LegalService;
  let shop: ShopService;
  let product: Product;
  let fixture: Awaited<ReturnType<typeof createCredentialFixture>>;
  const requestData = (): CreateRequestDto => ({
    requestKey: randomUUID(),
    name: 'Тестовый покупатель',
    email: 'buyer@example.test',
    city: 'Заречный',
    items: [{ productId: product.id, quantity: 1, expectedPriceRub: 1200 }],
    document: legal.get('offer'),
  });
  beforeAll(async () => {
    control = await new DataSource({ type: 'postgres', url }).initialize();
    await control.query(`CREATE SCHEMA "${schema}"`);
    db = await new DataSource({
      type: 'postgres',
      url,
      schema,
      entities: [
        User,
        AuthSession,
        LegalDocumentEntity,
        ConsentEvent,
        ...shopEntities,
      ],
      synchronize: true,
    }).initialize();
    legal = new LegalService(db);
    await legal.onModuleInit();
    shop = new ShopService(db, legal);
  });
  beforeEach(async () => {
    fixture = await createCredentialFixture(db);
    product = await db.getRepository(Product).save({
      slug: randomUUID(),
      name: 'Тестовая обложка',
      category: 'covers',
      priceRub: 1200,
      description: 'Для интеграционного теста',
      materials: 'Хлопок',
      dimensions: '10 × 15 см',
      productionTime: 'По согласованию',
      images: [],
      stock: 2,
      featured: false,
      active: true,
      isDemo: true,
    });
  });
  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (control?.isInitialized) {
      await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await control.destroy();
    }
  });
  it('commits one request when identical submissions arrive concurrently', async () => {
    const data = requestData();
    const [first, second] = await Promise.all([
      shop.createRequest(data, null),
      shop.createRequest(data, null),
    ]);
    expect(first.id).toBe(second.id);
    expect(first.subtotalRub).toBe(1200);
    expect(
      await db
        .getRepository(OrderRequest)
        .countBy({ requestKey: data.requestKey }),
    ).toBe(1);
    await expect(
      shop.createRequest({ ...data, name: 'Другой покупатель' }, null),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('rejects stale prices, unavailable quantities and duplicate product IDs', async () => {
    const data = requestData();
    await expect(
      shop.createRequest(
        { ...data, items: [{ ...data.items[0], expectedPriceRub: 1 }] },
        null,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      shop.createRequest(
        { ...data, items: [{ ...data.items[0], quantity: 3 }] },
        null,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      shop.createRequest(
        { ...data, items: [data.items[0], data.items[0]] },
        null,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      await db
        .getRepository(OrderRequest)
        .countBy({ requestKey: data.requestKey }),
    ).toBe(0);
  });
  it('keeps requests separate from other users and guest contact addresses', async () => {
    await shop.createRequest(requestData(), fixture.user.id);
    await shop.createRequest(requestData(), null);
    expect(await shop.requests(fixture.user.id)).toHaveLength(1);
    expect(await shop.requests(fixture.user.id + 10000)).toHaveLength(0);
  });
  it('creates the account and two consent records in the same registration transaction', async () => {
    const email = randomUUID() + '@example.test';
    const documents = [legal.get('pd-account'), legal.get('account-terms')];
    fixture.tokenMocks.consumeRegistrationCode.mockResolvedValueOnce({
      email,
      password: fixture.user.password,
      registration: { name: 'Надежда', documents },
    });
    const cookie = jest.fn();
    const response = { cookie } as unknown as Response;
    await fixture.authController.confirmRegistration(
      { email, code: CODE },
      response,
    );
    const user = await db.getRepository(User).findOneByOrFail({ email });
    const history = await legal.history(user.id);
    expect(user.name).toBe('Надежда');
    expect(history.map((e) => e.documentId).sort()).toEqual([
      'account-terms',
      'pd-account',
    ]);
    expect(history.every((e) => e.verification === 'email-code')).toBe(true);
    expect(cookie).toHaveBeenCalled();
  });
  it('does not create an account when its consent version has changed', async () => {
    const email = randomUUID() + '@example.test';
    fixture.tokenMocks.consumeRegistrationCode.mockResolvedValueOnce({
      email,
      password: fixture.user.password,
      registration: {
        name: 'Надежда',
        documents: [
          { ...legal.get('pd-account'), version: 'old' },
          legal.get('account-terms'),
        ],
      },
    });
    await expect(
      fixture.authController.confirmRegistration({ email, code: CODE }, {
        cookie: jest.fn(),
      } as unknown as Response),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await db.getRepository(User).existsBy({ email })).toBe(false);
  });
  it('never treats another email subscription as the current user subscription', async () => {
    const service = new SubscriptionService(
      db,
      legal,
      {} as MailService,
      {} as EnvService,
    );
    await db.getRepository(Subscription).save({
      email: randomUUID() + '@other.test',
      active: true,
      activeUntil: new Date(Date.now() + 100000),
      documents: [],
    });
    expect((await service.status(fixture.user.id)).marketing).toBe(false);
    await db.getRepository(Subscription).save({
      email: fixture.user.email,
      active: true,
      activeUntil: new Date(Date.now() + 100000),
      documents: [],
    });
    expect((await service.status(fixture.user.id)).marketing).toBe(true);
  });
  it('ends sessions when account consent is withdrawn', async () => {
    await db.transaction((m) =>
      legal.record(m, [legal.get('pd-account')], ['pd-account'], {
        userId: fixture.user.id,
        source: 'registration',
        verification: 'email-code',
      }),
    );
    const tokens = await fixture.auth.loginNewSession(fixture.user.id);
    const service = new SubscriptionService(
      db,
      legal,
      {} as MailService,
      {} as EnvService,
    );
    await service.withdraw(fixture.user.id, 'account');
    await expect(
      fixture.auth.validateUserById(fixture.user.id),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      fixture.auth.refreshJwtTokens(fixture.user.id, tokens.refresh_token),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(
      (await legal.history(fixture.user.id)).some(
        (e) => e.action === 'withdraw',
      ),
    ).toBe(true);
  });
});
