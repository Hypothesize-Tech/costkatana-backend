import { IsObject, IsString, IsNotEmpty } from 'class-validator';
import type { ExecutionPlan } from '../types/aws-dsl.types';

export class ExecutePlanDto {
  @IsObject()
  plan: ExecutionPlan;

  @IsString()
  @IsNotEmpty()
  connectionId: string;

  @IsString()
  @IsNotEmpty()
  approvalToken: string;
}
