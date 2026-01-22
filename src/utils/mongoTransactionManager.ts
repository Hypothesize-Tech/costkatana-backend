import mongoose, { ClientSession } from 'mongoose';
import { loggingService } from '@services/logging.service';

/**
 * Transaction result interface
 */
export interface TransactionResult<T = any> {
    success: boolean;
    data?: T;
    error?: string;
}

/**
 * MongoTransactionManager
 * Centralizes MongoDB transaction patterns to eliminate duplication
 * Handles session management, error recovery, and consistent transaction patterns
 * 
 * Found in 50+ places across chat.service.ts with pattern:
 * const session = await mongoose.startSession();
 * try { await session.withTransaction(...) } finally { await session.endSession(); }
 */
export class MongoTransactionManager {
    
    /**
     * Execute operations within a MongoDB transaction
     * Handles session lifecycle automatically
     * 
     * @param operation - Async function to execute within transaction
     * @param operationName - Name for logging (optional)
     * @returns Promise resolving to transaction result
     */
    static async executeTransaction<T = any>(
        operation: (session: ClientSession) => Promise<T>,
        operationName?: string
    ): Promise<TransactionResult<T>> {
        const session = await mongoose.startSession();
        
        try {
            let result: T | undefined;
            
            await session.withTransaction(async () => {
                result = await operation(session);
            });

            if (operationName) {
                loggingService.debug('MongoDB transaction completed successfully', {
                    operation: operationName
                });
            }

            return {
                success: true,
                data: result
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            if (operationName) {
                loggingService.error('MongoDB transaction failed', {
                    operation: operationName,
                    error: errorMessage
                });
            }

            return {
                success: false,
                error: errorMessage
            };

        } finally {
            await session.endSession();
        }
    }

    /**
     * Execute multiple operations sequentially within a single transaction
     * All operations share the same session and either all succeed or all fail
     * 
     * @param operations - Array of async functions to execute
     * @param operationName - Name for logging (optional)
     * @returns Promise resolving to transaction result with array of results
     */
    static async executeMultiple<T = any>(
        operations: Array<(session: ClientSession) => Promise<T>>,
        operationName?: string
    ): Promise<TransactionResult<T[]>> {
        const session = await mongoose.startSession();
        
        try {
            const results: T[] = [];
            
            await session.withTransaction(async () => {
                for (const operation of operations) {
                    const result = await operation(session);
                    results.push(result);
                }
            });

            if (operationName) {
                loggingService.debug('MongoDB multi-operation transaction completed', {
                    operation: operationName,
                    operationCount: operations.length
                });
            }

            return {
                success: true,
                data: results
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            if (operationName) {
                loggingService.error('MongoDB multi-operation transaction failed', {
                    operation: operationName,
                    operationCount: operations.length,
                    error: errorMessage
                });
            }

            return {
                success: false,
                error: errorMessage
            };

        } finally {
            await session.endSession();
        }
    }

    /**
     * Execute operation with retry logic
     * Useful for handling transient MongoDB errors
     * 
     * @param operation - Async function to execute
     * @param maxRetries - Maximum retry attempts (default: 3)
     * @param operationName - Name for logging (optional)
     * @returns Promise resolving to transaction result
     */
    static async executeWithRetry<T = any>(
        operation: (session: ClientSession) => Promise<T>,
        maxRetries: number = 3,
        operationName?: string
    ): Promise<TransactionResult<T>> {
        let lastError: string = 'Unknown error';
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const result = await this.executeTransaction(operation, operationName);
            
            if (result.success) {
                if (attempt > 1 && operationName) {
                    loggingService.info('MongoDB transaction succeeded after retry', {
                        operation: operationName,
                        attempt
                    });
                }
                return result;
            }
            
            lastError = result.error || 'Unknown error';
            
            // Check if error is retriable
            if (!this.isRetriableError(lastError)) {
                if (operationName) {
                    loggingService.warn('MongoDB transaction error not retriable', {
                        operation: operationName,
                        error: lastError
                    });
                }
                return result;
            }
            
            // Wait before retry (exponential backoff)
            if (attempt < maxRetries) {
                const delay = Math.min(100 * Math.pow(2, attempt - 1), 1000);
                await new Promise(resolve => setTimeout(resolve, delay));
                
                if (operationName) {
                    loggingService.debug('Retrying MongoDB transaction', {
                        operation: operationName,
                        attempt: attempt + 1,
                        maxRetries,
                        delay
                    });
                }
            }
        }
        
        if (operationName) {
            loggingService.error('MongoDB transaction failed after all retries', {
                operation: operationName,
                maxRetries,
                lastError
            });
        }
        
        return {
            success: false,
            error: lastError
        };
    }

    /**
     * Check if error is retriable
     * Transient errors like network issues can be retried
     * 
     * @param error - Error message
     * @returns True if error is retriable
     */
    private static isRetriableError(error: string): boolean {
        const retriablePatterns = [
            /network/i,
            /timeout/i,
            /connection/i,
            /ECONNRESET/i,
            /ETIMEDOUT/i,
            /transient/i
        ];
        
        return retriablePatterns.some(pattern => pattern.test(error));
    }

    /**
     * Create a session for manual transaction management
     * Useful when you need more control over the session lifecycle
     * Remember to call endSession() when done!
     * 
     * @returns MongoDB ClientSession
     */
    static async createSession(): Promise<ClientSession> {
        return mongoose.startSession();
    }

    /**
     * Execute operation with existing session
     * Useful for nested operations or when session is managed externally
     * 
     * @param session - Existing MongoDB session
     * @param operation - Async function to execute
     * @param operationName - Name for logging (optional)
     * @returns Promise resolving to operation result
     */
    static async executeWithSession<T = any>(
        session: ClientSession,
        operation: (session: ClientSession) => Promise<T>,
        operationName?: string
    ): Promise<TransactionResult<T>> {
        try {
            const result = await operation(session);

            if (operationName) {
                loggingService.debug('MongoDB operation with session completed', {
                    operation: operationName
                });
            }

            return {
                success: true,
                data: result
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            if (operationName) {
                loggingService.error('MongoDB operation with session failed', {
                    operation: operationName,
                    error: errorMessage
                });
            }

            return {
                success: false,
                error: errorMessage
            };
        }
    }
}
