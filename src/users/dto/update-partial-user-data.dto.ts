import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdatePartialUserDataDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  name?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  contact_email?: string | null;

  @IsOptional()
  @Matches(/^[+0-9 ()-]{6,30}$/)
  phone_number?: string | null;

  @IsOptional()
  @IsIn(['male', 'female'])
  sex?: 'male' | 'female' | null;
}
