import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from 'eventemitter2';

export interface ChatEventData {
  chatId: string;
  userId: string;
  type: 'message' | 'typing' | 'status' | 'error';
  data: any;
  timestamp: Date;
}

@Injectable()
export class ChatEventsService {
  private readonly logger = new Logger(ChatEventsService.name);
  private eventEmitter: EventEmitter2;

  constructor() {
    // Initialize event emitter with wildcard support and other options
    this.eventEmitter = new EventEmitter2({
      wildcard: true,
      delimiter: '.',
      maxListeners: 100,
      verboseMemoryLeak: true,
    });

    this.logger.log('Chat events service initialized');
  }

  /**
   * Emit a chat event
   */
  emit(event: ChatEventData): void {
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
  emitMessage(chatId: string, userId: string, message: any): void {
    this.emit({
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
  emitTyping(chatId: string, userId: string, isTyping: boolean): void {
    this.emit({
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
  emitStatus(
    chatId: string,
    userId: string,
    status: string,
    metadata?: any,
  ): void {
    this.emit({
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
  emitError(
    chatId: string,
    userId: string,
    error: string,
    details?: any,
  ): void {
    this.emit({
      chatId,
      userId,
      type: 'error',
      data: { error, details },
      timestamp: new Date(),
    });
  }
}
