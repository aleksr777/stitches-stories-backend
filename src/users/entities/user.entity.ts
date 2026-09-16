import { Role } from '../../common/types/role.enum';

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  IsEmail,
  IsPhoneNumber,
  IsString,
  Length,
  IsNotEmpty,
  IsOptional,
  Min,
  Max,
  IsNumber,
  MaxLength,
} from 'class-validator';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @CreateDateColumn({
    default: () => 'CURRENT_TIMESTAMP',
    name: 'created_at',
    type: 'timestamp',
    select: false,
  })
  created_at!: Date;

  @UpdateDateColumn({
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
    name: 'updated_at',
    type: 'timestamp',
    select: false,
  })
  updated_at!: Date;

  @Column({
    type: 'timestamp',
    name: 'last_activity_at',
    nullable: true,
  })
  last_activity_at?: Date;

  @IsEmail()
  @Length(6, 255)
  @Column({
    type: 'varchar',
    name: 'email',
    unique: true,
    select: false,
    length: 255,
    nullable: false,
  })
  email!: string;

  @IsPhoneNumber()
  @IsOptional()
  @Column({
    type: 'varchar',
    name: 'phone_number',
    nullable: true,
    select: false,
    length: 30,
  })
  phone_number?: string | null;

  @IsOptional()
  @IsString()
  @Length(2, 50)
  @Column({
    type: 'varchar',
    name: 'nickname',
    unique: true,
    nullable: true,
    length: 50,
  })
  nickname?: string | null;

  @IsString()
  @Length(12, 100)
  @Column({
    type: 'varchar',
    name: 'password',
    length: 100,
    select: false,
  })
  password!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(20)
  @Column({
    type: 'varchar',
    name: 'role',
    length: 20,
    default: Role.USER,
  })
  role!: Role;

  @Column({
    type: 'boolean',
    name: 'is_blocked',
    default: false,
  })
  is_blocked!: boolean;

  @IsOptional()
  @Column({
    type: 'timestamp',
    name: 'blocked_at',
    nullable: true,
    default: null,
  })
  blocked_at?: Date | null;

  @IsOptional()
  @Column({
    type: 'int',
    name: 'blocked_by',
    nullable: true,
    default: null,
  })
  blocked_by?: number | null;

  @IsOptional()
  @Column({
    type: 'varchar',
    name: 'blocked_reason',
    length: 255,
    nullable: true,
    default: null,
  })
  blocked_reason?: string | null;

  @IsOptional()
  @IsString()
  @Length(2, 200)
  @Column({
    type: 'varchar',
    name: 'name',
    length: 200,
    nullable: true,
    default: null,
  })
  name?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(200)
  @Column({
    type: 'smallint',
    name: 'age',
    nullable: true,
    default: null,
  })
  age?: number | null;
}
