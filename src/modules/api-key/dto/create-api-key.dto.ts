import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';

/**
 * DTO for creating a new ChatGPT integration API key.
 * Key is returned only on creation.
 */
export class CreateApiKeyDto {
  @IsString()
  @IsNotEmpty({ message: 'API key name is required' })
  @MinLength(1, { message: 'API key name must be at least 1 character' })
  @MaxLength(50, { message: 'API key name must be at most 50 characters' })
  name: string;
}
