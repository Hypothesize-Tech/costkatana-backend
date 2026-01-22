import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { loggingService } from '../services/logging.service';

export interface AuthenticatedRequest extends Request {
    userId?: string;
    user?: any; // For permission checking
}

/**
 * Pagination metadata interface
 */
export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages?: number;
}

/**
 * Controller Helper Utilities
 * These handle the repetitive patterns found in every controller method
 */
export class ControllerHelper {
  /**
   * Checks if user is authenticated
   * This pattern appears in every authenticated controller
   * 
   * @returns true if authenticated, false otherwise (and sends 401 response)
   */
  static requireAuth(req: AuthenticatedRequest, res: Response): boolean {
    if (!req.userId) {
      loggingService.warn('Request failed - no user authentication', {
        requestId: req.headers['x-request-id'] as string,
        path: req.path
      });

      res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
      return false;
    }
    return true;
  }

  /**
   * Logs request initiation with standard fields
   * This pattern appears at the start of every controller
   */
  static logRequestStart(
    actionName: string,
    req: AuthenticatedRequest,
    additionalData?: Record<string, any>
  ): void {
    loggingService.info(`${actionName} request initiated`, {
      userId: req.userId,
      requestId: req.headers['x-request-id'] as string,
      ...additionalData
    });
  }

  /**
   * Logs request success with duration
   * This pattern appears at the end of every successful controller
   */
  static logRequestSuccess(
    actionName: string,
    req: AuthenticatedRequest,
    startTime: number,
    additionalData?: Record<string, any>
  ): void {
    const duration = Date.now() - startTime;
    
    loggingService.info(`${actionName} completed successfully`, {
      userId: req.userId,
      duration,
      requestId: req.headers['x-request-id'] as string,
      ...additionalData
    });
  }

