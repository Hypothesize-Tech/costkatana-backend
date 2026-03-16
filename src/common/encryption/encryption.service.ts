import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const GCM_ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;

@Injectable()
export class EncryptionService {
  constructor(private configService: ConfigService) {}

  private getKey(): Buffer {
    const encryption = this.configService.get<{ key: string }>('encryption');
    const keyString =
      encryption?.key ?? process.env.ENCRYPTION_KEY ?? 'default-key-change-me';
    return Buffer.from(keyString.padEnd(KEY_LENGTH, '0').slice(0, KEY_LENGTH));
  }

  encryptGCM(plaintext: string): {
    encrypted: string;
    iv: string;
    authTag: string;
  } {
    const key = this.getKey();
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

  decryptGCM(encrypted: string, iv: string, authTag: string): string {
    const key = this.getKey();
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

  /**
   * Decrypt a combined string format "iv:authTag:encrypted" (e.g. API key storage).
   */
  decrypt(combined: string): string {
    const parts = combined.split(':');
    if (parts.length !== 3) {
      throw new Error(
        'Invalid encrypted format: expected iv:authTag:encrypted',
      );
    }
    const [iv, authTag, encrypted] = parts;
    return this.decryptGCM(encrypted, iv, authTag);
  }
}
