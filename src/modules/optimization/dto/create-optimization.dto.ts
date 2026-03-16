import { IsString, IsOptional, IsObject, IsBoolean } from 'class-validator';

export class CreateOptimizationDto {
  @IsOptional()
  @IsString()
  userId?: string;

  /** Frontend alias for options.enableCortex - mapped in controller */
  @IsOptional()
  @IsBoolean()
  useCortex?: boolean;

  @IsString()
  prompt: string;

  @IsString()
  service: string;

  @IsString()
  model: string;

  @IsOptional()
  @IsString()
  context?: string;

  @IsOptional()
  @IsString()
  cortexOperation?: string;

  @IsOptional()
  @IsObject()
  conversationHistory?: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: Date;
  }>;

  /** Frontend alias for options.cortexConfig - mapped in controller */
  @IsOptional()
  @IsObject()
  cortexConfig?: Record<string, unknown>;

  /**
   * Client-side network details from frontend (e.g. Navigation Timing API, geo).
   * Merged with server-extracted request tracking before save.
   */
  @IsOptional()
  @IsObject()
  requestTracking?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  options?: {
    targetReduction?: number;
    preserveIntent?: boolean;
    suggestAlternatives?: boolean;
    enableCompression?: boolean;
    enableContextTrimming?: boolean;
    enableRequestFusion?: boolean;
    enableCortex?: boolean;
    cortexConfig?: Record<string, unknown>;
  };
}
