import { Connection, ClientSession } from 'mongoose';

export interface TransactionOptions {
  /**
   * Maximum number of times to attempt a transaction commit
   * in the presence of transient transaction errors (e.g., write conflicts).
   * Default: 1 (no retries)
   */
  maxCommitAttempts?: number;
}

/**
 * Run a callback inside a MongoDB transaction. Commits on success, aborts on error.
 * Retries the transaction up to `maxCommitAttempts` if transient errors are encountered during commit.
 */
export async function runInTransaction<T>(
  connection: Connection,
  fn: (session: ClientSession) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const maxAttempts = options.maxCommitAttempts ?? 1;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const session = await connection.startSession();
    try {
      session.startTransaction();
      const result = await fn(session);
      await session.commitTransaction();
      return result;
    } catch (e: any) {
      lastError = e;
      // Only retry if it's a transient transaction error (error label exists)
      // https://www.mongodb.com/docs/manual/core/transactions/#transient-transaction-errors
      const hasTransientError =
        !!e &&
        typeof e === 'object' &&
        Array.isArray(e.errorLabels) &&
        e.errorLabels.includes('TransientTransactionError');
      await session.abortTransaction();
      if (!(hasTransientError && attempt < maxAttempts)) {
        throw e;
      }
      // else: retry transaction
    } finally {
      await session.endSession();
    }
  }
  // If we exhausted all attempts without success, throw last error
  throw lastError;
}
