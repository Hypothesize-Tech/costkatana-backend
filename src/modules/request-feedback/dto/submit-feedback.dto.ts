import {
  IsBoolean,
  IsOptional,
  IsObject,
  IsNumber,
  Min,
  ValidateNested,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ImplicitSignalsDto {
  @IsOptional()
  @IsBoolean()
  copied?: boolean;

  @IsOptional()
  @IsBoolean()
  conversationContinued?: boolean;

  @IsOptional()
  @IsBoolean()
  immediateRephrase?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sessionDuration?: number;

  @IsOptional()
  @IsBoolean()
  codeAccepted?: boolean;
}

export class SubmitFeedbackDto {
  @IsBoolean({
    message: 'Rating must be a boolean (true for positive, false for negative)',
  })
  rating: boolean;

  @IsOptional()
  @MaxLength(1000)
  comment?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ImplicitSignalsDto)
  implicitSignals?: ImplicitSignalsDto;
}
