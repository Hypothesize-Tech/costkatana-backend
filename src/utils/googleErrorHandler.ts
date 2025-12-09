/**
 * Google API Error Handler
 * Centralizes error categorization and user-friendly messaging for Google Workspace integrations
 */

import { loggingService } from '../services/logging.service';

export enum GoogleErrorType {
    AUTH_EXPIRED = 'auth_expired',
    AUTH_REVOKED = 'auth_revoked',
    SCOPE_MISSING = 'scope_missing',
    RATE_LIMIT = 'rate_limit',
    QUOTA_EXCEEDED = 'quota_exceeded',
    NOT_FOUND = 'not_found',
    PERMISSION_DENIED = 'permission_denied',
    ORG_RESTRICTION = 'org_restriction',
    INVALID_INPUT = 'invalid_input',
    UNKNOWN = 'unknown'
}

export interface GoogleError {
    type: GoogleErrorType;
    service: string;
    operation: string;
    message: string;
    userMessage: string;
    actionRequired: string;
    details?: any;
    retryAfter?: number; // seconds to wait before retry
}

/**
 * Parse Google API error and return structured error information
 */
export function parseGoogleApiError(error: any, service: string, operation: string): GoogleError {
    const statusCode = error.code || error.status || error.response?.status;
    const errorMessage = error.message || error.error?.message || 'Unknown error';
    const errorDetails = error.response?.data || error.error || {};

    loggingService.error('Google API Error', {
        service,
        operation,
        statusCode,
        errorMessage,
        errorDetails
    });

    // Check for auth errors (401)
    if (statusCode === 401) {
        if (errorMessage.toLowerCase().includes('invalid_grant') || 
            errorMessage.toLowerCase().includes('token expired') ||
            errorMessage.toLowerCase().includes('invalid credentials')) {
            return {
                type: GoogleErrorType.AUTH_EXPIRED,
                service,
                operation,
                message: errorMessage,
                userMessage: '🔐 Your Google connection has expired',
                actionRequired: 'Please reconnect your Google account in Settings > Integrations',
                details: errorDetails
            };
        }

        if (errorMessage.toLowerCase().includes('revoked') || 
            errorMessage.toLowerCase().includes('access_denied')) {
            return {
                type: GoogleErrorType.AUTH_REVOKED,
                service,
                operation,
                message: errorMessage,
                userMessage: '❌ Google access has been revoked',
                actionRequired: 'Please reconnect your Google account with the required permissions',
                details: errorDetails
            };
        }
    }

    // Check for permission/scope errors (403)
    if (statusCode === 403) {
        // Insufficient permissions
        if (errorMessage.toLowerCase().includes('insufficient permission') ||
            errorMessage.toLowerCase().includes('forbidden') ||
            errorMessage.toLowerCase().includes('request had insufficient authentication scopes')) {
            return {
                type: GoogleErrorType.SCOPE_MISSING,
                service,
                operation,
                message: errorMessage,
                userMessage: `🔒 Insufficient permissions for ${service} ${operation}`,
                actionRequired: `Please reconnect your Google account with ${getScopeNameForOperation(service, operation)} permission`,
                details: errorDetails
            };
        }

        // Organization/admin restrictions
        if (errorMessage.toLowerCase().includes('admin') ||
            errorMessage.toLowerCase().includes('organization') ||
            errorMessage.toLowerCase().includes('policy') ||
            errorMessage.toLowerCase().includes('disabled')) {
            return {
                type: GoogleErrorType.ORG_RESTRICTION,
                service,
                operation,
                message: errorMessage,
                userMessage: '🏢 This operation is restricted by your organization',
                actionRequired: 'Contact your Google Workspace administrator to enable this feature',
                details: errorDetails
            };
        }

        // File/resource permission denied
        return {
            type: GoogleErrorType.PERMISSION_DENIED,
            service,
            operation,
            message: errorMessage,
            userMessage: '⛔ You don\'t have permission to access this resource',
            actionRequired: 'Request access from the owner or try a different resource',
            details: errorDetails
        };
    }

    // Rate limit errors (429)
    if (statusCode === 429) {
        const retryAfter = parseInt(error.response?.headers?.['retry-after'] || '60');
        
        if (errorMessage.toLowerCase().includes('quota')) {
            return {
                type: GoogleErrorType.QUOTA_EXCEEDED,
                service,
                operation,
                message: errorMessage,
                userMessage: '📊 Daily quota limit exceeded for this Google service',
                actionRequired: `Quota will reset in ${Math.ceil(retryAfter / 3600)} hours. Try again later.`,
                details: errorDetails,
                retryAfter
            };
        }

        return {
            type: GoogleErrorType.RATE_LIMIT,
            service,
            operation,
            message: errorMessage,
            userMessage: '⏱️ Too many requests to Google API',
            actionRequired: `Please wait ${retryAfter} seconds and try again`,
            details: errorDetails,
            retryAfter
        };
    }

    // Not found errors (404)
    if (statusCode === 404) {
        return {
            type: GoogleErrorType.NOT_FOUND,
            service,
            operation,
            message: errorMessage,
            userMessage: `🔍 The requested ${service} resource was not found`,
            actionRequired: 'The item may have been deleted or you may not have access to it',
            details: errorDetails
        };
    }

    // Invalid input errors (400)
    if (statusCode === 400) {
        return {
            type: GoogleErrorType.INVALID_INPUT,
            service,
            operation,
            message: errorMessage,
            userMessage: '❌ Invalid request',
            actionRequired: extractActionFromBadRequest(errorMessage),
            details: errorDetails
        };
    }

    // Unknown errors
    return {
        type: GoogleErrorType.UNKNOWN,
        service,
        operation,
        message: errorMessage,
        userMessage: `❌ ${service} operation failed`,
        actionRequired: 'Please try again or contact support if the issue persists',
        details: errorDetails
    };
}

