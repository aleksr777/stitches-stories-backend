import { IsEmail, IsString, Length, Matches } from 'class-validator';

export class PasswordResetConfirmDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Code must contain exactly 6 digits' })
  code!: string;

  @IsEmail()
  @Length(6, 255)
  email!: string;

  @IsString()
  @Length(12, 100)
  new_password!: string;
}
