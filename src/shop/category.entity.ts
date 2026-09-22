import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('product_category')
@Index('UQ_product_category_name_key', ['nameKey'], { unique: true })
export class ProductCategory {
  // Legacy IDs keep existing catalog links working; new categories use UUIDs.
  @PrimaryColumn({ type: 'varchar', length: 36 }) id!: string;
  @Column({ type: 'varchar', length: 100 }) name!: string;
  @Column({ type: 'varchar', length: 100, select: false }) nameKey!: string;
}
