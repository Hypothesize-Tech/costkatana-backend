import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';

/**
 * DTO for keyId route parameter (deactivate, regenerate).
 */
export class KeyIdParamDto {
  @IsString()
  @IsNotEmpty({ message: 'Key ID is required' })
  @MinLength(1, { message: 'Invalid key ID format' })
  @MaxLength(32, { message: 'Invalid key ID format' })
  keyId: string;
}
