import {
  IsArray,
  IsOptional,
  ValidateNested,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

class BenchmarkModelDto {
  @IsString()
  @MaxLength(100)
  provider: string;

  @IsString()
  @MaxLength(200)
  modelId: string;
}

export class RunBenchmarkDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BenchmarkModelDto)
  models: BenchmarkModelDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  testPrompts?: string[];
}
