import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Product } from '../shop.entities';
import { PaymentInvoice } from './payment.entity';

export async function reserveStock(
  manager: EntityManager,
  invoice: PaymentInvoice,
) {
  if (invoice.isTest) return;
  const products = await manager
    .getRepository(Product)
    .createQueryBuilder('p')
    .where('p.id IN (:...ids)', { ids: invoice.items.map((i) => i.productId) })
    .orderBy('p.id', 'ASC')
    .setLock('pessimistic_write')
    .getMany();
  for (const line of invoice.items) {
    const product = products.find((p) => p.id === line.productId);
    if (
      !product ||
      !product.active ||
      product.isDemo ||
      product.stock < line.quantity ||
      product.priceRub !== line.priceRub
    )
      throw new ConflictException(
        'Изделия, цены или наличие изменились. Согласуйте новую заявку перед оплатой.',
      );
    product.stock -= line.quantity;
  }
  await manager.save(products);
  invoice.stockReserved = true;
}

// Caller holds the invoice lock. This flag prevents repeat releases across workers.
export async function expireInvoice(
  manager: EntityManager,
  invoice: PaymentInvoice,
) {
  if (
    !['ready', 'pending'].includes(invoice.status) ||
    invoice.expiresAt.getTime() > Date.now()
  )
    return;
  if (invoice.stockReserved) {
    for (const line of [...invoice.items].sort((a, b) =>
      a.productId.localeCompare(b.productId),
    ))
      await manager
        .getRepository(Product)
        .increment({ id: line.productId }, 'stock', line.quantity);
    invoice.stockReserved = false;
  }
  invoice.status = 'expired';
  await manager.save(invoice);
}
