import { IsString, Length } from 'class-validator';

export class DeleteCurrentUserDto {
  @IsString()
  @Length(8, 100)
  password!: string;
}
