import { IsString } from 'class-validator';

export class AskAboutPlanDto {
  @IsString()
  taskId: string;

  @IsString()
  question: string;
}
