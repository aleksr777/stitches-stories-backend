import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  PrimaryColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { DocumentRef } from '../legal/legal.types';
@Entity('product')
export class Product {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 100, unique: true }) slug!: string;
  @Column({ type: 'varchar', length: 200 }) name!: string;
  @Column({ type: 'varchar', length: 30 }) category!: string;
  @Column({ type: 'int' }) priceRub!: number;
  @Column({ type: 'text' }) description!: string;
  @Column({ type: 'varchar', length: 250 }) materials!: string;
  @Column({ type: 'varchar', length: 100 }) dimensions!: string;
  @Column({ type: 'varchar', length: 160 }) productionTime!: string;
  @Column({ type: 'jsonb', default: () => "'[]'" }) images!: string[];
  @Column({ type: 'int', default: 0 }) stock!: number;
  @Column({ type: 'boolean', default: false }) featured!: boolean;
  @Column({ type: 'boolean', default: true }) active!: boolean;
  @Column({ type: 'boolean', default: true }) isDemo!: boolean;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
@Entity('product_image')
@Index(['productId'])
export class ProductImage {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) productId!: string;
  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productId' })
  product!: Product;
  @Column({ type: 'bytea', select: false }) data!: Buffer;
  @Column({ type: 'varchar', length: 32 }) mime!: string;
  @Column({ type: 'varchar', length: 64 }) sha256!: string;
  @Column({ type: 'integer' }) width!: number;
  @Column({ type: 'integer' }) height!: number;
  @Column({ type: 'integer' }) byteLength!: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}
export type OrderLine = {
  productId: string;
  slug: string;
  name: string;
  quantity: number;
  priceRub: number;
};
@Entity('order_request')
@Index(['userId', 'createdAt'])
export class OrderRequest {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid', unique: true }) requestKey!: string;
  @Column({ type: 'varchar', length: 64 }) payloadHash!: string;
  @Column({ type: 'int', nullable: true }) userId!: number | null;
  @Column({ type: 'varchar', length: 200 }) name!: string;
  @Column({ type: 'varchar', length: 255 }) email!: string;
  @Column({ type: 'varchar', length: 30, nullable: true }) phone!:
    | string
    | null;
  @Column({ type: 'varchar', length: 150 }) city!: string;
  @Column({ type: 'varchar', length: 1500, default: '' }) comment!: string;
  @Column({ type: 'jsonb' }) items!: OrderLine[];
  @Column({ type: 'int' }) subtotalRub!: number;
  @Column({ type: 'varchar', length: 20, default: 'new' }) status!: string;
  @Column({ type: 'jsonb' }) document!: DocumentRef;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
@Entity('favorite')
export class Favorite {
  @PrimaryColumn({ type: 'int' }) userId!: number;
  @PrimaryColumn({ type: 'uuid' }) productId!: string;
}
@Entity('subscription')
export class Subscription {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 255, unique: true }) email!: string;
  @Column({ type: 'int', nullable: true }) userId!: number | null;
  @Column({ type: 'boolean', default: false }) active!: boolean;
  @Column({ type: 'timestamptz', nullable: true }) activeUntil!: Date | null;
  @Index() @Column({ type: 'varchar', length: 64, nullable: true }) tokenHash!:
    | string
    | null;
  @Column({ type: 'timestamptz', nullable: true }) tokenExpiresAt!: Date | null;
  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  unsubscribeHash!: string | null;
  @Column({ type: 'jsonb' }) documents!: DocumentRef[];
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
export const shopEntities = [
  Product,
  ProductImage,
  OrderRequest,
  Favorite,
  Subscription,
];
