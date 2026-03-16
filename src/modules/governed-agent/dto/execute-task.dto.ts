import { IsOptional, IsString } from 'class-validator';

export class ExecuteTaskDto {
  @IsOptional()
  @IsString()
  approvalToken?: string;
}
