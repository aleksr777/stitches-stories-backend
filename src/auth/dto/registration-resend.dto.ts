import { IsEmail, Length } from 'class-validator';

export class RegistrationResendDto {
  @IsEmail()
  @Length(6, 255)
  email!: string;
}
