import { IsEmail, IsOptional, MaxLength } from 'class-validator';

export class ContactEmailChangeRequestDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  new_email!: string | null;
}
