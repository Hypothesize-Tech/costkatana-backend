import { IsString, IsNotEmpty } from 'class-validator';

export class RecommendationsQueryDto {
  @IsString()
  @IsNotEmpty({ message: 'Query is required' })
  query: string;
}
