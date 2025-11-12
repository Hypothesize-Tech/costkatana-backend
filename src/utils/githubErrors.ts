/**
 * Standardized GitHub integration error messages
 */

export interface StandardError {
    code: string;
    message: string;
    userMessage: string;
    httpStatus: number;
    actionable: string;
}

export class GitHubErrors {
    // Authentication Errors
    static readonly AUTH_REQUIRED: StandardError = {
        code: 'GITHUB_AUTH_REQUIRED',
        message: 'Authentication required',
        userMessage: 'You need to be logged in to perform this action.',
        httpStatus: 401,
        actionable: 'Please log in and try again.'
    };

    static readonly INVALID_CREDENTIALS: StandardError = {
        code: 'GITHUB_INVALID_CREDENTIALS',
        message: 'GitHub authentication failed',
        userMessage: 'Your GitHub credentials are invalid or have expired.',
        httpStatus: 401,
        actionable: 'Please reconnect your GitHub account from the integrations page.'
    };

    static readonly TOKEN_EXPIRED: StandardError = {
        code: 'GITHUB_TOKEN_EXPIRED',
        message: 'GitHub access token expired',
        userMessage: 'Your GitHub access token has expired.',
        httpStatus: 401,
        actionable: 'Please reconnect your GitHub account to continue.'
    };

    static readonly TOKEN_REFRESH_FAILED: StandardError = {
        code: 'GITHUB_TOKEN_REFRESH_FAILED',
        message: 'Failed to refresh GitHub access token',
        userMessage: 'We couldn\'t refresh your GitHub access token automatically.',
        httpStatus: 401,
        actionable: 'Please reconnect your GitHub account.'
    };

    // OAuth Errors
    static readonly OAUTH_STATE_INVALID: StandardError = {
        code: 'GITHUB_OAUTH_STATE_INVALID',
        message: 'Invalid OAuth state parameter',
        userMessage: 'The authentication request is invalid or has been tampered with.',
        httpStatus: 400,
        actionable: 'Please start the GitHub connection process again.'
    };

    static readonly OAUTH_STATE_EXPIRED: StandardError = {
        code: 'GITHUB_OAUTH_STATE_EXPIRED',
        message: 'OAuth state expired',
        userMessage: 'The authentication request has expired (older than 10 minutes).',
        httpStatus: 400,
        actionable: 'Please start the GitHub connection process again.'
    };

    static readonly OAUTH_CALLBACK_FAILED: StandardError = {
        code: 'GITHUB_OAUTH_CALLBACK_FAILED',
        message: 'OAuth callback processing failed',
        userMessage: 'We encountered an error while connecting to GitHub.',
        httpStatus: 500,
        actionable: 'Please try again. If the issue persists, contact support.'
    };

    // Connection Errors
    static readonly CONNECTION_NOT_FOUND: StandardError = {
        code: 'GITHUB_CONNECTION_NOT_FOUND',
        message: 'GitHub connection not found',
        userMessage: 'We couldn\'t find your GitHub connection.',
        httpStatus: 404,
        actionable: 'Please connect your GitHub account from the integrations page.'
    };

    static readonly CONNECTION_INACTIVE: StandardError = {
        code: 'GITHUB_CONNECTION_INACTIVE',
        message: 'GitHub connection is inactive',
        userMessage: 'Your GitHub connection is no longer active.',
        httpStatus: 403,
        actionable: 'Please reconnect your GitHub account to continue.'
    };

    // Repository Errors
    static readonly REPOSITORY_NOT_FOUND: StandardError = {
        code: 'GITHUB_REPOSITORY_NOT_FOUND',
        message: 'Repository not found',
        userMessage: 'The repository you\'re trying to access doesn\'t exist or you don\'t have access.',
        httpStatus: 404,
        actionable: 'Verify the repository exists and you have the necessary permissions.'
    };

    static readonly REPOSITORY_ACCESS_DENIED: StandardError = {
        code: 'GITHUB_REPOSITORY_ACCESS_DENIED',
        message: 'Repository access denied',
        userMessage: 'You don\'t have permission to access this repository.',
        httpStatus: 403,
        actionable: 'Make sure you have the correct permissions in GitHub.'
    };

    // Integration Errors
    static readonly INTEGRATION_NOT_FOUND: StandardError = {
        code: 'GITHUB_INTEGRATION_NOT_FOUND',
        message: 'Integration not found',
        userMessage: 'We couldn\'t find the integration you\'re looking for.',
        httpStatus: 404,
        actionable: 'The integration may have been deleted.'
    };

    static readonly INTEGRATION_FAILED: StandardError = {
        code: 'GITHUB_INTEGRATION_FAILED',
        message: 'Integration process failed',
        userMessage: 'The integration process encountered an error.',
        httpStatus: 500,
        actionable: 'Please try again. Check the error details for more information.'
    };

