import { IsEmail, IsString, Length } from 'class-validator';

export class RegistrationRequestDto {
  @IsEmail()
  @Length(6, 255)
  email!: string;

  @IsString()
  @Length(12, 100)
  password!: string;
}
