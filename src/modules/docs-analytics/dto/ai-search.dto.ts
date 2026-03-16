import { IsString, MinLength } from 'class-validator';

export class AISearchDto {
  @IsString()
  @MinLength(2)
  query: string;
}
