import { IsEmail, IsNotEmpty, Length, IsString } from 'class-validator';
export class LoginDto {
  @Length(6, 255)
  @IsEmail()
  email!: string;

  @IsNotEmpty()
  @IsString()
  password!: string;
}
