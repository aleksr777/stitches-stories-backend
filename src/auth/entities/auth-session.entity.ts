import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity({ name: 'auth_session' })
@Index('IDX_auth_session_user_id', ['user_id'])
@Index('IDX_auth_session_user_revoked', ['user_id', 'revoked_at'])
export class AuthSession {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'int', name: 'user_id' })
  user_id!: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({
    type: 'varchar',
    name: 'refresh_token_hash',
    length: 64,
    select: false,
  })
  refresh_token_hash!: string;

  @Column({
    type: 'varchar',
    name: 'ip_address',
    length: 45,
    nullable: true,
  })
  ip_address!: string | null;

  @Column({
    type: 'varchar',
    name: 'user_agent',
    length: 512,
    nullable: true,
  })
  user_agent!: string | null;

  @CreateDateColumn({
    type: 'timestamptz',
    name: 'created_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at!: Date;

  @Column({
    type: 'timestamptz',
    name: 'last_used_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  last_used_at!: Date;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expires_at!: Date;

  @Column({
    type: 'timestamptz',
    name: 'revoked_at',
    nullable: true,
    default: null,
  })
  revoked_at!: Date | null;

  @Column({
    type: 'varchar',
    name: 'revoked_reason',
    length: 64,
    nullable: true,
    default: null,
  })
  revoked_reason!: string | null;
}
