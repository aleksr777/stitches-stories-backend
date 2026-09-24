import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { DocumentRefDto } from '../../legal/legal.dto';

export class IssuePaymentDto {
  @IsInt() @Min(0) @Max(100000) deliveryRub!: number;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(5, 1000)
  fulfillment!: string;
}
export class StartPaymentDto {
  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => DocumentRefDto)
  documents!: DocumentRefDto[];
}
