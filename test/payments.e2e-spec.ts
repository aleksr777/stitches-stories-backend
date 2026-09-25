import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Role } from '../src/common/types/role.enum';
import { ConsentEvent, LegalDocumentEntity } from '../src/legal/legal.entities';
import { LegalService } from '../src/legal/legal.service';
import { OrderRequest, Product, shopEntities } from '../src/shop/shop.entities';
import { PaymentConfigService } from '../src/shop/payments/payment-config.service';
import { PaymentInvoice } from '../src/shop/payments/payment.entity';
import { PaymentService } from '../src/shop/payments/payment.service';
import { notification, testAccount } from './helpers/payment-fixture';
import { User } from '../src/users/entities/user.entity';

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)('SBP invoices in PostgreSQL', () => {
  const original = { ...process.env };
  const schema = 'payments_' + randomUUID().replace(/-/g, '');
  let control: DataSource;
  let db: DataSource;
  let legal: LegalService;
  let config: PaymentConfigService;
  let payments: PaymentService;
  const terms = {
    deliveryRub: 300,
    fulfillment: 'Изготовление 5 дней, доставка согласована.',
  };
  const customer = { id: 123, role: Role.USER };
  const service = () => {
    config = new PaymentConfigService();
    payments = new PaymentService(db, config, legal);
  };
  const createOrder = async (userId: number | null = customer.id) => {
    const product = await db.getRepository(Product).save({
      slug: randomUUID(),
      name: 'Вышитое панно',
      category: null,
      priceRub: 1200,
      description: 'Изделие для тестирования оплаты',
      materials: 'Хлопок',
      dimensions: '20 × 20 см',
      productionTime: '5 дней',
      images: [],
      stock: 2,
      featured: false,
      active: true,
      isDemo: false,
    });
    const order = await db.getRepository(OrderRequest).save({
      requestKey: randomUUID(),
      payloadHash: 'a'.repeat(64),
      userId,
      name: 'Тестовый покупатель',
      email: 'buyer@example.test',
      city: 'Заречный',
      items: [
        {
          productId: product.id,
          slug: product.slug,
          name: product.name,
          quantity: 1,
          priceRub: 1200,
        },
      ],
      subtotalRub: 1200,
      status: 'agreed',
      document: legal.get('offer'),
    });
    return { order, product };
  };
  const start = async (invoice: PaymentInvoice) =>
    payments.start(
      invoice.id,
      {
        documents: invoice.documents,
      },
      customer,
    );
  const issued = async (order: OrderRequest) => {
    const view = await payments.issue(order.id, terms);
    return db.getRepository(PaymentInvoice).findOneByOrFail({ id: view.id });
  };
  beforeAll(async () => {
    control = await new DataSource({ type: 'postgres', url }).initialize();
    await control.query(`CREATE SCHEMA "${schema}"`);
    db = await new DataSource({
      type: 'postgres',
      url,
      schema,
      entities: [User, ...shopEntities, LegalDocumentEntity, ConsentEvent],
      synchronize: true,
    }).initialize();
    legal = new LegalService(db);
    await legal.onModuleInit();
  });
  beforeEach(() => {
    process.env.PAYMENTS_ENABLED = 'true';
    process.env.PAYMENTS_ACTIVE_ACCOUNT = testAccount.id;
    process.env.ROBOKASSA_ACCOUNTS_JSON = JSON.stringify([testAccount]);
    process.env.FRONTEND_URL = 'https://shop.example.test';
    service();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...original };
  });
  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (control?.isInitialized) {
      await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await control.destroy();
    }
  });
  it('creates exactly one invoice under concurrent admin requests, freezes terms and does not reserve test stock', async () => {
    const { order, product } = await createOrder();
    const views = await Promise.all([
      payments.issue(order.id, terms),
      payments.issue(order.id, terms),
    ]);
    expect(views[0].id).toBe(views[1].id);
    expect(views[0].paymentUrl).toBe(views[1].paymentUrl);
    expect(
      await db.getRepository(PaymentInvoice).countBy({ orderId: order.id }),
    ).toBe(1);
    expect(
      (await db.getRepository(Product).findOneByOrFail({ id: product.id }))
        .stock,
    ).toBe(2);
    await expect(
      payments.issue(order.id, { ...terms, deliveryRub: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
    await db.getRepository(OrderRequest).update(order.id, { status: 'new' });
    const invoice = await db
      .getRepository(PaymentInvoice)
      .findOneByOrFail({ id: views[0].id });
    await expect(start(invoice)).rejects.toBeInstanceOf(ConflictException);
  });
  it('allows only the owning signed-in customer and never returns contact details', async () => {
    const { order } = await createOrder();
    const invoice = await issued(order);
    await expect(
      payments.view(invoice.id, { ...customer, id: 999 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      payments.view(invoice.id, { ...customer, role: Role.ADMIN }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const view = await payments.view(invoice.id, customer);
    expect(view.amountRub).toBe(1500);
    expect(JSON.stringify(view)).not.toContain(order.email);
    expect(JSON.stringify(view)).not.toContain(order.name);
  });
  it('requires exact archived terms and stores one acceptance while reusing the same payment number', async () => {
    const invoice = await issued((await createOrder()).order);
    await expect(
      payments.start(invoice.id, { documents: [] }, customer),
    ).rejects.toBeInstanceOf(ConflictException);
    const forms = await Promise.all([start(invoice), start(invoice)]);
    expect(forms[0]).toEqual(forms[1]);
    const saved = await db
      .getRepository(PaymentInvoice)
      .findOneByOrFail({ id: invoice.id });
    expect(saved.acceptedAt).toBeInstanceOf(Date);
    expect(saved.acceptedDocuments).toHaveLength(4);
    expect(saved.status).toBe('pending');
  });
  it('rejects forgery and wrong sums, then acknowledges repeated notifications without repeating fulfillment', async () => {
    const { order, product } = await createOrder();
    const invoice = await issued(order);
    await expect(
      payments.receive(notification(invoice)),
    ).rejects.toBeInstanceOf(BadRequestException);
    await start(invoice);
    await expect(
      payments.receive({
        ...notification(invoice),
        SignatureValue: 'f'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      payments.receive(notification(invoice, testAccount, '1.00')),
    ).rejects.toBeInstanceOf(BadRequestException);
    const results = await Promise.all([
      payments.receive(notification(invoice)),
      payments.receive(notification(invoice)),
    ]);
    expect(results).toEqual(['OK' + invoice.number, 'OK' + invoice.number]);
    const paid = await db
      .getRepository(PaymentInvoice)
      .findOneByOrFail({ id: invoice.id });
    expect(paid.status).toBe('paid');
    expect(paid.isTest).toBe(true);
    expect(
      (await db.getRepository(Product).findOneByOrFail({ id: product.id }))
        .stock,
    ).toBe(2);
    expect(
      (await db.getRepository(OrderRequest).findOneByOrFail({ id: order.id }))
        .status,
    ).toBe('agreed');
    await expect(start(invoice)).rejects.toBeInstanceOf(ConflictException);
  });
  it('continues old account callbacks when the active seller changes or new payments are disabled', async () => {
    const invoice = await issued((await createOrder()).order);
    await start(invoice);
    const next = {
      ...testAccount,
      id: 'next-test',
      merchantLogin: 'next-merchant',
      password2: 'synthetic-new-password-two',
      sellerName: 'Другой продавец',
      sellerInn: '111111111111',
    };
    process.env.PAYMENTS_ACTIVE_ACCOUNT = next.id;
    process.env.ROBOKASSA_ACCOUNTS_JSON = JSON.stringify([testAccount, next]);
    service();
    expect((await payments.adminView(invoice.orderId))?.sellerName).toBe(
      testAccount.sellerName,
    );
    await expect(
      payments.receive(notification(invoice, next)),
    ).rejects.toBeInstanceOf(BadRequestException);
    process.env.PAYMENTS_ENABLED = 'false';
    service();
    await expect(start(invoice)).rejects.toThrow();
    expect(await payments.receive(notification(invoice))).toBe(
      'OK' + invoice.number,
    );
  });
  it('blocks draft legal documents for live payments', async () => {
    process.env.ROBOKASSA_ACCOUNTS_JSON = JSON.stringify([
      { ...testAccount, mode: 'live' },
    ]);
    service();
    await expect(issued((await createOrder()).order)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('does not create an invoice for a legacy request without an account', async () => {
    await expect(
      issued((await createOrder(null)).order),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('rejects an order with zero product total before creating an invoice', async () => {
    const { order } = await createOrder();
    await db.getRepository(OrderRequest).update(order.id, {
      subtotalRub: 0,
      items: order.items.map((item) => ({ ...item, priceRub: 0 })),
    });
    await expect(issued(order)).rejects.toBeInstanceOf(BadRequestException);
    expect(
      await db.getRepository(PaymentInvoice).countBy({ orderId: order.id }),
    ).toBe(0);
  });
  it('reserves live stock once, releases expiry once, and records late received money for review', async () => {
    const account = { ...testAccount, mode: 'live' };
    process.env.ROBOKASSA_ACCOUNTS_JSON = JSON.stringify([account]);
    service();
    const originals = legal.list();
    const get = (id: string) =>
      originals.find((document) => document.id === id)!;
    jest.spyOn(legal, 'get').mockImplementation((id) => ({
      ...get(id),
      status: 'published',
      sections: [[testAccount.sellerName, testAccount.sellerInn]],
    }));
    const { order, product } = await createOrder();
    const invoice = await issued(order);
    await start(invoice);
    expect(
      (await db.getRepository(Product).findOneByOrFail({ id: product.id }))
        .stock,
    ).toBe(1);
    await db
      .getRepository(PaymentInvoice)
      .update(invoice.id, { expiresAt: new Date(Date.now() - 1000) });
    await Promise.all([
      payments.expire(invoice.id),
      payments.expire(invoice.id),
    ]);
    expect(
      (await db.getRepository(Product).findOneByOrFail({ id: product.id }))
        .stock,
    ).toBe(2);
    await expect(start(invoice)).rejects.toBeInstanceOf(ConflictException);
    expect(await payments.receive(notification(invoice))).toBe(
      'OK' + invoice.number,
    );
    expect(
      (
        await db
          .getRepository(PaymentInvoice)
          .findOneByOrFail({ id: invoice.id })
      ).status,
    ).toBe('paid_review');
    expect(
      (await db.getRepository(Product).findOneByOrFail({ id: product.id }))
        .stock,
    ).toBe(2);
  });
  it('serializes live reservations for the last item across two orders', async () => {
    process.env.ROBOKASSA_ACCOUNTS_JSON = JSON.stringify([
      { ...testAccount, mode: 'live' },
    ]);
    service();
    const originals = legal.list();
    const get = (id: string) =>
      originals.find((document) => document.id === id)!;
    jest.spyOn(legal, 'get').mockImplementation((id) => ({
      ...get(id),
      status: 'published',
      sections: [[testAccount.sellerName, testAccount.sellerInn]],
    }));
    const { order, product } = await createOrder();
    await db.getRepository(Product).update(product.id, { stock: 1 });
    const second = await db
      .getRepository(OrderRequest)
      .save({ ...order, id: randomUUID(), requestKey: randomUUID() });
    const results = await Promise.allSettled([issued(order), issued(second)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(
      (await db.getRepository(Product).findOneByOrFail({ id: product.id }))
        .stock,
    ).toBe(0);
  });
});
