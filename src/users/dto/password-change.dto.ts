import { IsString, IsNotEmpty, Length } from 'class-validator';

export class PasswordChangeByTokenDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @Length(12, 100)
  new_password!: string;
}
