import {
  Column,
  CreateDateColumn,
  Entity,
  Generated,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { LegalDocument, DocumentRef } from '../../legal/legal.types';
import { OrderRequest, type OrderLine } from '../shop.entities';

export type PaymentStatus =
  | 'ready'
  | 'pending'
  | 'paid'
  | 'expired'
  | 'paid_review';

@Entity('payment_invoice')
@Index('IDX_payment_invoice_expiry', ['status', 'expiresAt'])
export class PaymentInvoice {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'bigint', unique: true })
  @Generated('increment')
  number!: string;
  @Column({ type: 'uuid', unique: true }) orderId!: string;
  @ManyToOne(() => OrderRequest, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'orderId' })
  order!: OrderRequest;
  @Column({ type: 'varchar', length: 64 }) accountId!: string;
  @Column({ type: 'varchar', length: 100 }) merchantLogin!: string;
  @Column({ type: 'boolean' }) isTest!: boolean;
  @Column({ type: 'varchar', length: 200 }) sellerName!: string;
  @Column({ type: 'varchar', length: 12 }) sellerInn!: string;
  @Column({ type: 'varchar', length: 20, default: 'ready' })
  status!: PaymentStatus;
  @Column({ type: 'jsonb' }) items!: OrderLine[];
  @Column({ type: 'int' }) subtotalRub!: number;
  @Column({ type: 'int' }) deliveryRub!: number;
  @Column({ type: 'int' }) amountRub!: number;
  @Column({ type: 'varchar', length: 1000 }) fulfillment!: string;
  @Column({ type: 'jsonb' }) documents!: LegalDocument[];
  @Column({ type: 'jsonb', nullable: true }) acceptedDocuments!:
    | DocumentRef[]
    | null;
  @Column({ type: 'int', nullable: true }) acceptedByUserId!: number | null;
  @Column({ type: 'timestamptz', nullable: true }) acceptedAt!: Date | null;
  @Column({ type: 'boolean', default: false }) stockReserved!: boolean;
  @Column({ type: 'timestamptz' }) expiresAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) paidAt!: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}
