import { IsEmail, Length } from 'class-validator';

export class PasswordResetRequestDto {
  @IsEmail()
  @Length(6, 255)
  email!: string;
}
