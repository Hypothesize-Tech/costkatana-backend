import { IsIn } from 'class-validator';

const INTERACTIONS = ['display', 'click', 'dismiss', 'success'] as const;

export class TrackTipInteractionDto {
  @IsIn(INTERACTIONS, {
    message: `interaction must be one of: ${INTERACTIONS.join(', ')}`,
  })
  interaction: (typeof INTERACTIONS)[number];
}
