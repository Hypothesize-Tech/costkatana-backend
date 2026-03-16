import {
  IsString,
  IsOptional,
  IsInt,
  IsObject,
  Min,
  Max,
  Length,
} from 'class-validator';

/**
 * DTO for agent feedback requests (POST /api/agent/feedback)
 * Matches Express validation: body('insight'), body('rating'), body('metadata')
 */
export class AgentFeedbackDto {
  @IsString()
  @Length(10, 2000, {
    message: 'Insight must be between 10 and 2000 characters',
  })
  insight: string;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'Rating must be between 1 and 5' })
  @Max(5, { message: 'Rating must be between 1 and 5' })
  rating?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
