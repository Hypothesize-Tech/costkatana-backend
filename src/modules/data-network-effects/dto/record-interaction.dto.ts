import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsNumber,
  IsIn,
} from 'class-validator';

export class RecordInteractionDto {
  @IsNotEmpty()
  @IsString()
  recommendationId: string;

  @IsNotEmpty()
  @IsIn(['viewed', 'accepted', 'rejected', 'dismissed'])
  status: 'viewed' | 'accepted' | 'rejected' | 'dismissed';

  @IsOptional()
  @IsString()
  feedback?: string;

  @IsOptional()
  @IsNumber()
  rating?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
