import { Injectable, Logger } from '@nestjs/common';

/**
 * Circuit breaker for customer MongoDB connections.
 * Prevents cascading failures when customer DBs are unavailable.
 */
@Injectable()
export class MongodbMcpCircuitBreakerService {
  private readonly logger = new Logger(MongodbMcpCircuitBreakerService.name);

  private readonly failures = new Map<
    string,
    { count: number; lastFailure: number }
  >();
  private readonly THRESHOLD = 5;
  private readonly TIMEOUT = 60000;
  private readonly RESET_TIME = 300000;

  isOpen(connectionId: string): boolean {
    const record = this.failures.get(connectionId);
    if (!record) return false;
    const now = Date.now();
    if (now - record.lastFailure > this.RESET_TIME) {
      this.failures.delete(connectionId);
      return false;
    }
    if (
      record.count >= this.THRESHOLD &&
      now - record.lastFailure < this.TIMEOUT
    ) {
      return true;
    }
    return false;
  }

  recordFailure(connectionId: string): void {
    const record = this.failures.get(connectionId) ?? {
      count: 0,
      lastFailure: 0,
    };
    record.count++;
    record.lastFailure = Date.now();
    this.failures.set(connectionId, record);
    this.logger.warn('MongoDB circuit breaker recorded failure', {
      connectionId,
      failureCount: record.count,
      threshold: this.THRESHOLD,
    });
  }

  recordSuccess(connectionId: string): void {
    this.failures.delete(connectionId);
  }
}
