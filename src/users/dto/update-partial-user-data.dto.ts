import { IsString, IsInt, IsOptional, Length, Min, Max } from 'class-validator';

export class UpdatePartialUserDataDto {
  @IsOptional()
  @IsString()
  @Length(2, 50)
  nickname?: string | null;

  @IsOptional()
  @IsString()
  @Length(2, 200)
  name?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  age?: number | null;
}
