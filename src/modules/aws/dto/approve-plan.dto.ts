import { IsString, IsNotEmpty } from 'class-validator';

export class ApprovePlanDto {
  @IsString()
  @IsNotEmpty()
  planId: string;

  @IsString()
  @IsNotEmpty()
  connectionId: string;
}
