import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Role } from '../../common/types/role.enum';
import { canonical, LegalService } from '../../legal/legal.service';
import type { DocumentRef } from '../../legal/legal.types';
import { OrderRequest } from '../shop.entities';
import { PaymentConfigService, unavailable } from './payment-config.service';
import { IssuePaymentDto, StartPaymentDto } from './payment.dto';
import { PaymentInvoice } from './payment.entity';
import { expireInvoice, reserveStock } from './payment-stock';
import {
  parseNotification,
  paymentForm,
  verifyNotification,
} from './robokassa';

type Viewer = { id: number; role: Role };
const ref = ({ id, version, sha256 }: DocumentRef) => ({ id, version, sha256 });

@Injectable()
export class PaymentService {
  constructor(
    private readonly db: DataSource,
    private readonly config: PaymentConfigService,
    private readonly legal: LegalService,
  ) {}

  async issue(orderId: string, dto: IssuePaymentDto) {
    const invoice = await this.db.transaction(async (manager) => {
      const order = await manager.findOne(OrderRequest, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException('Заявка не найдена.');
      const existing = await manager.findOneBy(PaymentInvoice, { orderId });
      if (existing) {
        if (
          existing.deliveryRub !== dto.deliveryRub ||
          existing.fulfillment !== dto.fulfillment
        )
          throw new ConflictException(
            'Счёт уже выставлен. Его сумма и условия зафиксированы.',
          );
        return existing;
      }
      if (order.status !== 'agreed')
        throw new ConflictException('Сначала согласуйте заявку с покупателем.');
      if (!order.userId)
        throw new ConflictException(
          'Счёт можно выставить только для заявки покупателя из его аккаунта.',
        );
      const account = this.config.active();
      const documents = ['offer', 'payment', 'returns', 'seller'].map((id) =>
        this.legal.get(id),
      );
      if (
        account.mode === 'live' &&
        (documents.some((d) => d.status !== 'published') ||
          !canonical(documents.find((d) => d.id === 'seller')).includes(
            account.sellerInn,
          ))
      )
        throw new ConflictException(
          'Перед реальной оплатой опубликуйте документы с реквизитами этого продавца.',
        );
      const subtotalRub = order.items.reduce(
        (sum, line) => sum + line.priceRub * line.quantity,
        0,
      );
      const amountRub = subtotalRub + dto.deliveryRub;
      if (
        !Number.isSafeInteger(amountRub) ||
        subtotalRub < 1 ||
        amountRub < 1 ||
        amountRub > 1000000 ||
        subtotalRub !== order.subtotalRub
      )
        throw new BadRequestException(
          'Сумма счёта должна быть от 1 до 1 000 000 ₽.',
        );
      const created = manager.create(PaymentInvoice, {
        orderId,
        accountId: account.id,
        merchantLogin: account.merchantLogin,
        isTest: account.mode === 'test',
        sellerName: account.sellerName,
        sellerInn: account.sellerInn,
        status: 'ready',
        items: order.items,
        subtotalRub,
        deliveryRub: dto.deliveryRub,
        amountRub,
        fulfillment: dto.fulfillment,
        documents,
        stockReserved: false,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      await reserveStock(manager, created);
      return manager.save(created);
    });
    return {
      ...this.snapshot(invoice),
      paymentUrl: this.config.paymentUrl(invoice),
    };
  }

  async adminView(orderId: string) {
    const invoice = await this.db
      .getRepository(PaymentInvoice)
      .findOneBy({ orderId });
    if (!invoice) return null;
    await this.expire(invoice.id);
    const current = await this.db
      .getRepository(PaymentInvoice)
      .findOneByOrFail({ id: invoice.id });
    return {
      ...this.snapshot(current),
      paymentUrl: this.config.paymentUrl(current),
    };
  }

  async view(id: string, viewer: Viewer) {
    const invoice = await this.authorized(id, viewer);
    await this.expire(invoice.id);
    return this.snapshot(
      await this.db.getRepository(PaymentInvoice).findOneByOrFail({ id }),
    );
  }

  private async authorized(id: string, viewer: Viewer) {
    if (viewer.role === Role.ADMIN) throw new ForbiddenException();
    const invoice = await this.db
      .getRepository(PaymentInvoice)
      .findOne({ where: { id }, relations: { order: true } });
    if (!invoice || invoice.order.userId !== viewer.id)
      throw new NotFoundException('Счёт не найден.');
    return invoice;
  }

  async start(id: string, dto: StartPaymentDto, viewer: Viewer) {
    await this.authorized(id, viewer);
    if (!this.config.enabled) throw unavailable();
    // Persist expiration before throwing; throwing inside the transaction would roll it back.
    await this.expire(id);
    return this.db.transaction(async (manager) => {
      const invoice = await this.lock(manager, id);
      if (
        !['ready', 'pending'].includes(invoice.status) ||
        invoice.expiresAt.getTime() <= Date.now()
      )
        throw new ConflictException(
          'Этот счёт уже оплачен или срок оплаты истёк.',
        );
      const order = await manager.findOneByOrFail(OrderRequest, {
        id: invoice.orderId,
      });
      if (order.status !== 'agreed')
        throw new ConflictException(
          'Условия заявки изменились. Свяжитесь с мастерской.',
        );
      const expected = invoice.documents
        .map(ref)
        .sort((a, b) => a.id.localeCompare(b.id));
      const accepted = dto.documents
        .map(ref)
        .sort((a, b) => a.id.localeCompare(b.id));
      if (canonical(expected) !== canonical(accepted))
        throw new ConflictException(
          'Ознакомьтесь с условиями именно этого счёта.',
        );
      const account = this.config.forInvoice(invoice);
      if (!invoice.acceptedAt) {
        invoice.acceptedAt = new Date();
        invoice.acceptedByUserId = viewer.id;
        invoice.acceptedDocuments = accepted;
      }
      invoice.status = 'pending';
      await manager.save(invoice);
      return paymentForm(invoice, account, order.email);
    });
  }

  async receive(body: unknown) {
    const notice = parseNotification(body);
    return this.db.transaction(async (manager) => {
      const invoice = await manager.findOne(PaymentInvoice, {
        where: { number: notice.InvId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !invoice ||
        !verifyNotification(notice, invoice, this.config.forInvoice(invoice)) ||
        !invoice.acceptedAt
      )
        throw new BadRequestException('Уведомление не подтверждено.');
      if (invoice.paidAt) return 'OK' + notice.InvId;
      await expireInvoice(manager, invoice);
      // A valid late payment is still money received; flag it for manual fulfillment/refund.
      invoice.status = invoice.status === 'expired' ? 'paid_review' : 'paid';
      invoice.paidAt = new Date();
      invoice.stockReserved = false;
      await manager.save(invoice);
      return 'OK' + notice.InvId;
    });
  }

  async expire(id: string) {
    await this.db.transaction(async (manager) => {
      await expireInvoice(manager, await this.lock(manager, id));
    });
  }
  private async lock(manager: EntityManager, id: string) {
    const invoice = await manager.findOne(PaymentInvoice, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!invoice) throw new NotFoundException();
    return invoice;
  }
  private snapshot(invoice: PaymentInvoice) {
    return {
      id: invoice.id,
      number: invoice.number,
      orderNumber: invoice.orderId.slice(0, 8).toUpperCase(),
      status: invoice.status,
      isTest: invoice.isTest,
      sellerName: invoice.sellerName,
      sellerInn: invoice.sellerInn,
      items: invoice.items,
      subtotalRub: invoice.subtotalRub,
      deliveryRub: invoice.deliveryRub,
      amountRub: invoice.amountRub,
      fulfillment: invoice.fulfillment,
      expiresAt: invoice.expiresAt,
      paidAt: invoice.paidAt,
      documents: invoice.documents,
      canPay:
        this.config.enabled &&
        ['ready', 'pending'].includes(invoice.status) &&
        invoice.expiresAt.getTime() > Date.now(),
    };
  }
}
