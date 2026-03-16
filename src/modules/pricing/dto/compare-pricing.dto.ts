import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  Min,
  MaxLength,
} from 'class-validator';

export class ComparePricingDto {
  @IsString()
  @MaxLength(200)
  task: string;

  @IsNumber()
  @Min(1)
  estimatedTokens: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  providers?: string[];
}
