import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export const normalizeCategoryName = (name: string) =>
  name.normalize('NFKC').trim().replace(/\s+/gu, ' ');

export class CategoryDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeCategoryName(value) : value,
  )
  @IsString()
  @Length(1, 100)
  name!: string;
}
