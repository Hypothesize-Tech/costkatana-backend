import { IsOptional } from 'class-validator';

export class GeneratePlanDto {
  @IsOptional()
  clarifyingAnswers?: Record<string, any>;
}
