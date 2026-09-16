import { IsEmail, IsString, Length } from 'class-validator';

export class EmailChangeRequestDto {
  @IsEmail()
  new_email!: string;

  @IsString()
  @Length(8, 100)
  current_password!: string;
}
