import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export type JournalStatus = 'pending' | 'published' | 'rejected';

@Entity('journal_source')
@Check('"id" = 1')
export class JournalSource {
  @PrimaryColumn({ type: 'integer' }) id!: number;
  @Column({ type: 'varchar', length: 100 }) domain!: string;
}

@Entity('journal_post')
@Unique(['vkOwnerId', 'vkPostId'])
@Index(['status', 'sourcePublishedAt'])
@Check(`"status" IN ('pending', 'published', 'rejected')`)
export class JournalPost {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'bigint' }) vkOwnerId!: string;
  @Column({ type: 'bigint' }) vkPostId!: string;
  @Column({ type: 'text' }) text!: string;
  @Column({ type: 'timestamptz' }) sourcePublishedAt!: Date;
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: JournalStatus;
  @Column({ type: 'integer', default: 1 }) revision!: number;
  @Column({ type: 'jsonb', default: '[]' }) otherAttachments!: string[];
  @CreateDateColumn({ type: 'timestamptz' }) importedAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) publishedAt!: Date | null;
  @OneToMany(() => JournalPhoto, (photo) => photo.post) photos!: JournalPhoto[];
}

@Entity('journal_photo')
@Unique(['postId', 'position'])
export class JournalPhoto {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) postId!: string;
  @ManyToOne(() => JournalPost, (post) => post.photos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'postId' })
  post!: JournalPost;
  @Column({ type: 'integer' }) position!: number;
  @Column({ type: 'text', select: false }) sourceUrl!: string;
  @Column({ type: 'integer' }) width!: number;
  @Column({ type: 'integer' }) height!: number;
  @Column({ type: 'bytea', nullable: true, select: false })
  data!: Buffer | null;
  @Column({ type: 'varchar', length: 32, nullable: true, select: false })
  mime!: string | null;
}

@Entity('journal_review')
export class JournalReview {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) postId!: string;
  @Column({ type: 'integer' }) administratorId!: number;
  @Column({ type: 'integer' }) revision!: number;
  @Column({ type: 'varchar', length: 16 }) action!: JournalStatus | 'refresh';
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}

export const journalEntities = [
  JournalSource,
  JournalPost,
  JournalPhoto,
  JournalReview,
];
