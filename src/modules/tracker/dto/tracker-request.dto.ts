import {
  IsString,
  IsNumber,
  IsOptional,
  IsPositive,
  Min,
  Max,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class TrackerRequestDto {
  @IsString()
  model: string;

  @IsString()
  prompt: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Transform(({ value }) => (value != null ? Number(value) : undefined))
  maxTokens?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  @Transform(({ value }) => (value != null ? Number(value) : undefined))
  temperature?: number;
}
