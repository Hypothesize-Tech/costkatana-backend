import {
  IsString,
  IsEnum,
  IsOptional,
  MinLength,
  MaxLength,
} from 'class-validator';

export const PROVIDER_OPTIONS = [
  'openai',
  'anthropic',
  'google',
  'cohere',
  'aws-bedrock',
  'deepseek',
  'groq',
] as const;

export type ProviderKeyProvider = (typeof PROVIDER_OPTIONS)[number];

export class CreateProviderKeyDto {
  @IsString()
  @MinLength(1, { message: 'Name is required' })
  @MaxLength(100)
  name: string;

  @IsEnum(PROVIDER_OPTIONS, {
    message: `provider must be one of: ${PROVIDER_OPTIONS.join(', ')}`,
  })
  provider: ProviderKeyProvider;

  @IsString()
  @MinLength(1, { message: 'API key is required' })
  apiKey: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
