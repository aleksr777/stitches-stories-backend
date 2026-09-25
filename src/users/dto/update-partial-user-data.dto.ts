import { IsString, IsOptional, Length } from 'class-validator';

export class UpdatePartialUserDataDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  name?: string | null;
}
