import { IsString } from 'class-validator';

/**
 * Query DTO for GET /ckql/suggestions - partial_query query param.
 */
export class GetSuggestionsQueryDto {
  @IsString({ message: 'partial_query is required' })
  partial_query!: string;
}
