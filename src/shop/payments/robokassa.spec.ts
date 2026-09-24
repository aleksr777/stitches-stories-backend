import { createHash } from 'node:crypto';
import {
  notification,
  paymentFixture,
  testAccount,
} from '../../../test/helpers/payment-fixture';
import {
  parseNotification,
  paymentForm,
  verifyNotification,
} from './robokassa';

describe('Robokassa SBP protocol', () => {
  it('signs server prices and encoded receipt, keeps bigint invoice numbers and only SBP', () => {
    const invoice = paymentFixture();
    const { action, fields } = paymentForm(
      invoice,
      testAccount,
      'buyer@example.test',
    );
    expect(action).toBe('https://auth.robokassa.ru/Merchant/Index.aspx');
    expect(fields).toMatchObject({
      InvId: '9007199254740993',
      OutSum: '1500.00',
      IncCurrLabel: 'SBP',
      PaymentMethods: 'SBP',
      IsTest: '1',
    });
    expect(JSON.stringify(fields)).not.toContain(testAccount.password1);
    const expected = createHash('sha256')
      .update(
        `stitches-test:1500.00:9007199254740993:${fields.Receipt}:synthetic-test-password-one:Shp_account=owner-test:Shp_invoice=${invoice.id}:Shp_mode=test`,
      )
      .digest('hex');
    expect(fields.SignatureValue).toBe(expected);
    const receipt = JSON.parse(decodeURIComponent(fields.Receipt)) as {
      items: Array<{ name: string; sum: number }>;
    };
    expect(receipt.items.map((i) => i.sum)).toEqual([1200, 300]);
  });
  it.each(['1500', '1500.00', '1500.000000'])(
    'accepts the exact amount %s and uppercase signatures',
    (amount) => {
      const invoice = paymentFixture();
      const body = notification(invoice, testAccount, amount);
      body.SignatureValue = body.SignatureValue.toUpperCase();
      expect(
        verifyNotification(parseNotification(body), invoice, testAccount),
      ).toBe(true);
    },
  );
  it('rejects changed amounts even with a correct provider signature and never rounds fractions', () => {
    const invoice = paymentFixture();
    for (const amount of ['1499.999999', '1500.000001', '1501'])
      expect(
        verifyNotification(
          notification(invoice, testAccount, amount),
          invoice,
          testAccount,
        ),
      ).toBe(false);
  });
  it('rejects tampered IDs, mode, signature and extra signed parameters', () => {
    const invoice = paymentFixture();
    const body = notification(invoice);
    for (const patch of [
      { Shp_invoice: 'other' },
      { Shp_account: 'other' },
      { Shp_mode: 'live' },
      { SignatureValue: '0'.repeat(64) },
      { IsTest: '0' },
    ])
      expect(
        verifyNotification({ ...body, ...patch }, invoice, testAccount),
      ).toBe(false);
    for (const patch of [
      { Shp_surprise: 'x' },
      { InvId: ['1', '2'] },
      { OutSum: 'NaN' },
      { OutSum: '-1500' },
      { SignatureValue: ['a'] },
      { InvId: '9223372036854775808' },
    ])
      expect(() => parseNotification({ ...body, ...patch })).toThrow();
  });
});
