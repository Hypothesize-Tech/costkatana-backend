import { encrypt, decrypt } from './helpers';

/**
 * Encrypt sensitive data for storage
 */
export function encryptData(data: string): string {
    const { encrypted, iv, authTag } = encrypt(data);
    // Combine encrypted data, IV, and auth tag into a single string
    return `${encrypted}:${iv}:${authTag}`;
}

/**
 * Decrypt sensitive data from storage
 */
export function decryptData(encryptedString: string): string {
    const [encrypted, iv, authTag] = encryptedString.split(':');
    return decrypt(encrypted, iv, authTag);
}

/**
 * Hash data using SHA256
 */
export function hashData(data: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(data).digest('hex');
}
