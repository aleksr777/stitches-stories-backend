import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/entities/user.entity';

export type DeliveryAddressDetails = {
  region: string | null;
  city: string;
  street: string;
  house: string;
  apartment: string | null;
  postalCode: string | null;
};

@Entity('delivery_address')
@Index('IDX_delivery_address_user', ['userId'])
export class DeliveryAddress implements DeliveryAddressDetails {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'int' }) userId!: number;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'userId',
    foreignKeyConstraintName: 'FK_delivery_address_user',
  })
  user!: User;
  @Column({ type: 'varchar', length: 150, nullable: true }) region!:
    | string
    | null;
  @Column({ type: 'varchar', length: 150 }) city!: string;
  @Column({ type: 'varchar', length: 200 }) street!: string;
  @Column({ type: 'varchar', length: 40 }) house!: string;
  @Column({ type: 'varchar', length: 40, nullable: true }) apartment!:
    | string
    | null;
  @Column({ type: 'varchar', length: 6, nullable: true }) postalCode!:
    | string
    | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}
