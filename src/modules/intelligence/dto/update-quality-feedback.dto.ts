import {
  IsBoolean,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateQualityFeedbackDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: 1 | 2 | 3 | 4 | 5;

  @IsBoolean()
  isAcceptable: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
