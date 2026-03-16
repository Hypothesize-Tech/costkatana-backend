/**
 * In-Process Chat Events Service (EventEmitter2)
 * Current implementation using EventEmitter2 for single-instance deployments
 * Implements IChatEventsService for consistency with distributed implementations
 */

import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from 'eventemitter2';
import { ChatEventData, IChatEventsService } from './chat-events.interface';

@Injectable()
export class ChatEventsEmitterService implements IChatEventsService {
  private readonly logger = new Logger(ChatEventsEmitterService.name);
  private eventEmitter: EventEmitter2;

  constructor() {
    // Initialize event emitter with wildcard support and other options
    this.eventEmitter = new EventEmitter2({
      wildcard: true,
      delimiter: '.',
      maxListeners: 100,
      verboseMemoryLeak: true,
    });

    this.logger.log('Chat events emitter service initialized (in-process)');
  }

  /**
   * Emit a chat event
   */
  async emit(event: ChatEventData): Promise<void> {
    try {
      const eventName = `chat.${event.chatId}.${event.type}`;
      this.eventEmitter.emit(eventName, event);
      this.eventEmitter.emit(`chat.${event.chatId}.*`, event);
      this.eventEmitter.emit('chat.*', event);

      this.logger.debug(`Emitted chat event: ${eventName}`, {
        chatId: event.chatId,
        userId: event.userId,
        type: event.type,
      });
    } catch (error) {
      this.logger.error('Failed to emit chat event', {
        error: error instanceof Error ? error.message : String(error),
        chatId: event.chatId,
      });
      throw error;
    }
  }

  /**
   * Listen for chat events
   */
  on(eventPattern: string, listener: (event: ChatEventData) => void): void {
    this.eventEmitter.on(eventPattern, listener);
  }

  /**
   * Remove event listener
   */
  off(eventPattern: string, listener?: (event: ChatEventData) => void): void {
    if (listener) {
      this.eventEmitter.off(eventPattern, listener);
    } else {
      this.eventEmitter.removeAllListeners(eventPattern);
    }
  }

  /**
   * Get listener count for debugging
   */
  getListenerCount(eventPattern?: string): number {
    if (eventPattern) {
      return this.eventEmitter.listenerCount(eventPattern);
    }
    return this.eventEmitter.eventNames().length;
  }

  /**
   * Emit message event
   */
  async emitMessage(
    chatId: string,
    userId: string,
    message: any,
  ): Promise<void> {
    await this.emit({
      chatId,
      userId,
      type: 'message',
      data: message,
      timestamp: new Date(),
    });
  }

  /**
   * Emit typing event
   */
  async emitTyping(
    chatId: string,
    userId: string,
    isTyping: boolean,
  ): Promise<void> {
    await this.emit({
      chatId,
      userId,
      type: 'typing',
      data: { isTyping, userId },
      timestamp: new Date(),
    });
  }

  /**
   * Emit status update event
   */
  async emitStatus(
    chatId: string,
    userId: string,
    status: string,
    metadata?: any,
  ): Promise<void> {
    await this.emit({
      chatId,
      userId,
      type: 'status',
      data: { status, metadata },
      timestamp: new Date(),
    });
  }

  /**
   * Emit error event
   */
  async emitError(
    chatId: string,
    userId: string,
    error: string,
    details?: any,
  ): Promise<void> {
    await this.emit({
      chatId,
      userId,
      type: 'error',
      data: { error, details },
      timestamp: new Date(),
    });
  }

  /**
   * Health check
   */
  async isHealthy(): Promise<boolean> {
    return true; // EventEmitter2 is always healthy in-process
  }

  /**
   * Get service type
   */
  getServiceType(): 'in-process' | 'redis' | 'bullmq' {
    return 'in-process';
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.eventEmitter.removeAllListeners();
    this.logger.log('Chat events emitter service cleaned up');
  }
}
