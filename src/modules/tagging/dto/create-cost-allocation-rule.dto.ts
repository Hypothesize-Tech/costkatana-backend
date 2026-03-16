import {
  IsString,
  IsArray,
  IsNumber,
  Min,
  Max,
  MinLength,
} from 'class-validator';

export class CreateCostAllocationRuleDto {
  @IsString()
  @MinLength(1, { message: 'Name is required' })
  name: string;

  @IsArray()
  @IsString({ each: true })
  tagFilters: string[];

  @IsNumber()
  @Min(0, { message: 'Allocation percentage must be between 0 and 100' })
  @Max(100, { message: 'Allocation percentage must be between 0 and 100' })
  allocationPercentage: number;

  @IsString()
  @MinLength(1, { message: 'Department is required' })
  department: string;

  @IsString()
  @MinLength(1, { message: 'Team is required' })
  team: string;

  @IsString()
  @MinLength(1, { message: 'Cost center is required' })
  costCenter: string;
}
