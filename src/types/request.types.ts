import { Request } from 'express';

/**
 * Extended Express Request with authentication userId
 */
export interface AuthenticatedRequest extends Request {
    userId?: string;
}

