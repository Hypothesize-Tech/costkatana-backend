import {
  IsString,
  IsNumber,
  IsOptional,
  Min,
  MaxLength,
} from 'class-validator';

export class CompareModelsDto {
  @IsString()
  @MaxLength(100)
  model1Provider: string;

  @IsString()
  @MaxLength(200)
  model1Id: string;

  @IsString()
  @MaxLength(100)
  model2Provider: string;

  @IsString()
  @MaxLength(200)
  model2Id: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  inputTokens?: number = 1000;

  @IsOptional()
  @IsNumber()
  @Min(1)
  outputTokens?: number = 1000;
}
