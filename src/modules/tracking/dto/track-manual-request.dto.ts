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

  /** When provided with outputTokens, enables accurate billing. Omit to use 70/30 input/output estimate. */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Transform(({ value }) => (value != null ? parseFloat(value) : undefined))
  inputTokens?: number;

  /** When provided with inputTokens, enables accurate billing. Omit to use 70/30 input/output estimate. */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Transform(({ value }) => (value != null ? parseFloat(value) : undefined))
  outputTokens?: number;

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
