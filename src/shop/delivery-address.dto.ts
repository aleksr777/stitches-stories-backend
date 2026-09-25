import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import type { DeliveryAddressDetails } from './delivery-address.entity';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimOptional = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class DeliveryAddressDto {
  @Transform(trimOptional)
  @IsOptional()
  @IsString()
  @Length(2, 150)
  region?: string | null;
  @Transform(trim) @IsString() @Length(2, 150) city!: string;
  @Transform(trim) @IsString() @Length(2, 200) street!: string;
  @Transform(trim) @IsString() @Length(1, 40) house!: string;
  @Transform(trimOptional)
  @IsOptional()
  @IsString()
  @Length(1, 40)
  apartment?: string | null;
  @Transform(trimOptional)
  @IsOptional()
  @Matches(/^\d{6}$/)
  postalCode?: string | null;
}

export const addressDetails = (
  address: DeliveryAddressDto,
): DeliveryAddressDetails => ({
  region: address.region?.trim() || null,
  city: address.city.trim(),
  street: address.street.trim(),
  house: address.house.trim(),
  apartment: address.apartment?.trim() || null,
  postalCode: address.postalCode?.trim() || null,
});
