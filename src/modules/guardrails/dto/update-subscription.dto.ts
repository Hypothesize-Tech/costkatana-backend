import { IsEnum, IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateSubscriptionDto {
  @IsEnum(['free', 'plus', 'pro', 'enterprise'])
  plan: 'free' | 'plus' | 'pro' | 'enterprise';

  @IsOptional()
  @IsNumber()
  @Min(1)
  seats?: number;
}
