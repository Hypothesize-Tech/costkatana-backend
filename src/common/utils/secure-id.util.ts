import * as crypto from 'crypto';

/**
 * Generate a cryptographically secure unique ID for request tracing, tokens, etc.
 * Prefer this over Math.random() which is not cryptographically secure.
 */
export function generateSecureId(prefix = ''): string {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
}