    static readonly INTEGRATION_TIMEOUT: StandardError = {
        code: 'GITHUB_INTEGRATION_TIMEOUT',
        message: 'Integration timed out',
        userMessage: 'The integration took too long to complete.',
        httpStatus: 504,
        actionable: 'This may be due to high complexity or temporary issues. Please try again in 2-3 minutes.'
    };

    // Webhook Errors
    static readonly WEBHOOK_SIGNATURE_INVALID: StandardError = {
        code: 'GITHUB_WEBHOOK_SIGNATURE_INVALID',
        message: 'Invalid webhook signature',
        userMessage: 'The webhook signature is invalid.',
        httpStatus: 401,
        actionable: 'Verify your webhook secret is configured correctly.'
    };

    static readonly WEBHOOK_PROCESSING_FAILED: StandardError = {
        code: 'GITHUB_WEBHOOK_PROCESSING_FAILED',
        message: 'Webhook processing failed',
        userMessage: 'We couldn\'t process the webhook event.',
        httpStatus: 500,
        actionable: 'The webhook will be retried automatically by GitHub.'
    };

    // Rate Limit Errors
    static readonly RATE_LIMIT_EXCEEDED: StandardError = {
        code: 'GITHUB_RATE_LIMIT_EXCEEDED',
        message: 'GitHub API rate limit exceeded',
        userMessage: 'We\'ve hit GitHub\'s API rate limit.',
        httpStatus: 429,
        actionable: 'Please wait a few minutes and try again.'
    };

    // Permission Errors
    static readonly INSUFFICIENT_PERMISSIONS: StandardError = {
        code: 'GITHUB_INSUFFICIENT_PERMISSIONS',
        message: 'Insufficient GitHub permissions',
        userMessage: 'Your GitHub token doesn\'t have the required permissions.',
        httpStatus: 403,
        actionable: 'Please reconnect your GitHub account and grant all requested permissions.'
    };

    static readonly APP_PERMISSIONS_INSUFFICIENT: StandardError = {
        code: 'GITHUB_APP_PERMISSIONS_INSUFFICIENT',
        message: 'GitHub App permissions insufficient',
        userMessage: 'The GitHub App doesn\'t have sufficient permissions.',
        httpStatus: 403,
        actionable: 'Please update app permissions to include Contents: Write and reinstall the app.'
    };

    // Configuration Errors
    static readonly APP_NOT_CONFIGURED: StandardError = {
        code: 'GITHUB_APP_NOT_CONFIGURED',
        message: 'GitHub App not configured',
        userMessage: 'The GitHub App is not properly configured on the server.',
        httpStatus: 500,
        actionable: 'Please contact support to configure the GitHub App.'
    };

    static readonly SESSION_NOT_CONFIGURED: StandardError = {
        code: 'SESSION_NOT_CONFIGURED',
        message: 'Session not configured',
        userMessage: 'The server session is not properly configured.',
        httpStatus: 500,
        actionable: 'Please contact support. This is a server configuration issue.'
    };

    // General Errors
    static readonly UNKNOWN_ERROR: StandardError = {
        code: 'GITHUB_UNKNOWN_ERROR',
        message: 'Unknown error occurred',
        userMessage: 'An unexpected error occurred.',
        httpStatus: 500,
        actionable: 'Please try again. If the issue persists, contact support.'
    };

    /**
     * Format error response
     */
    static formatError(error: StandardError, details?: Record<string, any>): {
        success: false;
        error: {
            code: string;
            message: string;
            userMessage: string;
            actionable: string;
            details?: Record<string, any>;
        };
    } {
        return {
            success: false,
            error: {
                code: error.code,
                message: error.message,
                userMessage: error.userMessage,
                actionable: error.actionable,
                ...(details && { details })
            }
        };
    }

    /**
     * Get error from code
     */
    static fromCode(code: string): StandardError {
        const errorKey = Object.keys(this).find(
            key => (this as any)[key].code === code
        );
        return errorKey ? (this as any)[errorKey] : this.UNKNOWN_ERROR;
    }

    /**
     * Create error from GitHub API error
     */
    static fromGitHubError(error: any): StandardError {
        if (error.status === 401) {
            return this.INVALID_CREDENTIALS;
        }
        if (error.status === 403) {
            if (error.message?.includes('rate limit')) {
                return this.RATE_LIMIT_EXCEEDED;
            }
            if (error.message?.includes('permission') || error.message?.includes('Resource not accessible')) {
                return this.INSUFFICIENT_PERMISSIONS;
            }
            return this.REPOSITORY_ACCESS_DENIED;
        }
        if (error.status === 404) {
            return this.REPOSITORY_NOT_FOUND;
        }
        if (error.status === 429) {
            return this.RATE_LIMIT_EXCEEDED;
        }
        return this.UNKNOWN_ERROR;
    }
}

