import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class BlockUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  blocked_reason?: string;

  @IsString()
  @Length(8, 100)
  password!: string;
}
