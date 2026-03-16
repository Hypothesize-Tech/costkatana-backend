import { IsString, IsOptional, IsMongoId } from 'class-validator';

export class InitiateGovernedDto {
  @IsString()
  message: string;

  @IsMongoId()
  @IsOptional()
  conversationId?: string;
}
