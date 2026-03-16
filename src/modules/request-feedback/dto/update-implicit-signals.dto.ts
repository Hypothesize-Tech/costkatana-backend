import { IsBoolean, IsOptional, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateImplicitSignalsDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  copied?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  conversationContinued?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  immediateRephrase?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sessionDuration?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  codeAccepted?: boolean;
}
