import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class JournalPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(24) limit = 12;
}
export class JournalQueueDto extends JournalPageDto {
  @IsOptional() @IsIn(['pending', 'published', 'rejected']) status:
    | 'pending'
    | 'published'
    | 'rejected' = 'pending';
}
export class JournalSourceDto {
  @IsString() @MaxLength(200) pageUrl!: string;
}
export class JournalImportDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset = 0;
}
export class JournalRevisionDto {
  @IsInt() @Min(1) @Max(2147483646) revision!: number;
}
export class JournalModerateDto extends JournalRevisionDto {
  @IsIn(['pending', 'published', 'rejected']) status!:
    | 'pending'
    | 'published'
    | 'rejected';
}
