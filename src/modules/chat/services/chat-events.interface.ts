/**
 * Chat Events Service Interface
 * Defines the contract for chat event distribution across the application
 * Supports both in-process (EventEmitter2) and distributed (Redis/BullMQ) implementations
 */

export interface ChatEventData {
  chatId: string;
  userId: string;
  type: 'message' | 'typing' | 'status' | 'error';
  data: any;
  timestamp: Date;
  instanceId?: string; // For distributed systems - identifies which server instance sent the event
}

export interface IChatEventsService {
  /**
   * Emit a chat event to all listeners
   */
  emit(event: ChatEventData): Promise<void>;

  /**
   * Listen for chat events with pattern matching
   */
  on(eventPattern: string, listener: (event: ChatEventData) => void): void;

  /**
   * Remove event listener(s)
   */
  off(eventPattern: string, listener?: (event: ChatEventData) => void): void;

  /**
   * Get listener count for debugging
   */
  getListenerCount(eventPattern?: string): number;

  /**
   * Emit message event
   */
  emitMessage(chatId: string, userId: string, message: any): Promise<void>;

  /**
   * Emit typing event
   */
  emitTyping(chatId: string, userId: string, isTyping: boolean): Promise<void>;

  /**
   * Emit status update event
   */
  emitStatus(
    chatId: string,
    userId: string,
    status: string,
    metadata?: any,
  ): Promise<void>;

  /**
   * Emit error event
   */
  emitError(
    chatId: string,
    userId: string,
    error: string,
    details?: any,
  ): Promise<void>;

  /**
   * Health check - returns true if service is operational
   */
  isHealthy(): Promise<boolean>;

  /**
   * Get service type for debugging/configuration
   */
  getServiceType(): 'in-process' | 'redis' | 'bullmq';

  /**
   * Cleanup resources (connections, listeners, etc.)
   */
  cleanup(): Promise<void>;
}
