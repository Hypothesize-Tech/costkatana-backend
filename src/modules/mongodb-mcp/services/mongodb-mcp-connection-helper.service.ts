import { Injectable, Logger } from '@nestjs/common';
import { MongoClient } from 'mongodb';
import { EncryptionService } from '../../../utils/encryption';
import type { MongodbMcpConnectionDocument } from '../../../schemas/integration/mongodb-mcp-connection.schema';

export interface ValidateConnectionResult {
  valid: boolean;
  error?: string;
  stats?: Record<string, unknown>;
}

/**
 * Helper for encrypt/decrypt, validation, and credential expiry
 * for MongoDB MCP connections (Express-compatible behavior).
 */
@Injectable()
export class MongodbMcpConnectionHelperService {
  private readonly logger = new Logger(MongodbMcpConnectionHelperService.name);

  /**
   * Encrypt and set connection string on document. Caller must save the document.
   */
  setConnectionString(
    doc: MongodbMcpConnectionDocument,
    plainConnectionString: string,
  ): void {
    const key =
      process.env.JWT_SECRET ||
      process.env.ENCRYPTION_KEY ||
      'default-key-change-me';
    if (!key || key === 'default-key-change-me') {
      this.logger.error('MongoDB connection encryption key not configured');
      throw new Error('Encryption key not properly configured');
    }
    doc.connectionString = EncryptionService.encryptToCombinedFormat(
      plainConnectionString,
    );
  }

  /**
   * Decrypt connection string from document (document must have connectionString selected).
   */
  getDecryptedConnectionString(doc: MongodbMcpConnectionDocument): string {
    const key = process.env.JWT_SECRET || process.env.ENCRYPTION_KEY || '';
    if (!key || key === 'default-key-change-me') {
      this.logger.error('MongoDB connection decryption key not configured');
      throw new Error('Encryption key not properly configured');
    }
    const raw = doc.connectionString;
    if (!raw) throw new Error('Connection string not loaded');
    const parts = raw.split(':');
    if (parts.length === 3) {
      return EncryptionService.decryptFromCombinedFormat(raw);
    }
    try {
      const CryptoJS = require('crypto-js');
      const bytes = CryptoJS.AES.decrypt(raw, key);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      if (!decrypted) throw new Error('Failed to decrypt (legacy format)');
      this.logger.debug('Decrypted legacy CryptoJS format');
      return decrypted;
    } catch (e) {
      this.logger.error('Failed to decrypt MongoDB connection string', {
        error: e instanceof Error ? e.message : String(e),
      });
      throw new Error('Failed to decrypt connection string');
    }
  }

  isCredentialExpired(doc: MongodbMcpConnectionDocument): boolean {
    const expiry = doc.metadata?.credentialExpiry;
    if (!expiry) return false;
    const now = Date.now();
    const expiryTime = new Date(expiry).getTime();
    return expiryTime - now < 5 * 60 * 1000;
  }

  async validateConnection(
    doc: MongodbMcpConnectionDocument,
  ): Promise<ValidateConnectionResult> {
    let client: MongoClient | null = null;
    try {
      const connectionString = this.getDecryptedConnectionString(doc);
      client = new MongoClient(connectionString, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        socketTimeoutMS: 5000,
        maxPoolSize: 1,
      });
      await client.connect();
      let stats: Record<string, unknown> | undefined;
      const dbName = doc.database;
      if (dbName) {
        const sanitized = this.sanitizeDatabaseName(dbName);
        if (!sanitized || sanitized.length === 0) {
          throw new Error(
            'Invalid database name: database name cannot be empty after sanitization',
          );
        }
        if (sanitized.length > 64) {
          throw new Error(
            'Invalid database name: database name cannot exceed 64 characters',
          );
        }
        const db = client.db(sanitized);
        stats = (await db.stats()) as unknown as Record<string, unknown>;
      }
      return { valid: true, stats };
    } catch (error) {
      this.logger.warn('MongoDB connection validation failed', {
        connectionId: doc._id,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      if (client) {
        try {
          await client.close();
        } catch (closeError) {
          this.logger.warn(
            'Failed to close validation client',
            closeError instanceof Error
              ? closeError.message
              : String(closeError),
          );
        }
      }
    }
  }

  sanitizeDatabaseName(name: string): string {
    if (!name) return name;
    return name
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '');
  }
}
