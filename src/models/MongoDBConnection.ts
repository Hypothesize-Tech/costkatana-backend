import mongoose, { Schema, Document, Model } from 'mongoose';
import { EncryptionService } from '../utils/encryption';
import { loggingService } from '../services/logging.service';
import { MongoClient } from 'mongodb';

/**
 * MongoDB Connection Interface
 * Stores customer-provided MongoDB connection strings with encryption
 */
export interface IMongoDBConnection extends Document {
    userId: mongoose.Types.ObjectId | string;
    alias: string;
    connectionString: string; // Encrypted
    database?: string;
    metadata?: {
        description?: string;
        environment?: 'development' | 'staging' | 'production';
        provider?: 'atlas' | 'self-hosted' | 'aws-documentdb' | 'azure-cosmos';
        region?: string;
        host?: string; // Extracted from connection string
        port?: number; // Extracted from connection string
        username?: string; // Extracted from connection string (without password)
        database?: string; // Extracted from connection string
        allowedCollections?: string[]; // Whitelist specific collections
        blockedCollections?: string[]; // Blacklist specific collections
        allowedFields?: { [collection: string]: string[] }; // Field-level access control
        blockedFields?: { [collection: string]: string[] }; // Field-level redaction
        maxDocsPerQuery?: number; // Override default limit
        maxQueryTimeMs?: number; // Override default timeout
        credentialExpiry?: Date; // For short-lived credentials
    };
    isActive: boolean;
    lastValidated?: Date;
    lastUsed?: Date;
    createdAt: Date;
    updatedAt: Date;

    // Methods
    getDecryptedConnectionString(): string;
    setConnectionString(plainConnectionString: string): void;
    validateConnection(): Promise<{ valid: boolean; error?: string; stats?: any }>;
    isCredentialExpired(): boolean;
}

const MongoDBConnectionSchema = new Schema<IMongoDBConnection>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        alias: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100
        },
        connectionString: {
            type: String,
            required: true,
            select: false // Never return in queries by default
        },
        database: {
            type: String,
            required: [true, 'Database name is required'],
            trim: true
        },
        metadata: {
            description: { type: String, maxlength: 500 },
            environment: {
                type: String,
                enum: ['development', 'staging', 'production'],
                default: 'production'
            },
            provider: {
                type: String,
                enum: ['atlas', 'self-hosted', 'aws-documentdb', 'azure-cosmos']
            },
            region: String,
            allowedCollections: [String],
            blockedCollections: [String],
            allowedFields: Schema.Types.Mixed,
            blockedFields: Schema.Types.Mixed,
            maxDocsPerQuery: {
                type: Number,
                min: 1,
                max: 1000,
                default: 500
            },
            maxQueryTimeMs: {
                type: Number,
                min: 1000,
                max: 30000,
                default: 8000
            },
            credentialExpiry: Date
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true
        },
        lastValidated: Date,
        lastUsed: Date
    },
    {
        timestamps: true,
        collection: 'mongodbconnections'
    }
);

// Indexes for efficient queries
MongoDBConnectionSchema.index({ userId: 1, isActive: 1 });
MongoDBConnectionSchema.index({ userId: 1, alias: 1 }, { unique: true });

/**
 * Pre-save hook to sanitize database name
 */
MongoDBConnectionSchema.pre('save', function (next) {
    if (this.database) {
        const original = this.database;
        // Sanitize database name: replace spaces and invalid chars with underscores
        const sanitized = original
            .trim()
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .replace(/_{2,}/g, '_')
            .replace(/^_+|_+$/g, '');
        
        // Only update if sanitization changed something and result is valid
        if (sanitized !== original && sanitized.length > 0) {
            this.database = sanitized;
            loggingService.info('Database name sanitized', {
                component: 'MongoDBConnection',
                operation: 'pre-save',
                original,
                sanitized,
            });
        } else if (sanitized.length === 0) {
            // If sanitization results in empty string, clear the database field
            this.database = undefined;
            loggingService.warn('Database name sanitized to empty, clearing field', {
                component: 'MongoDBConnection',
                operation: 'pre-save',
                original,
            });
        }
    }
    next();
});

/**
 * Encrypt connection string before saving
 * Uses AES-256-GCM for authenticated encryption
 */
MongoDBConnectionSchema.methods.setConnectionString = function (plainConnectionString: string): void {
    // Validate encryption key
    const encryptionKey = process.env.JWT_SECRET || process.env.ENCRYPTION_KEY;
    
    if (!encryptionKey || encryptionKey === 'default-key-change-me') {
        loggingService.error('MongoDB connection encryption key not configured', {
            component: 'MongoDBConnection',
            operation: 'setConnectionString',
            severity: 'CRITICAL'
        });
        throw new Error('Encryption key not properly configured');
    }

    // Encrypt using centralized service (format: encrypted:iv:authTag)
    this.connectionString = EncryptionService.encryptToCombinedFormat(plainConnectionString);
};

/**
 * Decrypt connection string
 * Supports both new format (encrypted:iv:authTag) and legacy CryptoJS format
 */
