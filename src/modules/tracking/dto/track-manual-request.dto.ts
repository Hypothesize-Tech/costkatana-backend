import {
  IsString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsIn,
  IsNotEmpty,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class TrackManualRequestDto {
  @IsString()
  @IsNotEmpty()
  model: string;

  @IsNumber()
  @IsPositive()
  @Transform(({ value }) => parseFloat(value))
  tokens: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  project?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  user?: string;

  @IsOptional()
  @IsIn(['positive', 'negative', 'neutral'])
  feedback?: 'positive' | 'negative' | 'neutral';

  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Transform(({ value }) => (value ? parseFloat(value) : undefined))
  cost?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  provider?: string;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsString()
  response?: string;
}
