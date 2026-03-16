/**
 * Resolves decrypted access and refresh tokens from a Google connection document.
 * Supports both Express legacy (accessToken/refreshToken combined format) and
 * Nest/OAuth (encryptedAccessToken as JSON { encrypted, iv } CBC format).
 */

import { EncryptionService } from '../../../utils/encryption';

export type GoogleConnectionWithTokens = {
  _id: unknown;
  userId: unknown;
  accessToken?: string;
  refreshToken?: string;
  encryptedAccessToken?: string;
  encryptedRefreshToken?: string;
  expiresAt?: Date;
  healthStatus?: string;
  save: () => Promise<unknown>;
  [key: string]: unknown;
};

function tryDecryptCombined(combined: string): string {
  return EncryptionService.decryptFromCombinedFormat(combined);
}

function tryDecryptCBC(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { encrypted?: string; iv?: string };
    if (
      typeof parsed?.encrypted === 'string' &&
      typeof parsed?.iv === 'string'
    ) {
      return EncryptionService.decryptCBC(parsed.encrypted, parsed.iv);
    }
  } catch {
    // not JSON or wrong shape
  }
  throw new Error('Invalid encrypted token format');
}

/**
 * Get decrypted access token from a connection document.
 * Tries Express format (accessToken) first, then Nest format (encryptedAccessToken).
 */
export function getDecryptedAccessToken(
  connection: GoogleConnectionWithTokens,
): string {
  if (connection.accessToken && typeof connection.accessToken === 'string') {
    if (connection.accessToken.includes(':')) {
      return tryDecryptCombined(connection.accessToken);
    }
    return connection.accessToken;
  }
  if (
    connection.encryptedAccessToken &&
    typeof connection.encryptedAccessToken === 'string'
  ) {
    if (connection.encryptedAccessToken.includes(':')) {
      return tryDecryptCombined(connection.encryptedAccessToken);
    }
    return tryDecryptCBC(connection.encryptedAccessToken);
  }
  throw new Error('No access token on connection');
}

/**
 * Get decrypted refresh token from a connection document, or undefined if none.
 */
export function getDecryptedRefreshToken(
  connection: GoogleConnectionWithTokens,
): string | undefined {
  const raw = connection.refreshToken ?? connection.encryptedRefreshToken;
  if (!raw || typeof raw !== 'string') return undefined;
  try {
    if (raw.includes(':') && raw.split(':').length >= 3) {
      return tryDecryptCombined(raw);
    }
    return tryDecryptCBC(raw);
  } catch {
    return undefined;
  }
}
