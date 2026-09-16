import {
  Entity,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { LegalDocument } from './legal.types';
@Entity('legal_document')
export class LegalDocumentEntity {
  @PrimaryColumn({ type: 'varchar', length: 80 }) id!: string;
  @PrimaryColumn({ type: 'varchar', length: 100 }) version!: string;
  @Column({ type: 'varchar', length: 64 }) sha256!: string;
  @Column({ type: 'jsonb' }) content!: LegalDocument;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}
@Entity('consent_event')
@Index(['userId', 'createdAt'])
export class ConsentEvent {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'int', nullable: true }) userId!: number | null;
  @Column({ type: 'uuid', nullable: true }) subscriptionId!: string | null;
  @Column({ type: 'varchar', length: 80 }) documentId!: string;
  @Column({ type: 'varchar', length: 100 }) version!: string;
  @Column({ type: 'varchar', length: 64 }) sha256!: string;
  @Column({ type: 'varchar', length: 60 }) purpose!: string;
  @Column({ type: 'varchar', length: 20 }) action!:
    | 'grant'
    | 'accept'
    | 'withdraw';
  @Column({ type: 'varchar', length: 60 }) source!: string;
  @Column({ type: 'varchar', length: 80 }) verification!: string;
  @Column({ type: 'varchar', length: 16 }) documentStatus!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}
