import { Injectable, Logger } from '@nestjs/common';
import { LoggingService } from './logging.service';

export interface AuthenticatedRequest {
  user?: {
    id: string;
    _id?: string;
    email?: string;
    role?: string;
    permissions?: string[];
    sessionId?: string;
    apiKeyId?: string;
  };
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages?: number;
  hasNextPage?: boolean;
  hasPrevPage?: boolean;
}

@Injectable()
export class ControllerHelper {
  private readonly logger = new Logger(ControllerHelper.name);

  constructor(private readonly loggingService: LoggingService) {}

  /**
   * Logs request initiation with standard fields
   * This pattern appears at the start of every controller
   */
  logRequestStart(
    actionName: string,
    req?: AuthenticatedRequest,
    additionalData?: Record<string, any>,
  ): void {
    this.loggingService.info(`${actionName} request initiated`, {
      userId: req?.user?.id,
      ...additionalData,
    });
  }

  /**
   * Logs request success with duration
   * This pattern appears at the end of every successful controller
   * Overload: (actionName, req, startTime) or (actionName, startTime) when req not available
   */
  logRequestSuccess(
    actionName: string,
    reqOrStartTime: AuthenticatedRequest | number,
    startTimeOrData?: number | Record<string, any>,
    additionalData?: Record<string, any>,
  ): void {
    const req: AuthenticatedRequest | undefined =
      typeof reqOrStartTime === 'number' ? undefined : reqOrStartTime;
    const startTime =
      typeof reqOrStartTime === 'number'
        ? reqOrStartTime
        : (startTimeOrData as number);
    const extra =
      typeof startTimeOrData === 'object' && startTimeOrData !== null
        ? startTimeOrData
        : additionalData;
    const duration = Date.now() - startTime;
    this.loggingService.info(`${actionName} completed successfully`, {
      userId: req?.user?.id,
      duration,
      ...extra,
    });
  }

  /**
   * Handles error response with consistent format
   * This pattern appears in every catch block
   * Overload: (actionName, error, req, startTime?) or (actionName, error, startTime?) when req not available
   */
  handleError(
    actionName: string,
    error: any,
    reqOrStartTime?: AuthenticatedRequest | number,
    startTimeOrContext?: number | Record<string, any>,
    additionalContext?: Record<string, any>,
  ): never {
    const req: AuthenticatedRequest | undefined =
      reqOrStartTime !== undefined && typeof reqOrStartTime === 'object'
        ? reqOrStartTime
        : undefined;
    const startTime =
      typeof reqOrStartTime === 'number'
        ? reqOrStartTime
        : typeof startTimeOrContext === 'number'
          ? startTimeOrContext
          : undefined;
    const context =
      typeof startTimeOrContext === 'object'
        ? startTimeOrContext
        : additionalContext;
    const duration = startTime ? Date.now() - startTime : undefined;
    this.loggingService.error(`${actionName} failed`, {
      userId: req?.user?.id,
      error: error?.message || 'Unknown error',
      stack: error?.stack,
      duration,
      ...context,
    });
    throw error;
  }

  /**
   * Logs business event (common pattern after successful operations)
   */
  logBusinessEvent(
    event: string,
    category: string,
    userId: string,
    value?: number,
    metadata?: Record<string, any>,
  ): void {
    this.loggingService.logBusiness({
      event,
      category,
      value,
      metadata: {
        userId,
        ...metadata,
      },
    });
  }

  /**
   * Sends paginated success response with consistent format
   * Used in 30+ controllers with pagination
   */
  createPaginatedSuccessResponse<T>(
    data: T[],
    pagination: PaginationMeta,
    message?: string,
  ): {
    success: boolean;
    data: T[];
    pagination: PaginationMeta;
    message?: string;
  } {
    const totalPages = Math.ceil(pagination.total / pagination.limit);

    return {
      success: true,
      data,
      pagination: {
        total: pagination.total,
        page: pagination.page,
        limit: pagination.limit,
        totalPages,
        hasNextPage: pagination.page < totalPages,
        hasPrevPage: pagination.page > 1,
      },
      ...(message && { message }),
    };
  }

  /**
   * Gets optional user ID from request
   * Used in controllers with optional auth
   */
  getOptionalUserId(req: AuthenticatedRequest): string | undefined {
    return req.user?.id;
  }

  /**
   * Gets pagination parameters from query with defaults
   */
  getPaginationParams(query: any): {
    limit: number;
    offset: number;
    page: number;
  } {
    const limit = Math.min(parseInt(query.limit as string) || 20, 100);
    const page = Math.max(parseInt(query.page as string) || 1, 1);
    const offset = parseInt(query.offset as string) || (page - 1) * limit;

    return { limit, offset, page };
  }

  /**
   * Checks if user is authenticated (optional variant that doesn't send response)
   * Useful when you want to handle the response yourself
   */
  isAuthenticated(req: AuthenticatedRequest): boolean {
    return !!req.user?.id;
  }
}
