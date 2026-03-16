import {
  IsArray,
  IsOptional,
  IsDateString,
  IsString,
  ArrayMinSize,
} from 'class-validator';

export class CompareTagsDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(2, { message: 'At least 2 tags are required for comparison' })
  tags: string[];

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
