import {
  IsArray,
  IsNotEmpty,
  IsString,
  ValidateNested,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateOptimizationDto } from './create-optimization.dto';

export class BatchOptimizationDto {
  @IsArray()
  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateOptimizationDto)
  optimizations: CreateOptimizationDto[];

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsBoolean()
  parallel?: boolean = true;
}
