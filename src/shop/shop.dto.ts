import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AcceptanceDto, DocumentRefDto } from '../legal/legal.dto';
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const email = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
export class RequestItemDto {
  @IsUUID() productId!: string;
  @IsInt() @Min(1) @Max(10) quantity!: number;
  @IsInt() @Min(1) @Max(1000000) expectedPriceRub!: number;
}
export class CreateRequestDto {
  @IsUUID() requestKey!: string;
  @Transform(trim) @IsString() @Length(2, 200) name!: string;
  @Transform(email) @IsEmail() @MaxLength(255) email!: string;
  @IsOptional() @Matches(/^[+\d ()-]{6,30}$/) phone?: string;
  @Transform(trim) @IsString() @Length(2, 150) city!: string;
  @IsOptional() @IsString() @MaxLength(1500) comment?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => RequestItemDto)
  items!: RequestItemDto[];
  @IsDefined()
  @ValidateNested()
  @Type(() => DocumentRefDto)
  document!: DocumentRefDto;
}
export class ProductDto {
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(100) slug!: string;
  @Transform(trim) @IsString() @Length(2, 200) name!: string;
  @IsIn(['keychains', 'covers']) category!: string;
  @IsInt() @Min(1) @Max(1000000) priceRub!: number;
  @IsString() @Length(10, 6000) description!: string;
  @IsString() @Length(2, 250) materials!: string;
  @IsString() @Length(2, 100) dimensions!: string;
  @IsString() @Length(2, 160) productionTime!: string;
  @IsArray()
  @ArrayMaxSize(8)
  @Matches(/^\/images\/[a-zA-Z0-9_-]+\.(webp|png|jpg|jpeg)$/, { each: true })
  images!: string[];
  @IsInt() @Min(0) @Max(10000) stock!: number;
  @IsBoolean() featured!: boolean;
  @IsBoolean() active!: boolean;
  @IsBoolean() isDemo!: boolean;
}
export class RequestStatusDto {
  @IsIn(['new', 'contacted', 'agreed', 'closed']) status!: string;
}
export class NewsletterDto extends AcceptanceDto {
  @Transform(email) @IsEmail() @MaxLength(255) email!: string;
}
export class TokenDto {
  @Matches(/^[a-f0-9]{64}$/) token!: string;
}
export class WithdrawDto {
  @IsIn(['account', 'marketing']) purpose!: string;
}
