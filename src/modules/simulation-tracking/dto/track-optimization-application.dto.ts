import {
  IsNumber,
  IsString,
  IsOptional,
  IsObject,
  Min,
  Max,
  MinLength,
} from 'class-validator';

export class UserFeedbackDto {
  @IsOptional()
  satisfied?: boolean;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  rating?: number;
}

export class TrackOptimizationApplicationDto {
  @IsNumber()
  optionIndex: number;

  @IsString()
  @MinLength(1, { message: 'type is required' })
  type: string;

  @IsNumber()
  estimatedSavings: number;

  @IsOptional()
  @IsObject()
  userFeedback?: UserFeedbackDto;
}
