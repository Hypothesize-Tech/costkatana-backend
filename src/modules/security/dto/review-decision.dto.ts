import { IsIn, IsOptional, IsString } from 'class-validator';

export class ReviewDecisionDto {
  @IsIn(['approved', 'denied'])
  decision: 'approved' | 'denied';

  @IsOptional()
  @IsString()
  comments?: string;
}
