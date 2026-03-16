import { IsObject, IsString, IsNotEmpty } from 'class-validator';

export class ExecutePlanDto {
  @IsObject()
  plan: any; // Would be properly typed with ExecutionPlan

  @IsString()
  @IsNotEmpty()
  connectionId: string;

  @IsString()
  @IsNotEmpty()
  approvalToken: string;
}
