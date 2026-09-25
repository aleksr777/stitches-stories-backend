import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export class UpdatePartialUserDataDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  name?: string | null;

  @IsOptional()
  @Matches(/^[+0-9 ()-]{6,30}$/)
  phone_number?: string | null;

  @IsOptional()
  @IsIn(['male', 'female'])
  sex?: 'male' | 'female' | null;
}
