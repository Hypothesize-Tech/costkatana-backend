/**
 * Google API error handler: parse and categorize errors for retries and user messages.
 * Production-ready: no placeholders.
 */

import { Logger } from '@nestjs/common';

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
  UNKNOWN = 'unknown',
}

export interface ParsedGoogleError {
  type: GoogleErrorType;
  service: string;
  operation: string;
  message: string;
  userMessage: string;
  actionRequired: string;
  details?: unknown;
  retryAfter?: number;
}

function getScopeNameForOperation(service: string, operation: string): string {
  const scopeMap: Record<string, Record<string, string>> = {
    gmail: {
      send: 'Gmail Send',
      read: 'Gmail Read',
      modify: 'Gmail Modify',
      default: 'Gmail',
    },
    calendar: {
      create: 'Calendar',
      update: 'Calendar',
      delete: 'Calendar',
      default: 'Calendar',
    },
    drive: {
      read: 'Google Drive',
      write: 'Google Drive',
      default: 'Google Drive',
    },
    docs: { read: 'Google Docs', write: 'Google Docs', default: 'Google Docs' },
    sheets: {
      read: 'Google Sheets',
      write: 'Google Sheets',
      default: 'Google Sheets',
    },
    slides: {
      read: 'Google Slides',
      write: 'Google Slides',
      default: 'Google Slides',
    },
    forms: {
      read: 'Google Forms',
      write: 'Google Forms',
      default: 'Google Forms',
    },
  };
  const serviceScopes = scopeMap[service.toLowerCase()] || {};
  return (
    serviceScopes[operation.toLowerCase()] || serviceScopes.default || service
  );
}

function extractActionFromBadRequest(errorMessage: string): string {
  const lower = errorMessage.toLowerCase();
  if (lower.includes('required')) return 'Please provide all required fields';
  if (lower.includes('invalid email') || lower.includes('invalid recipient'))
    return 'Please check the email address format';
  if (lower.includes('invalid date') || lower.includes('invalid time'))
    return 'Please provide a valid date and time';
  if (lower.includes('too large') || lower.includes('exceeds'))
    return 'The request is too large. Try reducing the amount of data';
  return 'Please check your input and try again';
}

export function parseGoogleApiError(
  error: unknown,
  service: string,
  operation: string,
  logger?: Logger,
): ParsedGoogleError {
  const err = error as {
    code?: number;
    status?: number;
    message?: string;
    response?: {
      status?: number;
      data?: unknown;
      headers?: { 'retry-after'?: string };
    };
    error?: { message?: string };
  };
  const statusCode = err?.code ?? err?.status ?? err?.response?.status;
  const errorMessage = err?.message ?? err?.error?.message ?? 'Unknown error';
  const errorDetails = err?.response?.data ?? err?.error ?? {};

  if (logger) {
    logger.error('Google API Error', {
      service,
      operation,
      statusCode,
      errorMessage,
      errorDetails,
    });
  }

  if (statusCode === 401) {
    if (
      /invalid_grant|token expired|invalid credentials/.test(
        errorMessage.toLowerCase(),
      )
    ) {
      return {
        type: GoogleErrorType.AUTH_EXPIRED,
        service,
        operation,
        message: errorMessage,
        userMessage: '🔐 Your Google connection has expired',
        actionRequired:
          'Please reconnect your Google account in Settings > Integrations',
        details: errorDetails,
      };
    }
    if (/revoked|access_denied/.test(errorMessage.toLowerCase())) {
      return {
        type: GoogleErrorType.AUTH_REVOKED,
        service,
        operation,
        message: errorMessage,
        userMessage: '❌ Google access has been revoked',
        actionRequired:
          'Please reconnect your Google account with the required permissions',
        details: errorDetails,
      };
    }
  }

  if (statusCode === 403) {
    if (
      /insufficient permission|forbidden|insufficient authentication scopes/.test(
        errorMessage.toLowerCase(),
      )
    ) {
      return {
        type: GoogleErrorType.SCOPE_MISSING,
        service,
        operation,
        message: errorMessage,
        userMessage: `🔒 Insufficient permissions for ${service} ${operation}`,
        actionRequired: `Please reconnect your Google account with ${getScopeNameForOperation(service, operation)} permission`,
        details: errorDetails,
      };
    }
    if (/admin|organization|policy|disabled/.test(errorMessage.toLowerCase())) {
      return {
        type: GoogleErrorType.ORG_RESTRICTION,
        service,
        operation,
        message: errorMessage,
        userMessage: '🏢 This operation is restricted by your organization',
        actionRequired:
          'Contact your Google Workspace administrator to enable this feature',
        details: errorDetails,
      };
    }
    return {
      type: GoogleErrorType.PERMISSION_DENIED,
      service,
      operation,
      message: errorMessage,
      userMessage: "⛔ You don't have permission to access this resource",
      actionRequired:
        'Request access from the owner or try a different resource',
      details: errorDetails,
    };
  }

  if (statusCode === 429) {
    const retryAfter = parseInt(
      err?.response?.headers?.['retry-after'] ?? '60',
      10,
    );
    if (/quota/.test(errorMessage.toLowerCase())) {
      return {
        type: GoogleErrorType.QUOTA_EXCEEDED,
        service,
        operation,
        message: errorMessage,
        userMessage: '📊 Daily quota limit exceeded for this Google service',
        actionRequired: `Quota will reset in ${Math.ceil(retryAfter / 3600)} hours. Try again later.`,
        details: errorDetails,
        retryAfter,
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
      retryAfter,
    };
  }

  if (statusCode === 404) {
    return {
      type: GoogleErrorType.NOT_FOUND,
      service,
      operation,
      message: errorMessage,
      userMessage: `🔍 The requested ${service} resource was not found`,
      actionRequired:
        'The item may have been deleted or you may not have access to it',
      details: errorDetails,
    };
  }

  if (statusCode === 400) {
    return {
      type: GoogleErrorType.INVALID_INPUT,
      service,
      operation,
      message: errorMessage,
      userMessage: '❌ Invalid request',
      actionRequired: extractActionFromBadRequest(errorMessage),
      details: errorDetails,
    };
  }

  return {
    type: GoogleErrorType.UNKNOWN,
    service,
    operation,
    message: errorMessage,
    userMessage: `❌ ${service} operation failed`,
    actionRequired: 'Please try again or contact support if the issue persists',
    details: errorDetails,
  };
}

export function formatGoogleErrorForChat(
  googleError: ParsedGoogleError,
): string {
  let message = `${googleError.userMessage}\n\n`;
  message += `**Service:** ${googleError.service}\n`;
  message += `**Operation:** ${googleError.operation}\n\n`;
  message += `**Next Steps:** ${googleError.actionRequired}`;
  if (googleError.retryAfter) {
    message += `\n\n⏳ Retry after ${googleError.retryAfter} seconds`;
  }
  return message;
}

export function isRetryableError(errorType: GoogleErrorType): boolean {
  return [GoogleErrorType.RATE_LIMIT, GoogleErrorType.UNKNOWN].includes(
    errorType,
  );
}

export function getRetryDelay(attempt: number, retryAfter?: number): number {
  if (retryAfter !== undefined && retryAfter > 0) {
    return retryAfter * 1000;
  }
  return Math.min(1000 * Math.pow(2, attempt), 8000);
}
