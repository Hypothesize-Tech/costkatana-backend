/**
 * stdio Transport for MCP
 * Used for CLI tools and local development
 */

import { MCPMessage } from '../types/mcp.types';
import { BaseTransport } from './base.transport';
import { loggingService } from '../../services/logging.service';
import * as readline from 'readline';

export class StdioTransport extends BaseTransport {
  private rl: readline.Interface;
  private messageQueue: MCPMessage[] = [];
  private receivePromises: Array<(msg: MCPMessage) => void> = [];

  constructor() {
    super();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    this.setupListeners();
  }

  private setupListeners(): void {
    this.rl.on('line', (line: string) => {
      try {
        const message: MCPMessage = JSON.parse(line);
        this.handleIncomingMessage(message);
      } catch (error) {
        loggingService.error('Failed to parse stdin message', {
          error: error instanceof Error ? error.message : String(error),
          line,
        });
        this.handleError(new Error(`Invalid JSON: ${line}`));
      }
    });

    this.rl.on('close', () => {
      this.closed = true;
      this.emit('close');
    });
  }

  private handleIncomingMessage(message: MCPMessage): void {
    if (this.receivePromises.length > 0) {
      const resolve = this.receivePromises.shift();
      resolve!(message);
    } else {
      this.messageQueue.push(message);
    }
    this.handleMessage(message);
  }

  async send(message: MCPMessage): Promise<void> {
    if (this.closed) {
      throw new Error('Transport is closed');
    }

    try {
      const json = JSON.stringify(message);
      process.stdout.write(json + '\n');
      
      loggingService.debug('MCP stdio sent', {
        method: message.method,
        id: message.id,
      });
    } catch (error) {
      loggingService.error('Failed to send stdio message', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async receive(): Promise<MCPMessage> {
    if (this.closed) {
      throw new Error('Transport is closed');
    }

    // If there's a queued message, return it immediately
    if (this.messageQueue.length > 0) {
      return this.messageQueue.shift()!;
    }

    // Otherwise, wait for the next message
    return new Promise<MCPMessage>((resolve) => {
      this.receivePromises.push(resolve);
    });
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.rl.close();
      await super.close();
      
      loggingService.info('MCP stdio transport closed');
    }
  }
}
