import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export type SocialProvider = 'yandex' | 'vk';
export type SocialIdentityRef = { provider: SocialProvider; subject: string };
export type SocialProfile = {
  name?: string;
  sex?: 'male' | 'female';
  phone?: string;
  email?: string;
};
export type SocialPendingIdentity = SocialIdentityRef & {
  profile?: SocialProfile;
};

@Entity('social_identity')
@Unique(['provider', 'subject'])
@Unique(['userId', 'provider'])
export class SocialIdentity {
  @PrimaryGeneratedColumn() id!: number;
  @Column({ type: 'varchar', length: 16 }) provider!: SocialProvider;
  @Column({ type: 'varchar', length: 255 }) subject!: string;
  @Column({ type: 'integer' }) userId!: number;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;
}
