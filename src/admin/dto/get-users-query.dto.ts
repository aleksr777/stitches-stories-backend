import { IsInt, Min, IsOptional, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { USER_SEARCHABLE_FIELDS } from '../../common/constants/user-select-fields.constants';
import { UserSearchableFieldsType } from '../../common/types/search-users-fields.type';

export class GetUsersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;

  @IsOptional()
  @IsIn(USER_SEARCHABLE_FIELDS)
  field?: UserSearchableFieldsType;

  @IsOptional()
  @IsString()
  search?: string;
}