/**
 * Get user-friendly scope name for an operation
 */
function getScopeNameForOperation(service: string, operation: string): string {
    const scopeMap: Record<string, Record<string, string>> = {
        gmail: {
            send: 'Gmail Send',
            read: 'Gmail Read',
            modify: 'Gmail Modify',
            default: 'Gmail'
        },
        calendar: {
            create: 'Calendar',
            update: 'Calendar',
            delete: 'Calendar',
            default: 'Calendar'
        },
        drive: {
            read: 'Google Drive',
            write: 'Google Drive',
            default: 'Google Drive'
        },
        docs: {
            read: 'Google Docs',
            write: 'Google Docs',
            default: 'Google Docs'
        },
        sheets: {
            read: 'Google Sheets',
            write: 'Google Sheets',
            default: 'Google Sheets'
        },
        slides: {
            read: 'Google Slides',
            write: 'Google Slides',
            default: 'Google Slides'
        },
        forms: {
            read: 'Google Forms',
            write: 'Google Forms',
            default: 'Google Forms'
        }
    };

    const serviceScopes = scopeMap[service.toLowerCase()] || {};
    return serviceScopes[operation.toLowerCase()] || serviceScopes.default || service;
}

/**
 * Extract actionable message from bad request error
 */
function extractActionFromBadRequest(errorMessage: string): string {
    if (errorMessage.toLowerCase().includes('required')) {
        return 'Please provide all required fields';
    }
    if (errorMessage.toLowerCase().includes('invalid email') || errorMessage.toLowerCase().includes('invalid recipient')) {
        return 'Please check the email address format';
    }
    if (errorMessage.toLowerCase().includes('invalid date') || errorMessage.toLowerCase().includes('invalid time')) {
        return 'Please provide a valid date and time';
    }
    if (errorMessage.toLowerCase().includes('too large') || errorMessage.toLowerCase().includes('exceeds')) {
        return 'The request is too large. Try reducing the amount of data';
    }
    return 'Please check your input and try again';
}

/**
 * Format Google error for display in chat
 */
export function formatGoogleErrorForChat(googleError: GoogleError): string {
    let message = `${googleError.userMessage}\n\n`;
    message += `**Service:** ${googleError.service}\n`;
    message += `**Operation:** ${googleError.operation}\n\n`;
    message += `**Next Steps:** ${googleError.actionRequired}`;

    if (googleError.retryAfter) {
        message += `\n\n⏳ Retry after ${googleError.retryAfter} seconds`;
    }

    return message;
}

/**
 * Check if error is retryable
 */
export function isRetryableError(errorType: GoogleErrorType): boolean {
    return [
        GoogleErrorType.RATE_LIMIT,
        GoogleErrorType.UNKNOWN
    ].includes(errorType);
}

/**
 * Get retry delay for exponential backoff
 */
export function getRetryDelay(attempt: number, retryAfter?: number): number {
    if (retryAfter) {
        return retryAfter * 1000; // Convert to milliseconds
    }
    // Exponential backoff: 1s, 2s, 4s, 8s
    return Math.min(1000 * Math.pow(2, attempt), 8000);
}

