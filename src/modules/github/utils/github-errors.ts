import { HttpException, HttpStatus } from '@nestjs/common';

// Base GitHub error class
export class GitHubError extends HttpException {
  constructor(
    message: string,
    public code: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super(message, status);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Authentication errors
export class GitHubAuthError extends GitHubError {
  constructor(message: string = 'GitHub authentication failed') {
    super(message, 'GITHUB_AUTH_ERROR', HttpStatus.UNAUTHORIZED);
  }
}

export class GitHubOAuthError extends GitHubError {
  constructor(message: string = 'GitHub OAuth error') {
    super(message, 'GITHUB_OAUTH_ERROR', HttpStatus.UNAUTHORIZED);
  }
}

// Connection errors
export class GitHubConnectionError extends GitHubError {
  constructor(message: string = 'GitHub connection error') {
    super(message, 'GITHUB_CONNECTION_ERROR', HttpStatus.BAD_REQUEST);
  }
}

// Repository errors
export class GitHubRepositoryError extends GitHubError {
  constructor(message: string = 'GitHub repository error') {
    super(message, 'GITHUB_REPOSITORY_ERROR', HttpStatus.BAD_REQUEST);
  }
}

export class GitHubRepositoryNotFoundError extends GitHubError {
  constructor(owner: string, repo: string) {
    super(
      `Repository ${owner}/${repo} not found`,
      'GITHUB_REPOSITORY_ERROR',
      HttpStatus.NOT_FOUND,
    );
  }
}

// Integration errors
export class GitHubIntegrationError extends GitHubError {
  constructor(message: string = 'GitHub integration error') {
    super(message, 'GITHUB_INTEGRATION_ERROR', HttpStatus.BAD_REQUEST);
  }
}

// Webhook errors
export class GitHubWebhookError extends GitHubError {
  constructor(message: string = 'GitHub webhook error') {
    super(message, 'GITHUB_WEBHOOK_ERROR', HttpStatus.BAD_REQUEST);
  }
}

export class GitHubWebhookSignatureError extends GitHubError {
  constructor(message: string = 'Invalid webhook signature') {
    super(message, 'GITHUB_WEBHOOK_ERROR', HttpStatus.UNAUTHORIZED);
  }
}

// Rate limit errors
export class GitHubRateLimitError extends GitHubError {
  constructor(
    message: string = 'GitHub API rate limit exceeded',
    public resetTime?: number,
  ) {
    super(message, 'GITHUB_RATE_LIMIT_ERROR', HttpStatus.TOO_MANY_REQUESTS);
  }
}

// Permission errors
export class GitHubPermissionError extends GitHubError {
  constructor(message: string = 'Insufficient GitHub permissions') {
    super(message, 'GITHUB_PERMISSION_ERROR', HttpStatus.FORBIDDEN);
  }
}

// Configuration errors
export class GitHubConfigurationError extends GitHubError {
  constructor(message: string = 'GitHub configuration error') {
    super(
      message,
      'GITHUB_CONFIGURATION_ERROR',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

// Error code mappings
const ERROR_CODE_MAP = {
  GITHUB_AUTH_ERROR: GitHubAuthError,
  GITHUB_OAUTH_ERROR: GitHubOAuthError,
  GITHUB_CONNECTION_ERROR: GitHubConnectionError,
  GITHUB_REPOSITORY_ERROR: GitHubRepositoryError,
  GITHUB_INTEGRATION_ERROR: GitHubIntegrationError,
  GITHUB_WEBHOOK_ERROR: GitHubWebhookError,
  GITHUB_RATE_LIMIT_ERROR: GitHubRateLimitError,
  GITHUB_PERMISSION_ERROR: GitHubPermissionError,
  GITHUB_CONFIGURATION_ERROR: GitHubConfigurationError,
} as const;

// Error formatting helper
export function formatError(error: unknown): string {
  if (error instanceof GitHubError) {
    return `${error.code}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

// Create error from code
export function fromCode(code: string, message?: string): GitHubError {
  const ErrorClass = ERROR_CODE_MAP[code as keyof typeof ERROR_CODE_MAP];
  if (ErrorClass) {
    return new ErrorClass(message);
  }

  return new GitHubError(message || 'Unknown error', code);
}

// Convert GitHub API error to custom error
export function fromGitHubError(error: any): GitHubError {
  // Handle Octokit errors
  if (error.status) {
    switch (error.status) {
      case 401:
        return new GitHubAuthError(error.message || 'Authentication failed');
      case 403:
        if (error.message?.includes('rate limit')) {
          return new GitHubRateLimitError(error.message);
        }
        return new GitHubPermissionError(error.message || 'Permission denied');
      case 404:
        return new GitHubRepositoryNotFoundError('', '');
      case 422:
        return new GitHubRepositoryError(error.message || 'Validation failed');
      default:
        return new GitHubIntegrationError(error.message || 'GitHub API error');
    }
  }

  // Handle network errors
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
    return new GitHubConnectionError('Unable to connect to GitHub');
  }

  // Handle timeout errors
  if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
    return new GitHubConnectionError('Request to GitHub timed out');
  }

  // Default to integration error
  return new GitHubIntegrationError(error.message || 'Unknown GitHub error');
}
