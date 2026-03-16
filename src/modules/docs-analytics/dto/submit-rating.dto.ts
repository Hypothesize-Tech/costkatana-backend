import { IsIn, IsOptional, IsString, Min, Max } from 'class-validator';

export class SubmitRatingDto {
  @IsString()
  pageId: string;

  @IsString()
  pagePath: string;

  @IsString()
  @IsIn(['up', 'down'])
  rating: 'up' | 'down';

  @IsOptional()
  @Min(1)
  @Max(5)
  starRating?: number;

  @IsString()
  sessionId: string;
}
