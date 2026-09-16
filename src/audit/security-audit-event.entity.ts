import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'security_audit_event' })
@Index('IDX_security_audit_event_occurred_at', ['occurred_at'])
@Index('IDX_security_audit_event_user_id', ['user_id'])
@Index('IDX_security_audit_event_event', ['event'])
export class SecurityAuditEvent {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  event!: string;

  @Column({ type: 'boolean', default: true })
  success!: boolean;

  @Column({ type: 'int', nullable: true })
  user_id!: number | null;

  @Column({ type: 'uuid', nullable: true })
  session_id!: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip_address!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  user_agent!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  details!: Record<string, unknown> | null;

  @CreateDateColumn({
    type: 'timestamptz',
    name: 'occurred_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  occurred_at!: Date;
}
