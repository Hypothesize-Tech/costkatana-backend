import { IsObject, IsString } from 'class-validator';

export class ModifyPlanDto {
  @IsString()
  taskId: string;

  @IsObject()
  modifications: Record<string, any>;
}
