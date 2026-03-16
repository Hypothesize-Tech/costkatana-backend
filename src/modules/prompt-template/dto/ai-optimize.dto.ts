import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsIn,
  IsBoolean,
} from 'class-validator';

export class AIOptimizeDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['token', 'cost', 'quality', 'model-specific'])
  optimizationType: 'token' | 'cost' | 'quality' | 'model-specific';

  @IsOptional()
  @IsString()
  targetModel?: string;

  @IsOptional()
  @IsBoolean()
  preserveIntent?: boolean;
}
