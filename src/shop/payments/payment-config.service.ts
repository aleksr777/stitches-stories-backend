import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { PaymentInvoice } from './payment.entity';

export type PaymentAccount = {
  id: string;
  merchantLogin: string;
  mode: 'test' | 'live';
  password1: string;
  password2: string;
  sellerName: string;
  sellerInn: string;
};
export const unavailable = () =>
  new ServiceUnavailableException(
    'Оплата временно недоступна. Свяжитесь с мастерской.',
  );
const invalid = () =>
  new Error(
    'Некорректная конфигурация СБП. Проверьте PAYMENTS_* и ROBOKASSA_ACCOUNTS_JSON по docs/SBP.md.',
  );

@Injectable()
export class PaymentConfigService {
  private readonly accounts: PaymentAccount[];
  readonly enabled = process.env.PAYMENTS_ENABLED === 'true';
  private readonly activeId = process.env.PAYMENTS_ACTIVE_ACCOUNT ?? '';
  private readonly frontend =
    process.env.FRONTEND_URL ?? 'http://localhost:5173';

  constructor() {
    try {
      const values: unknown = JSON.parse(
        process.env.ROBOKASSA_ACCOUNTS_JSON ?? '[]',
      );
      if (!Array.isArray(values)) throw invalid();
      this.accounts = values.map((value: unknown) => this.parseAccount(value));
      if (new Set(this.accounts.map((a) => a.id)).size !== this.accounts.length)
        throw invalid();
      // Test credentials must never validate a live payment (even across accounts).
      for (const a of this.accounts)
        for (const b of this.accounts)
          if (
            a.mode !== b.mode &&
            [a.password1, a.password2].some((p) =>
              [b.password1, b.password2].includes(p),
            )
          )
            throw invalid();
      if (!['true', 'false', undefined].includes(process.env.PAYMENTS_ENABLED))
        throw invalid();
      if (this.enabled) {
        const account = this.accounts.find((a) => a.id === this.activeId);
        if (!account) throw invalid();
        const url = new URL(this.frontend);
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw invalid();
        if (account.mode === 'live' && url.protocol !== 'https:')
          throw invalid();
      }
    } catch {
      throw invalid();
    }
  }
  private parseAccount(value: unknown): PaymentAccount {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw invalid();
    const a = value as Record<string, unknown>;
    for (const key of [
      'id',
      'merchantLogin',
      'mode',
      'password1',
      'password2',
      'sellerName',
      'sellerInn',
    ])
      if (typeof a[key] !== 'string') throw invalid();
    const p = a as PaymentAccount;
    if (
      !/^[a-zA-Z0-9_-]{1,64}$/.test(p.id) ||
      !/^[a-zA-Z0-9_.-]{1,100}$/.test(p.merchantLogin) ||
      !['test', 'live'].includes(p.mode)
    )
      throw invalid();
    if (
      p.password1.length < 16 ||
      p.password2.length < 16 ||
      p.password1 === p.password2
    )
      throw invalid();
    if (
      p.sellerName.trim().length < 3 ||
      p.sellerName.length > 200 ||
      !/^\d{12}$/.test(p.sellerInn)
    )
      throw invalid();
    return p;
  }
  active() {
    const account = this.accounts.find((a) => a.id === this.activeId);
    if (!this.enabled || !account) throw unavailable();
    return account;
  }
  forInvoice(invoice: PaymentInvoice) {
    const account = this.accounts.find((a) => a.id === invoice.accountId);
    if (
      !account ||
      account.merchantLogin !== invoice.merchantLogin ||
      (account.mode === 'test') !== invoice.isTest ||
      account.sellerName !== invoice.sellerName ||
      account.sellerInn !== invoice.sellerInn
    )
      throw unavailable();
    return account;
  }
  paymentUrl(invoice: PaymentInvoice) {
    return this.frontend.replace(/\/$/, '') + '/payment/' + invoice.id;
  }
  publicConfig() {
    const account = this.accounts.find((a) => a.id === this.activeId);
    return {
      enabled: this.enabled,
      provider: 'robokassa',
      account: account
        ? {
            id: account.id,
            isTest: account.mode === 'test',
            sellerName: account.sellerName,
            sellerInn: account.sellerInn,
          }
        : null,
    };
  }
}
