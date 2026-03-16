import { IsObject, IsString, IsNotEmpty } from 'class-validator';

export class SimulatePlanDto {
  @IsObject()
  plan: any; // Would be properly typed with ExecutionPlan

  @IsString()
  @IsNotEmpty()
  connectionId: string;
}
