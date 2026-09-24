import { createHash } from 'node:crypto';
import { PaymentAccount } from '../../src/shop/payments/payment-config.service';
import { PaymentInvoice } from '../../src/shop/payments/payment.entity';

export const testAccount: PaymentAccount = {
  id: 'owner-test',
  merchantLogin: 'stitches-test',
  mode: 'test',
  password1: 'synthetic-test-password-one',
  password2: 'synthetic-test-password-two',
  sellerName: 'Тестовый продавец',
  sellerInn: '000000000000',
};
export const paymentFixture = () =>
  Object.assign(new PaymentInvoice(), {
    id: '11111111-1111-4111-8111-111111111111',
    orderId: '22222222-2222-4222-8222-222222222222',
    number: '9007199254740993',
    accountId: testAccount.id,
    merchantLogin: testAccount.merchantLogin,
    isTest: true,
    sellerName: testAccount.sellerName,
    sellerInn: testAccount.sellerInn,
    amountRub: 1500,
    subtotalRub: 1200,
    deliveryRub: 300,
    status: 'pending',
    expiresAt: new Date('2030-01-01T10:00:00Z'),
    items: [
      {
        productId: '33333333-3333-4333-8333-333333333333',
        slug: 'test',
        name: 'Вышитое панно',
        priceRub: 1200,
        quantity: 1,
      },
    ],
  });
// Independent provider-side signature, not the implementation's signing helper.
export function notification(
  invoice: PaymentInvoice,
  account = testAccount,
  outSum = invoice.amountRub.toFixed(6),
) {
  const mode = invoice.isTest ? 'test' : 'live';
  const signature = createHash('sha256')
    .update(
      `${outSum}:${invoice.number}:${account.password2}:Shp_account=${invoice.accountId}:Shp_invoice=${invoice.id}:Shp_mode=${mode}`,
    )
    .digest('hex');
  return {
    OutSum: outSum,
    InvId: invoice.number,
    Shp_account: invoice.accountId,
    Shp_invoice: invoice.id,
    Shp_mode: mode,
    SignatureValue: signature,
  };
}
