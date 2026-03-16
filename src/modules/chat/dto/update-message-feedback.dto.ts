import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMessageFeedbackDto {
  @IsIn(['positive', 'negative', 'neutral'])
  feedback: 'positive' | 'negative' | 'neutral';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
