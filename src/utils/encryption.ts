import * as crypto from 'crypto';
import { config } from '../config';

export class EncryptionService {
    private static readonly GCM_ALGORITHM = 'aes-256-gcm';
    private static readonly CBC_ALGORITHM = 'aes-256-cbc';
    private static readonly KEY_LENGTH = 32;
    private static readonly IV_LENGTH = 16;
    
    /**
     * Get encryption key from config, padded/truncated to correct length
     */
    private static getKey(): Buffer {
        const keyString = config.encryption?.key ?? process.env.ENCRYPTION_KEY ?? 'default-key-change-me';
        return Buffer.from(keyString.padEnd(this.KEY_LENGTH, '0').slice(0, this.KEY_LENGTH));
    }
    
    /**
     * Derive key using scrypt (for models that need key derivation)
     * 
     * @param password - The password/key to derive from
     * @param salt - Salt value for key derivation
     * @returns Derived key buffer
     */
    private static deriveKeyScrypt(password: string, salt: Buffer): Buffer {
        return crypto.scryptSync(password, salt, this.KEY_LENGTH);
    }
    
    /**
     * Encrypt data using AES-256-GCM (Galois/Counter Mode)
     * 
     * GCM provides authenticated encryption, ensuring both confidentiality
     * and authenticity of the encrypted data.
     * 
     * @param plaintext - The data to encrypt
     * @returns Object containing encrypted data, IV, and authentication tag
     */
    static encryptGCM(plaintext: string): { encrypted: string; iv: string; authTag: string } {
        const key = this.getKey();
        const iv = crypto.randomBytes(this.IV_LENGTH);
        const cipher = crypto.createCipheriv(this.GCM_ALGORITHM, key, iv);
        
        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        
        return {
            encrypted,
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex')
        };
    }
    
    /**
     * Decrypt data using AES-256-GCM
     * 
     * @param encrypted - The encrypted data (hex string)
     * @param iv - The initialization vector (hex string)
     * @param authTag - The authentication tag (hex string)
     * @returns Decrypted plaintext
     * @throws Error if authentication fails or decryption error occurs
     */
    static decryptGCM(encrypted: string, iv: string, authTag: string): string {
        const key = this.getKey();
        const decipher = crypto.createDecipheriv(
            this.GCM_ALGORITHM,
            key,
            Buffer.from(iv, 'hex')
        );
        
        decipher.setAuthTag(Buffer.from(authTag, 'hex'));
        
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    }
    
    /**
     * Encrypt data using AES-256-CBC (Cipher Block Chaining)
     * 
     * CBC mode provides confidentiality but not authenticity. Use GCM for new
     * implementations. This method is provided for legacy compatibility.
     * 
     * @param plaintext - The data to encrypt
     * @returns Object containing encrypted data and IV
     */
    static encryptCBC(plaintext: string): { encrypted: string; iv: string } {
        const key = this.getKey();
        const iv = crypto.randomBytes(this.IV_LENGTH);
        const cipher = crypto.createCipheriv(this.CBC_ALGORITHM, key, iv);
        
        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        return {
            encrypted,
            iv: iv.toString('hex')
        };
    }
    
    /**
     * Decrypt data using AES-256-CBC
     * 
     * @param encrypted - The encrypted data (hex string)
     * @param iv - The initialization vector (hex string)
     * @returns Decrypted plaintext
     */
    static decryptCBC(encrypted: string, iv: string): string {
        const key = this.getKey();
        const decipher = crypto.createDecipheriv(
            this.CBC_ALGORITHM,
            key,
            Buffer.from(iv, 'hex')
        );
        
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    }
    
    /**
     * Encrypt data with scrypt key derivation (for AWSConnection compatibility)
     * 
     * @param plaintext - The data to encrypt
     * @param password - Password for key derivation
     * @returns Object containing encrypted data, IV, auth tag, and salt
     */
    static encryptGCMWithScrypt(plaintext: string, password: string): { 
        encrypted: string; 
        iv: string; 
        authTag: string; 
        salt: string;
    } {
        const salt = crypto.randomBytes(16);
        const key = this.deriveKeyScrypt(password, salt);
        const iv = crypto.randomBytes(this.IV_LENGTH);
        const cipher = crypto.createCipheriv(this.GCM_ALGORITHM, key, iv);
        
        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        
        return {
            encrypted,
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex'),
            salt: salt.toString('hex')
        };
    }
    
    /**
     * Decrypt data with scrypt key derivation
     * 
     * @param encrypted - The encrypted data (hex string)
     * @param iv - The initialization vector (hex string)
     * @param authTag - The authentication tag (hex string)
     * @param salt - Salt used for key derivation (hex string)
     * @param password - Password for key derivation
     * @returns Decrypted plaintext
     */
    static decryptGCMWithScrypt(
        encrypted: string, 
        iv: string, 
        authTag: string, 
        salt: string, 
        password: string
    ): string {
        const key = this.deriveKeyScrypt(password, Buffer.from(salt, 'hex'));
        const decipher = crypto.createDecipheriv(
            this.GCM_ALGORITHM,
            key,
            Buffer.from(iv, 'hex')
        );
        
        decipher.setAuthTag(Buffer.from(authTag, 'hex'));
        
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    }
    
    /**
     * Encrypt data to combined format (encrypted:iv:authTag)
     * 
     * This format is convenient for storage as a single string field.
     * Uses AES-256-GCM for authenticated encryption.
     * 
     * @param plaintext - The data to encrypt
     * @returns Combined encrypted string in format "encrypted:iv:authTag"
     */
    static encryptToCombinedFormat(plaintext: string): string {
        const { encrypted, iv, authTag } = this.encryptGCM(plaintext);
        return `${encrypted}:${iv}:${authTag}`;
    }
    
    /**
     * Decrypt data from combined format
     * 
     * @param combined - Combined string in format "encrypted:iv:authTag"
     * @returns Decrypted plaintext
     */
    static decryptFromCombinedFormat(combined: string): string {
        const [encrypted, iv, authTag] = combined.split(':');
        if (!encrypted || !iv || !authTag) {
            throw new Error('Invalid combined format: expected "encrypted:iv:authTag"');
        }
        return this.decryptGCM(encrypted, iv, authTag);
    }
    
    /**
     * Hash data using SHA-256
     * 
     * @param data - The data to hash
     * @returns Hex-encoded hash
     */
    static hash256(data: string): string {
        return crypto.createHash('sha256').update(data).digest('hex');
    }
    
    /**
     * Hash data using SHA-512
     * 
     * @param data - The data to hash
     * @returns Hex-encoded hash
     */
    static hash512(data: string): string {
        return crypto.createHash('sha512').update(data).digest('hex');
    }
    
    /**
     * Generate cryptographically secure random token
     * 
     * @param length - Number of random bytes (default: 32)
     * @returns Hex-encoded random token
     */
    static generateToken(length: number = 32): string {
        return crypto.randomBytes(length).toString('hex');
    }
}

/**
 * Legacy function wrappers for backward compatibility
 * @deprecated Use EncryptionService.encryptToCombinedFormat instead
 */
export function encryptData(data: string): string {
    return EncryptionService.encryptToCombinedFormat(data);
}

/**
 * @deprecated Use EncryptionService.decryptFromCombinedFormat instead
 */
export function decryptData(encryptedString: string): string {
    return EncryptionService.decryptFromCombinedFormat(encryptedString);
}

/**
 * @deprecated Use EncryptionService.hash256 instead
 */
export function hashData(data: string): string {
    return EncryptionService.hash256(data);
}
