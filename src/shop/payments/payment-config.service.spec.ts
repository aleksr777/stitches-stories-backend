import {
  paymentFixture,
  testAccount,
} from '../../../test/helpers/payment-fixture';
import { PaymentConfigService } from './payment-config.service';

describe('Payment account configuration', () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.PAYMENTS_ENABLED = 'true';
    process.env.PAYMENTS_ACTIVE_ACCOUNT = testAccount.id;
    process.env.ROBOKASSA_ACCOUNTS_JSON = JSON.stringify([testAccount]);
    process.env.FRONTEND_URL = 'http://localhost:5173';
  });
  afterEach(() => {
    process.env = { ...original };
  });
  it('starts disabled with no merchant credentials', () => {
    delete process.env.PAYMENTS_ENABLED;
    delete process.env.ROBOKASSA_ACCOUNTS_JSON;
    const config = new PaymentConfigService();
    expect(config.publicConfig()).toMatchObject({
      enabled: false,
      account: null,
    });
    expect(() => config.active()).toThrow();
  });
  it('keeps old invoices linked to the old seller when the active account changes', () => {
    const second = {
      ...testAccount,
      id: 'second-test',
      merchantLogin: 'other',
      linkSecret: 'd'.repeat(64),
      sellerName: 'Другой продавец',
    };
    process.env.ROBOKASSA_ACCOUNTS_JSON = JSON.stringify([testAccount, second]);
    process.env.PAYMENTS_ACTIVE_ACCOUNT = second.id;
    const config = new PaymentConfigService();
    const invoice = paymentFixture();
    expect(config.active().id).toBe(second.id);
    expect(config.forInvoice(invoice)).toEqual(testAccount);
    const token = config.accessToken(invoice);
    expect(config.acceptsToken(invoice, token)).toBe(true);
    expect(config.acceptsToken({ ...invoice, id: 'other' }, token)).toBe(false);
    expect(config.paymentUrl(invoice)).toContain('#token=');
    expect(JSON.stringify(config.publicConfig())).not.toContain(
      second.password1,
    );
    expect(() =>
      config.forInvoice({ ...invoice, merchantLogin: second.merchantLogin }),
    ).toThrow();
  });
  it('requires distinct test/live credentials and rejects unsafe live origins', () => {
    process.env.ROBOKASSA_ACCOUNTS_JSON = JSON.stringify([
      testAccount,
      { ...testAccount, id: 'live', mode: 'live' },
    ]);
    expect(() => new PaymentConfigService()).toThrow();
    process.env.ROBOKASSA_ACCOUNTS_JSON = JSON.stringify([
      { ...testAccount, mode: 'live' },
    ]);
    expect(() => new PaymentConfigService()).toThrow();
  });
  it('reports malformed configuration without echoing credentials', () => {
    process.env.ROBOKASSA_ACCOUNTS_JSON = '{ secret-credentials';
    expect(() => new PaymentConfigService()).toThrow(
      /Некорректная конфигурация/,
    );
    try {
      new PaymentConfigService();
    } catch (error) {
      expect(String(error)).not.toContain('secret-credentials');
    }
  });
});
