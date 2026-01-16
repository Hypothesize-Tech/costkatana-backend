/**
 * Base Transport Layer for MCP
 * Abstract class that all transports must implement
 */

import { MCPMessage } from '../types/mcp.types';
import { EventEmitter } from 'events';

export abstract class BaseTransport extends EventEmitter {
  protected closed = false;

  /**
   * Send a message through the transport
   */
  abstract send(message: MCPMessage): Promise<void>;

  /**
   * Receive a message from the transport
   * Should block until a message is available
   * @param connectionId Optional connection ID for multi-connection transports (e.g., SSE)
   */
  abstract receive(connectionId?: string): Promise<MCPMessage>;

  /**
   * Close the transport connection
   */
  async close(): Promise<void> {
    this.closed = true;
    this.emit('close');
  }

  /**
   * Check if transport is closed
   */
  isClosed(): boolean {
    return this.closed;
  }

  /**
   * Handle incoming messages
   */
  protected handleMessage(message: MCPMessage): void {
    this.emit('message', message);
  }

  /**
   * Handle errors
   */
  protected handleError(error: Error): void {
    this.emit('error', error);
  }
}