MongoDBConnectionSchema.methods.getDecryptedConnectionString = function (): string {
    const encryptionKey = process.env.JWT_SECRET || process.env.ENCRYPTION_KEY || '';
    
    if (!encryptionKey || encryptionKey === 'default-key-change-me') {
        loggingService.error('MongoDB connection encryption key not configured', {
            component: 'MongoDBConnection',
            operation: 'getDecryptedConnectionString',
            severity: 'CRITICAL'
        });
        throw new Error('Encryption key not properly configured');
    }

    try {
        // Check if it's in the new format (contains colons for encrypted:iv:authTag)
        const parts = this.connectionString.split(':');
        
        if (parts.length === 3) {
            // New format: use EncryptionService
            return EncryptionService.decryptFromCombinedFormat(this.connectionString);
        } else {
            // Legacy CryptoJS format: decrypt using CryptoJS for backward compatibility
            // Import CryptoJS dynamically only when needed for legacy data
            const CryptoJS = require('crypto-js');
            const bytes = CryptoJS.AES.decrypt(this.connectionString, encryptionKey);
            const decrypted = bytes.toString(CryptoJS.enc.Utf8);
            
            if (!decrypted) {
                throw new Error('Failed to decrypt connection string (legacy format)');
            }
            
            loggingService.info('Decrypted legacy CryptoJS format, consider re-encrypting', {
                component: 'MongoDBConnection',
                operation: 'getDecryptedConnectionString',
                connectionId: this._id
            });
            
            return decrypted;
        }
    } catch (error) {
        loggingService.error('Failed to decrypt MongoDB connection string', {
            component: 'MongoDBConnection',
            operation: 'getDecryptedConnectionString',
            connectionId: this._id,
            error: error instanceof Error ? error.message : String(error)
        });
        throw new Error('Failed to decrypt connection string');
    }
};

/**
 * Check if credentials are expired
 */
MongoDBConnectionSchema.methods.isCredentialExpired = function (): boolean {
    if (!this.metadata?.credentialExpiry) {
        return false; // No expiry set
    }
    
    const now = new Date();
    const expiryDate = new Date(this.metadata.credentialExpiry);
    
    // Check if expired or expiring within 5 minutes (buffer)
    return expiryDate.getTime() - now.getTime() < 5 * 60 * 1000;
};

/**
 * Validate MongoDB connection
 */
MongoDBConnectionSchema.methods.validateConnection = async function (): Promise<{
    valid: boolean;
    error?: string;
    stats?: any;
}> {
    let client: MongoClient | null = null;
    
    try {
        const connectionString = this.getDecryptedConnectionString();
        
        // Create client with strict timeouts for validation
        client = new MongoClient(connectionString, {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 5000,
            socketTimeoutMS: 5000,
            maxPoolSize: 1 // Single connection for validation
        });

        // Connect with timeout
        await client.connect();
        
        loggingService.info('MongoDB connection validated successfully', {
            component: 'MongoDBConnection',
            operation: 'validateConnection',
            connectionId: this._id,
            alias: this.alias
        });

        // Get database stats if database is specified
        let stats;
        if (this.database) {
            // Sanitize database name to ensure it's valid
            // MongoDB database names cannot contain spaces or special characters
            const sanitizedDbName = this.database
                .trim()
                .replace(/[^a-zA-Z0-9_-]/g, '_')
                .replace(/_{2,}/g, '_')
                .replace(/^_+|_+$/g, '');
            
            if (!sanitizedDbName || sanitizedDbName.length === 0) {
                throw new Error('Invalid database name: database name cannot be empty after sanitization');
            }
            
            if (sanitizedDbName.length > 64) {
                throw new Error('Invalid database name: database name cannot exceed 64 characters');
            }
            
            // Use sanitized name
            const db = client.db(sanitizedDbName);
            stats = await db.stats();
        }

        // Update last validated timestamp
        this.lastValidated = new Date();
        await this.save();

        return {
            valid: true,
            stats
        };
    } catch (error) {
        loggingService.error('MongoDB connection validation failed', {
            component: 'MongoDBConnection',
            operation: 'validateConnection',
            connectionId: this._id,
            alias: this.alias,
            error: error instanceof Error ? error.message : String(error)
        });

        return {
            valid: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    } finally {
        // Always close the connection
        if (client) {
            try {
                await client.close();
            } catch (closeError) {
                loggingService.warn('Failed to close MongoDB validation connection', {
                    component: 'MongoDBConnection',
                    operation: 'validateConnection',
                    error: closeError instanceof Error ? closeError.message : String(closeError)
                });
            }
        }
    }
};

// Static methods
MongoDBConnectionSchema.statics.getActiveConnection = async function (
    userId: string | mongoose.Types.ObjectId,
    connectionId: string | mongoose.Types.ObjectId
): Promise<IMongoDBConnection | null> {
    return this.findOne({
        _id: connectionId,
        userId,
        isActive: true
    }).select('+connectionString');
};

MongoDBConnectionSchema.statics.getUserConnections = async function (
    userId: string | mongoose.Types.ObjectId,
    activeOnly: boolean = true
): Promise<IMongoDBConnection[]> {
    const query: any = { userId };
    if (activeOnly) {
        query.isActive = true;
    }
    return this.find(query).sort({ lastUsed: -1, createdAt: -1 });
};

export const MongoDBConnection: Model<IMongoDBConnection> = mongoose.model<IMongoDBConnection>(
    'MongoDBConnection',
    MongoDBConnectionSchema
);
