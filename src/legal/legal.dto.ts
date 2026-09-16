import { Type } from 'class-transformer';
import {
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
export class DocumentRefDto {
  @IsString() @Length(1, 80) id!: string;
  @IsString() @Length(1, 100) version!: string;
  @Matches(/^[a-f0-9]{64}$/) sha256!: string;
}
export class AcceptanceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => DocumentRefDto)
  documents!: DocumentRefDto[];
}
