import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class SimilarConversationsQueryDto {
  @IsString()
  @IsNotEmpty({ message: 'Query is required' })
  query: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  @Transform(({ value }) => parseInt(value))
  limit?: number;
}
