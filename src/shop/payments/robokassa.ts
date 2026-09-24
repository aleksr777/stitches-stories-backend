import { BadRequestException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { PaymentAccount } from './payment-config.service';
import type { PaymentInvoice } from './payment.entity';

export const PAYMENT_ACTION = 'https://auth.robokassa.ru/Merchant/Index.aspx';
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const custom = (invoice: PaymentInvoice) => ({
  Shp_account: invoice.accountId,
  Shp_invoice: invoice.id,
  Shp_mode: invoice.isTest ? 'test' : 'live',
});
const customSignature = (fields: Record<string, string>) =>
  Object.keys(fields)
    .sort()
    .map((key) => key + '=' + fields[key])
    .join(':');

export function paymentForm(
  invoice: PaymentInvoice,
  account: PaymentAccount,
  email: string,
) {
  const items = invoice.items.map((item) => ({
    name: Array.from(item.name).slice(0, 128).join(''),
    quantity: item.quantity,
    sum: item.priceRub * item.quantity,
    tax: 'none',
    payment_method: 'full_prepayment',
    payment_object: 'commodity',
  }));
  if (invoice.deliveryRub)
    items.push({
      name: 'Доставка',
      quantity: 1,
      sum: invoice.deliveryRub,
      tax: 'none',
      payment_method: 'full_prepayment',
      payment_object: 'service',
    });
  const Receipt = encodeURIComponent(JSON.stringify({ items }));
  const OutSum = invoice.amountRub.toFixed(2);
  const fields = custom(invoice);
  return {
    action: PAYMENT_ACTION,
    fields: {
      MerchantLogin: invoice.merchantLogin,
      OutSum,
      InvId: invoice.number,
      Description: 'Оплата заказа ' + invoice.orderId.slice(0, 8).toUpperCase(),
      IncCurrLabel: 'SBP',
      PaymentMethods: 'SBP',
      Culture: 'ru',
      Encoding: 'UTF-8',
      IsTest: invoice.isTest ? '1' : '0',
      Email: email,
      Receipt,
      ExpirationDate: invoice.expiresAt.toISOString(),
      ...fields,
      SignatureValue: hash(
        `${invoice.merchantLogin}:${OutSum}:${invoice.number}:${Receipt}:${account.password1}:${customSignature(fields)}`,
      ),
    },
  };
}

export type PaymentNotification = {
  OutSum: string;
  InvId: string;
  SignatureValue: string;
  Shp_account: string;
  Shp_invoice: string;
  Shp_mode: string;
  IsTest?: string;
};
export function parseNotification(body: unknown): PaymentNotification {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Некорректное уведомление.');
  const value = body as Record<string, unknown>;
  for (const key of [
    'OutSum',
    'InvId',
    'SignatureValue',
    'Shp_account',
    'Shp_invoice',
    'Shp_mode',
  ])
    if (typeof value[key] !== 'string' || value[key].length > 128)
      throw new BadRequestException('Некорректное уведомление.');
  if (
    Object.keys(value).some(
      (key) =>
        /^shp_/i.test(key) &&
        !['Shp_account', 'Shp_invoice', 'Shp_mode'].includes(key),
    )
  )
    throw new BadRequestException('Неизвестные параметры.');
  if (
    value.IsTest !== undefined &&
    !['0', '1'].includes(value.IsTest as string)
  )
    throw new BadRequestException('Некорректный режим.');
  const n = value as PaymentNotification;
  if (
    !/^[1-9]\d{0,18}$/.test(n.InvId) ||
    BigInt(n.InvId) > 9223372036854775807n ||
    !/^\d{1,7}(?:\.\d{1,6})?$/.test(n.OutSum) ||
    !/^[a-f0-9]{64}$/i.test(n.SignatureValue)
  )
    throw new BadRequestException('Некорректное уведомление.');
  return n;
}
export function verifyNotification(
  n: PaymentNotification,
  invoice: PaymentInvoice,
  account: PaymentAccount,
) {
  const fields = custom(invoice);
  if (
    n.InvId !== invoice.number ||
    Object.entries(fields).some(
      ([key, value]) => n[key as keyof PaymentNotification] !== value,
    ) ||
    (n.IsTest !== undefined && n.IsTest !== (invoice.isTest ? '1' : '0'))
  )
    return false;
  const [whole, fraction = ''] = n.OutSum.split('.');
  // Provider sends six decimal places in live mode. Never compare float amounts.
  if (
    BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0')) !==
    BigInt(invoice.amountRub) * 1000000n
  )
    return false;
  const expected = hash(
    `${n.OutSum}:${n.InvId}:${account.password2}:${customSignature(fields)}`,
  );
  return timingSafeEqual(
    Buffer.from(n.SignatureValue, 'hex'),
    Buffer.from(expected, 'hex'),
  );
}
