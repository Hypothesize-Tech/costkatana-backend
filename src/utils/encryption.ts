/**
 * Static encryption utilities for Mongoose models (legacy compatibility).
 * Uses process.env.ENCRYPTION_KEY. For injectable use, prefer CommonModule's EncryptionService.
 */
import * as crypto from 'crypto';

const GCM_ALGORITHM = 'aes-256-gcm';
const CBC_ALGORITHM = 'aes-256-cbc';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;

function getKey(): Buffer {
  const keyString = process.env.ENCRYPTION_KEY ?? 'default-key-change-me';
  return Buffer.from(keyString.padEnd(KEY_LENGTH, '0').slice(0, KEY_LENGTH));
}

function deriveKeyScrypt(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, KEY_LENGTH);
}

export class EncryptionService {
  static encryptGCM(plaintext: string): {
    encrypted: string;
    iv: string;
    authTag: string;
  } {
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(GCM_ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
    };
  }

  static decryptGCM(encrypted: string, iv: string, authTag: string): string {
    const key = getKey();
    const decipher = crypto.createDecipheriv(
      GCM_ALGORITHM,
      key,
      Buffer.from(iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  static encryptCBC(plaintext: string): { encrypted: string; iv: string } {
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(CBC_ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return { encrypted, iv: iv.toString('hex') };
  }

  static decryptCBC(encrypted: string, iv: string): string {
    const key = getKey();
    const decipher = crypto.createDecipheriv(
      CBC_ALGORITHM,
      key,
      Buffer.from(iv, 'hex'),
    );
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  static encryptGCMWithScrypt(
    plaintext: string,
    password: string,
  ): { encrypted: string; iv: string; authTag: string; salt: string } {
    const salt = crypto.randomBytes(16);
    const key = deriveKeyScrypt(password, salt);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(GCM_ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      salt: salt.toString('hex'),
    };
  }

  static decryptGCMWithScrypt(
    encrypted: string,
    iv: string,
    authTag: string,
    salt: string,
    password: string,
  ): string {
    const key = deriveKeyScrypt(password, Buffer.from(salt, 'hex'));
    const decipher = crypto.createDecipheriv(
      GCM_ALGORITHM,
      key,
      Buffer.from(iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  static encryptToCombinedFormat(plaintext: string): string {
    const { encrypted, iv, authTag } = this.encryptGCM(plaintext);
    return `${encrypted}:${iv}:${authTag}`;
  }

  static decryptFromCombinedFormat(combined: string): string {
    const [encrypted, iv, authTag] = combined.split(':');
    if (!encrypted || !iv || !authTag) {
      throw new Error(
        'Invalid combined format: expected "encrypted:iv:authTag"',
      );
    }
    return this.decryptGCM(encrypted, iv, authTag);
  }

  static hash256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  static hash512(data: string): string {
    return crypto.createHash('sha512').update(data).digest('hex');
  }

  static generateToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }
}

export function encryptData(data: string): string {
  return EncryptionService.encryptToCombinedFormat(data);
}

export function decryptData(encryptedString: string): string {
  return EncryptionService.decryptFromCombinedFormat(encryptedString);
}

export function hashData(data: string): string {
  return EncryptionService.hash256(data);
}
