export interface GoogleError {
    code: string;
    message: string;
    userMessage: string;
    httpStatus: number;
    retryable: boolean;
}

export class GoogleErrors {
    // Authentication errors
    static readonly AUTH_REQUIRED: GoogleError = {
        code: 'GOOGLE_AUTH_REQUIRED',
        message: 'Google authentication required',
        userMessage: 'Please connect your Google account to use this feature',
        httpStatus: 401,
        retryable: false
    };

    static readonly TOKEN_EXPIRED: GoogleError = {
        code: 'GOOGLE_TOKEN_EXPIRED',
        message: 'Google access token has expired',
        userMessage: 'Your Google connection has expired. Please reconnect your account',
        httpStatus: 401,
        retryable: true
    };

    static readonly TOKEN_REFRESH_FAILED: GoogleError = {
        code: 'GOOGLE_TOKEN_REFRESH_FAILED',
        message: 'Failed to refresh Google access token',
        userMessage: 'Failed to refresh your Google connection. Please reconnect your account',
        httpStatus: 401,
        retryable: false
    };

    static readonly INVALID_CREDENTIALS: GoogleError = {
        code: 'GOOGLE_INVALID_CREDENTIALS',
        message: 'Invalid Google credentials',
        userMessage: 'Invalid Google credentials. Please reconnect your account',
        httpStatus: 401,
        retryable: false
    };

    static readonly INSUFFICIENT_PERMISSIONS: GoogleError = {
        code: 'GOOGLE_INSUFFICIENT_PERMISSIONS',
        message: 'Insufficient permissions for this operation',
        userMessage: 'Your Google account doesn\'t have the required permissions. Please grant additional access',
        httpStatus: 403,
        retryable: false
    };

    // Connection errors
    static readonly CONNECTION_NOT_FOUND: GoogleError = {
        code: 'GOOGLE_CONNECTION_NOT_FOUND',
        message: 'Google connection not found',
        userMessage: 'Google connection not found. Please connect your Google account',
        httpStatus: 404,
        retryable: false
    };

    static readonly CONNECTION_INACTIVE: GoogleError = {
        code: 'GOOGLE_CONNECTION_INACTIVE',
        message: 'Google connection is inactive',
        userMessage: 'Your Google connection is inactive. Please reconnect your account',
        httpStatus: 403,
        retryable: false
    };

    // API errors
    static readonly API_ERROR: GoogleError = {
        code: 'GOOGLE_API_ERROR',
        message: 'Google API error',
        userMessage: 'An error occurred while communicating with Google. Please try again',
        httpStatus: 500,
        retryable: true
    };

    static readonly RATE_LIMIT_EXCEEDED: GoogleError = {
        code: 'GOOGLE_RATE_LIMIT_EXCEEDED',
        message: 'Google API rate limit exceeded',
        userMessage: 'Too many requests to Google. Please try again in a few moments',
        httpStatus: 429,
        retryable: true
    };

    static readonly QUOTA_EXCEEDED: GoogleError = {
        code: 'GOOGLE_QUOTA_EXCEEDED',
        message: 'Google API quota exceeded',
        userMessage: 'Google API quota exceeded. Please try again later',
        httpStatus: 429,
        retryable: true
    };

    // File/Resource errors
    static readonly FILE_NOT_FOUND: GoogleError = {
        code: 'GOOGLE_FILE_NOT_FOUND',
        message: 'Google file not found',
        userMessage: 'The requested file was not found in your Google Drive',
        httpStatus: 404,
        retryable: false
    };

    static readonly FILE_ACCESS_DENIED: GoogleError = {
        code: 'GOOGLE_FILE_ACCESS_DENIED',
        message: 'Access denied to Google file',
        userMessage: 'You don\'t have permission to access this file',
        httpStatus: 403,
        retryable: false
    };

    static readonly FILE_TOO_LARGE: GoogleError = {
        code: 'GOOGLE_FILE_TOO_LARGE',
        message: 'File is too large to process',
        userMessage: 'The file is too large to process. Please try with a smaller file',
        httpStatus: 413,
        retryable: false
    };

    // Domain restrictions
    static readonly DOMAIN_NOT_ALLOWED: GoogleError = {
        code: 'GOOGLE_DOMAIN_NOT_ALLOWED',
        message: 'Google domain not allowed',
        userMessage: 'Your Google account domain is not allowed. Please use an account from an allowed domain',
        httpStatus: 403,
        retryable: false
    };

    // Export errors
    static readonly EXPORT_FAILED: GoogleError = {
        code: 'GOOGLE_EXPORT_FAILED',
        message: 'Failed to export data to Google',
        userMessage: 'Failed to export data to Google. Please try again',
        httpStatus: 500,
        retryable: true
    };

    static readonly EXPORT_TOO_LARGE: GoogleError = {
        code: 'GOOGLE_EXPORT_TOO_LARGE',
        message: 'Export data is too large',
        userMessage: 'The export data is too large. Please reduce the date range or filter the data',
        httpStatus: 413,
        retryable: false
    };

    /**
     * Convert Google API error to standardized error
     */
    static fromGoogleError(error: any): GoogleError {
        // Handle Google API errors
        if (error.code) {
            switch (error.code) {
                case 401:
                    return this.TOKEN_EXPIRED;
                case 403:
                    return this.INSUFFICIENT_PERMISSIONS;
                case 404:
                    return this.FILE_NOT_FOUND;
                case 429:
                    return this.RATE_LIMIT_EXCEEDED;
                case 500:
                case 502:
                case 503:
                    return this.API_ERROR;
                default:
                    break;
            }
        }

        // Handle specific error messages
        const errorMessage = error.message?.toLowerCase() || '';
        if (errorMessage.includes('invalid_grant') || errorMessage.includes('token')) {
            return this.TOKEN_EXPIRED;
        }
        if (errorMessage.includes('quota') || errorMessage.includes('rate limit')) {
            return this.RATE_LIMIT_EXCEEDED;
        }
        if (errorMessage.includes('not found')) {
            return this.FILE_NOT_FOUND;
        }
        if (errorMessage.includes('permission') || errorMessage.includes('access denied')) {
            return this.INSUFFICIENT_PERMISSIONS;
        }

        // Default to generic API error
        return this.API_ERROR;
    }

    /**
     * Format error for API response
     */
    static formatError(error: GoogleError, additionalInfo?: any): any {
        return {
            success: false,
            error: {
                code: error.code,
                message: error.userMessage,
                details: additionalInfo
            }
        };
    }

    /**
     * Check if error is retryable
     */
    static isRetryable(error: GoogleError): boolean {
        return error.retryable;
    }
}

