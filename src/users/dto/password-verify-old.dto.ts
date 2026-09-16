import { IsString, Length } from 'class-validator';

export class PasswordVerifyOldDto {
  @IsString()
  @Length(8, 100)
  old_password!: string;
}
