import { Injectable, Catch, ArgumentsHost, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Request, Response } from 'express';

@Injectable()
@Catch()
export class CortexErrorFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(CortexErrorFilter.name);

  catch(exception: any, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    // Check if this is a Cortex-related error and request had Cortex enabled
    if (request.cortex?.enabled && exception.message?.includes('Cortex')) {
      this.logger.error('Cortex processing error', {
        error: exception,
        path: request.path,
        method: request.method,
      });

      // Continue without Cortex optimization on error
      response.setHeader('X-Cortex-Error', 'true');
      response.setHeader('X-Cortex-Error-Message', exception.message);

      // Don't expose internal errors to client in production
      if (process.env.NODE_ENV === 'production') {
        exception.message = 'Request processing failed';
      }
    }

    // Call parent to handle the exception normally
    super.catch(exception, host);
  }
}
