import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
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
import {
  CODE,
  PASSWORD,
  createCredentialFixture,
} from './helpers/credential-fixture';
import { Role } from '../src/common/types/role.enum';
import { ProductCategory } from '../src/shop/category.entity';
import { DeliveryAddressService } from '../src/shop/delivery-address.service';

const url = process.env.TEST_DATABASE_URL;
const databaseTests = url ? describe : describe.skip;
databaseTests('Shop and consent persistence in PostgreSQL', () => {
  const schema = 'shop_test_' + randomUUID().replace(/-/g, '');
  let control: DataSource;
  let db: DataSource;
  let legal: LegalService;
  let shop: ShopService;
  let addresses: DeliveryAddressService;
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
    addresses = new DeliveryAddressService(db);
    await db
      .getRepository(ProductCategory)
      .insert({ id: 'covers', name: 'Обложки', nameKey: 'обложки' });
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
      shop.createRequest(data, fixture.user.id),
      shop.createRequest(data, fixture.user.id),
    ]);
    expect(first.id).toBe(second.id);
    expect(first.subtotalRub).toBe(1200);
    expect(
      await db
        .getRepository(OrderRequest)
        .countBy({ requestKey: data.requestKey }),
    ).toBe(1);
    await expect(
      shop.createRequest(
        { ...data, name: 'Другой покупатель' },
        fixture.user.id,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('keeps an address snapshot in the request after editing or deleting the saved address', async () => {
    const details = {
      region: 'Свердловская область',
      city: 'Заречный',
      street: 'Ленина',
      house: '12 к. 1',
      apartment: '3',
      postalCode: '624250',
    };
    const saved = await addresses.create(fixture.user.id, details);
    const request = { ...requestData(), addressId: saved.id };
    const receipt = await shop.createRequest(request, fixture.user.id);
    await addresses.update(fixture.user.id, saved.id, {
      ...details,
      house: '14',
    });
    await addresses.remove(fixture.user.id, saved.id);
    const order = await db
      .getRepository(OrderRequest)
      .findOneByOrFail({ id: receipt.id });
    expect(order.deliveryAddress).toEqual(details);
    expect((await shop.createRequest(request, fixture.user.id)).id).toBe(
      receipt.id,
    );
    await expect(
      shop.createRequest(
        { ...requestData(), addressId: saved.id },
        fixture.user.id,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('saves a new checkout address atomically and rejects another customer’s address', async () => {
    const details = { city: 'Заречный', street: 'Мира', house: '7' };
    const request = {
      ...requestData(),
      deliveryAddress: details,
      saveAddress: true,
    };
    const receipt = await shop.createRequest(request, fixture.user.id);
    expect(
      (await addresses.list(fixture.user.id)).map((address) => address.house),
    ).toEqual(['7']);
    expect((await shop.createRequest(request, fixture.user.id)).id).toBe(
      receipt.id,
    );
    expect(await addresses.list(fixture.user.id)).toHaveLength(1);
    const saved = (await addresses.list(fixture.user.id))[0];
    await expect(
      addresses.update(fixture.user.id + 1, saved.id, details),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      addresses.remove(fixture.user.id + 1, saved.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await addresses.list(fixture.user.id + 1)).toEqual([]);
    await expect(
      shop.createRequest(
        { ...requestData(), addressId: saved.id },
        fixture.user.id + 1,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      shop.createRequest(
        {
          ...requestData(),
          deliveryAddress: { ...details, city: 'Другой' },
          saveAddress: true,
        },
        fixture.user.id,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await addresses.list(fixture.user.id)).toHaveLength(1);
  });

  it('limits saved addresses to ten under concurrent requests', async () => {
    const details = { city: 'Заречный', street: 'Мира', house: '7' };
    for (let i = 0; i < 9; i++)
      await addresses.create(fixture.user.id, details);
    const attempts = await Promise.allSettled([
      addresses.create(fixture.user.id, details),
      addresses.create(fixture.user.id, details),
    ]);
    expect(
      attempts.filter((attempt) => attempt.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(await addresses.list(fixture.user.id)).toHaveLength(10);
  });

  it('removes the address book with the account while preserving an existing request snapshot', async () => {
    const details = { city: 'Заречный', street: 'Мира', house: '7' };
    await addresses.create(fixture.user.id, details);
    const receipt = await shop.createRequest(
      { ...requestData(), deliveryAddress: details },
      fixture.user.id,
    );
    await db.getRepository(User).delete({ id: fixture.user.id });
    expect(await addresses.list(fixture.user.id)).toEqual([]);
    expect(
      (await db.getRepository(OrderRequest).findOneByOrFail({ id: receipt.id }))
        .deliveryAddress,
    ).toMatchObject(details);
  });
  it('rejects stale prices, unavailable quantities and duplicate product IDs', async () => {
    const data = requestData();
    await expect(
      shop.createRequest(
        { ...data, items: [{ ...data.items[0], expectedPriceRub: 1 }] },
        fixture.user.id,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      shop.createRequest(
        { ...data, items: [{ ...data.items[0], quantity: 3 }] },
        fixture.user.id,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      shop.createRequest(
        { ...data, items: [data.items[0], data.items[0]] },
        fixture.user.id,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      await db
        .getRepository(OrderRequest)
        .countBy({ requestKey: data.requestKey }),
    ).toBe(0);
  });
  it('requires a signed-in customer and keeps requests separate between accounts', async () => {
    await expect(shop.createRequest(requestData(), 0)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await shop.createRequest(requestData(), fixture.user.id);
    await shop.createRequest(requestData(), fixture.user.id + 10000);
    expect(await shop.requests(fixture.user.id)).toHaveLength(1);
    expect(await shop.requests(fixture.user.id + 10000)).toHaveLength(1);
  });
  it('rejects customer actions for the shop owner', async () => {
    const data = requestData();
    await expect(
      shop.createRequest(data, fixture.user.id, Role.ADMIN),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      shop.favorite(fixture.user.id, product.id, true, Role.ADMIN),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      shop.favorite(fixture.user.id, product.id, false, Role.ADMIN),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      await db
        .getRepository(OrderRequest)
        .countBy({ requestKey: data.requestKey }),
    ).toBe(0);
    expect(await shop.favorites(fixture.user.id)).toEqual([]);
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
      fixture.hash,
      fixture.auth,
    );
    await db.getRepository(Subscription).save({
      email: randomUUID() + '@other.test',
      active: true,
      activeUntil: new Date(Date.now() + 100000),
      documents: [],
    });
    expect((await service.status(fixture.user.id)).marketing).toBe(false);
    await db.getRepository(Subscription).save({
      email: fixture.user.email!,
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
      fixture.hash,
      fixture.auth,
    );
    await service.withdraw(fixture.user.id, 'account', PASSWORD);
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
