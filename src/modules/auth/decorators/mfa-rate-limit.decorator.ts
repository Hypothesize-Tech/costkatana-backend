import { SetMetadata } from '@nestjs/common';

export const MFA_RATE_LIMIT_KEY = 'mfaRateLimit';

export interface MfaRateLimitOptions {
  windowMs: number; // Time window in milliseconds
  max: number; // Maximum requests per window
}

export const MfaRateLimit = (options: MfaRateLimitOptions) =>
  SetMetadata(MFA_RATE_LIMIT_KEY, options);