  /**
   * Handles error response with consistent format
   * This pattern appears in every catch block
   */
  static handleError(
    actionName: string,
    error: any,
    req: AuthenticatedRequest,
    res: Response,
    startTime?: number,
    additionalContext?: Record<string, any>
  ): void {
    const duration = startTime ? Date.now() - startTime : undefined;
    
    loggingService.error(`${actionName} failed`, {
      userId: req.userId,
      error: error.message || 'Unknown error',
      stack: error.stack,
      duration,
      requestId: req.headers['x-request-id'] as string,
      ...additionalContext
    });

    res.status(500).json({
      success: false,
      message: `Failed to ${actionName.toLowerCase()}`,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }

  /**
   * Sends success response with consistent format
   */
  static sendSuccess(
    res: Response,
    data: any,
    message?: string
  ): void {
    res.json({
      success: true,
      data,
      ...(message && { message })
    });
  }

  /**
   * Sends error response with consistent format
   */
  static sendError(
    res: Response,
    statusCode: number,
    message: string,
    error?: any
  ): void {
    res.status(statusCode).json({
      success: false,
      message,
      ...(error && { error: error instanceof Error ? error.message : error })
    });
  }

  /**
   * Logs business event (common pattern after successful operations)
   */
  static logBusinessEvent(
    event: string,
    category: string,
    userId: string,
    value?: number,
    metadata?: Record<string, any>
  ): void {
    loggingService.logBusiness({
      event,
      category,
      value,
      metadata: {
        userId,
        ...metadata
      }
    });
  }

  // ============================================================
  // NEW METHODS - Added for global pattern extraction
  // ============================================================

  /**
   * Sends paginated success response with consistent format
   * Used in 30+ controllers with pagination
   * 
   * @param res - Express response object
   * @param data - Array of data items
   * @param pagination - Pagination metadata
   * @param message - Optional success message
   * 
   */
  static sendPaginatedSuccess(
    res: Response,
    data: any[],
    pagination: PaginationMeta,
    message?: string
  ): void {
    const totalPages = Math.ceil(pagination.total / pagination.limit);
    
    res.json({
      success: true,
      data,
      pagination: {
        total: pagination.total,
        page: pagination.page,
        limit: pagination.limit,
        totalPages,
        hasNextPage: pagination.page < totalPages,
        hasPrevPage: pagination.page > 1
      },
      ...(message && { message })
    });
  }

  /**
   * Checks if user has required permission
   * Used in project.controller.ts and other controllers with permissions
   * 
   * @param req - Authenticated request object
   * @param res - Express response object
   * @param permission - Required permission string or permission check function
   * @returns true if user has permission, false otherwise (and sends 403 response)
   * 
   * @example
   * ```typescript
   * if (!ControllerHelper.requirePermission(req, res, 'project:write')) {
   *   return; // 403 response already sent
   * }
   * 
   * // Or with custom function:
   * if (!ControllerHelper.requirePermission(req, res, (user) => user.role === 'admin')) {
   *   return;
   * }
   * ```
   */
  static requirePermission(
    req: AuthenticatedRequest,
    res: Response,
    permission: string | ((user: any) => boolean)
  ): boolean {
    // First ensure user is authenticated
    if (!req.userId) {
      loggingService.warn('Permission check failed - no authentication', {
        requestId: req.headers['x-request-id'] as string,
        path: req.path,
        permission: typeof permission === 'string' ? permission : 'custom'
      });

      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return false;
    }

    // Check permission
    const hasPermission = typeof permission === 'function'
      ? permission(req.user)
      : req.user?.permissions?.includes(permission);

    if (!hasPermission) {
      loggingService.warn('Permission check failed - insufficient permissions', {
        userId: req.userId,
        requestId: req.headers['x-request-id'] as string,
        path: req.path,
        requiredPermission: typeof permission === 'string' ? permission : 'custom'
      });

      res.status(403).json({
        success: false,
        message: 'Forbidden - insufficient permissions'
      });
      return false;
    }

    return true;
  }

  /**
   * Gets optional user ID from request
   * Used in project.controller.ts and other controllers with optional auth
   * 
   * @param req - Authenticated request object
   * @returns user ID if authenticated, undefined otherwise (does NOT send response)
   * 
   * @example
   * ```typescript
   * const userId = ControllerHelper.getOptionalUserId(req);
   * if (userId) {
   *   // Return user-specific data
   * } else {
   *   // Return public data
   * }
   * ```
   */
  static getOptionalUserId(req: AuthenticatedRequest): string | undefined {
    return req.userId;
  }

  /**
   * Checks for validation errors from express-validator and sends error response
   * Used in controllers with manual validation checks
   * 
   * @param req - Express request object
   * @param res - Express response object
   * @returns true if there are validation errors (and sends 400 response), false if valid
   * 
   * @example
   * ```typescript
   * if (ControllerHelper.sendValidationErrors(req, res)) {
   *   return; // 400 response already sent
   * }
   * // Continue with valid data
   * ```
   */
  static sendValidationErrors(req: Request, res: Response): boolean {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
      loggingService.warn('Validation errors in request', {
        requestId: req.headers['x-request-id'] as string,
        path: req.path,
        errors: errors.array()
      });

      res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
      return true;
    }

    return false;
  }

  /**
   * Checks if user is authenticated (optional variant that doesn't send response)
   * Useful when you want to handle the response yourself
   * 
   * @param req - Authenticated request object
   * @returns true if authenticated, false otherwise
   * 
   * @example
   * ```typescript
   * if (!ControllerHelper.isAuthenticated(req)) {
   *   return res.status(401).json({ custom: 'response' });
   * }
   * ```
   */
  static isAuthenticated(req: AuthenticatedRequest): boolean {
    return !!req.userId;
  }

  /**
   * Extracts pagination parameters from query with defaults
   * Helper to standardize pagination parameter extraction
   * 
   * @param req - Express request object
   * @returns Object with limit, offset, and page
   * 
   * @example
   * ```typescript
   * const { limit, offset, page } = ControllerHelper.getPaginationParams(req);
   * const users = await User.find().skip(offset).limit(limit);
   * ```
   */
  static getPaginationParams(req: Request): { limit: number; offset: number; page: number } {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const offset = parseInt(req.query.offset as string) || ((page - 1) * limit);

    return { limit, offset, page };
  }
}
