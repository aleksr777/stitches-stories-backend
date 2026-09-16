import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length } from 'class-validator';
import { AcceptanceDto } from '../../legal/legal.dto';

export class RegistrationRequestDto extends AcceptanceDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @Length(6, 255)
  email!: string;
  @IsString() @Length(12, 100) password!: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(2, 200)
  name!: string;
}
