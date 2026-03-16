import {
  Injectable,
  PipeTransform,
  ArgumentMetadata,
  BadRequestException,
} from '@nestjs/common';
import { ZodSchema, ZodError } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: any, metadata: ArgumentMetadata) {
    try {
      // Only validate body, query, and params
      if (
        metadata.type === 'body' ||
        metadata.type === 'query' ||
        metadata.type === 'param'
      ) {
        return this.schema.parse(value);
      }

      // Return value as-is for other types
      return value;
    } catch (error) {
      if (error instanceof ZodError) {
        // Transform Zod errors to a more user-friendly format
        const formattedErrors = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code,
        }));

        throw new BadRequestException({
          message: 'Validation failed',
          errors: formattedErrors,
        });
      }

      // Re-throw other errors
      throw error;
    }
  }
}

// Factory function to create a pipe with a specific schema
export function ZodPipe(schema: ZodSchema) {
  return new ZodValidationPipe(schema);
}
