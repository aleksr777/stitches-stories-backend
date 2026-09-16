import { IsEmail, IsString, Length, Matches } from 'class-validator';

export class RegistrationConfirmDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Code must contain exactly 6 digits' })
  code!: string;

  @IsEmail()
  @Length(6, 255)
  email!: string;
}
