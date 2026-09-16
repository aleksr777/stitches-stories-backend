import { IsString, Length } from 'class-validator';

export class AdminPasswordDto {
  @IsString()
  @Length(8, 100)
  password!: string;
}
