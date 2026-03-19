/**
 * SSE (Server-Sent Events) Transport Service for MCP
 * Handles SSE connections for web-based MCP clients with bidirectional communication
 */

import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'events';
import { LoggerService } from '../../../common/logger/logger.service';
import { MCPMessage, SSEConnection } from '../types/mcp.types';
import { generateSecureId } from '../../../common/utils/secure-id.util';

@Injectable()
export class SseTransportService
  extends EventEmitter
  implements OnModuleDestroy
{
  private connections = new Map<string, SSEConnection>();
  private messageQueues = new Map<string, MCPMessage[]>();
  private receivePromises = new Map<string, Array<(msg: MCPMessage) => void>>();
  private keepaliveIntervals = new Map<string, NodeJS.Timeout>();

  constructor(private logger: LoggerService) {
    super();
  }

  onModuleDestroy() {
    // Clean up all connections on module destroy
    for (const connectionId of Array.from(this.connections.keys())) {
      this.handleDisconnect(connectionId);
    }
  }

  /**
   * Create a new SSE connection
   */
  createConnection(req: any, res: any, userId: string): string {
    const connectionId = this.generateConnectionId();

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    const connection: SSEConnection = {
      connectionId,
      userId,
      res,
      lastActivity: new Date(),
    };

    this.connections.set(connectionId, connection);
    this.messageQueues.set(connectionId, []);
    this.receivePromises.set(connectionId, []);

    // Send initial connection event
    this.sendSSEEvent(res, 'connected', { connectionId });

    // Handle client disconnect
    req.on('close', () => {
      this.handleDisconnect(connectionId);
    });

    // Setup keepalive
    this.setupKeepalive(connectionId);

    this.logger.info('MCP SSE connection created', {
      connectionId,
      userId,
    });

    return connectionId;
  }

  /**
   * Send message to specific connection
   */
  async send(message: MCPMessage, connectionId?: string): Promise<void> {
    if (connectionId) {
      const connection = this.connections.get(connectionId);
      if (!connection) {
        throw new Error(`Connection ${connectionId} not found`);
      }

      this.sendSSEEvent(connection.res, 'message', message);
      connection.lastActivity = new Date();
    } else {
      // Broadcast to all connections
      for (const connection of this.connections.values()) {
        this.sendSSEEvent(connection.res, 'message', message);
        connection.lastActivity = new Date();
      }
    }

    this.logger.debug('MCP SSE sent', {
      method: message.method,
      id: message.id,
      connectionId: connectionId || 'broadcast',
    });
  }

  /**
   * Receive message from specific connection (not used for SSE, messages come via POST)
   */
  async receive(connectionId?: string): Promise<MCPMessage> {
    if (!connectionId) {
      throw new Error('Connection ID is required for SSE transport');
    }

    if (!this.connections.has(connectionId)) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    const queue = this.messageQueues.get(connectionId)!;

    // If there's a queued message, return it immediately
    if (queue.length > 0) {
      return queue.shift()!;
    }

    // Otherwise, wait for the next message
    return new Promise<MCPMessage>((resolve) => {
      const promises = this.receivePromises.get(connectionId)!;
      promises.push(resolve);
    });
  }

  /**
   * Handle incoming message from client (via POST request)
   */
  handleClientMessage(connectionId: string, message: MCPMessage): void {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      this.logger.warn('Message received for unknown connection', {
        connectionId,
      });
      return;
    }

    connection.lastActivity = new Date();

    const promises = this.receivePromises.get(connectionId)!;
    if (promises.length > 0) {
      const resolve = promises.shift()!;
      resolve(message);
    } else {
      const queue = this.messageQueues.get(connectionId)!;
      queue.push(message);
    }

    // Emit message event for server processing
    this.emit('message', message);

    // Special handling for confirmation responses
    if (message.method === 'confirmation/response') {
      this.emit(
        `confirmation:${message.params?.confirmationId}`,
        message.params,
      );
    }
  }

  /**
   * Request user confirmation (for dangerous operations)
   */
  async requestConfirmation(
    connectionId: string,
    confirmationId: string,
    resource: string,
    action: string,
    impact: string,
    timeoutSeconds: number = 120,
  ): Promise<boolean> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    // Send confirmation request
    await this.send(
      {
        jsonrpc: '2.0',
        method: 'confirmation/request',
        params: {
          confirmationId,
          resource,
          action,
          impact,
          expiresIn: timeoutSeconds,
        },
      },
      connectionId,
    );

    // Wait for confirmation response or timeout
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        this.removeAllListeners(`confirmation:${confirmationId}`);
        this.logger.warn('Confirmation timeout', {
          connectionId,
          confirmationId,
          resource,
        });
        resolve(false);
      }, timeoutSeconds * 1000);

      const handler = (response: any) => {
        clearTimeout(timeout);
        this.logger.info('Confirmation received', {
          connectionId,
          confirmationId,
          confirmed: response.confirmed,
        });
        resolve(response.confirmed === true);
      };

      this.once(`confirmation:${confirmationId}`, handler);
    });
  }

  /**
   * Get all active connections for a user
   */
  getUserConnections(userId: string): string[] {
    const connections: string[] = [];
    for (const [connectionId, connection] of this.connections.entries()) {
      if (connection.userId === userId) {
        connections.push(connectionId);
      }
    }
    return connections;
  }

  /**
   * Send SSE event
   */
  private sendSSEEvent(res: any, event: string, data: any): void {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      this.logger.error('Failed to send SSE event', {
        error: error instanceof Error ? error.message : String(error),
        event,
      });
    }
  }

  /**
   * Setup keepalive for connection
   */
  private setupKeepalive(connectionId: string): void {
    const interval = setInterval(() => {
      const connection = this.connections.get(connectionId);
      if (!connection) {
        clearInterval(interval);
        this.keepaliveIntervals.delete(connectionId);
        return;
      }

      try {
        this.sendSSEEvent(connection.res, 'ping', { timestamp: Date.now() });
      } catch (error) {
        clearInterval(interval);
        this.keepaliveIntervals.delete(connectionId);
        this.handleDisconnect(connectionId);
      }
    }, 30000); // Every 30 seconds

    this.keepaliveIntervals.set(connectionId, interval);
  }

  /**
   * Handle connection disconnect
   */
  private handleDisconnect(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      try {
        connection.res.end();
      } catch (error) {
        // Ignore errors on close
      }

      this.connections.delete(connectionId);
      this.messageQueues.delete(connectionId);
      this.receivePromises.delete(connectionId);

      // Clear keepalive interval
      const interval = this.keepaliveIntervals.get(connectionId);
      if (interval) {
        clearInterval(interval);
        this.keepaliveIntervals.delete(connectionId);
      }

      this.logger.info('MCP SSE connection closed', {
        connectionId,
        userId: connection.userId,
      });

      this.emit('disconnect', connectionId);
    }
  }

  /**
   * Generate unique connection ID
   */
  private generateConnectionId(): string {
    return generateSecureId('sse');
  }

  /**
   * Clean up stale connections
   */
  cleanupStaleConnections(maxAgeMinutes: number = 60): number {
    const now = new Date();
    let cleaned = 0;

    for (const [connectionId, connection] of this.connections.entries()) {
      const ageMinutes =
        (now.getTime() - connection.lastActivity.getTime()) / 1000 / 60;
      if (ageMinutes > maxAgeMinutes) {
        this.handleDisconnect(connectionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.info('Cleaned up stale SSE connections', { count: cleaned });
    }

    return cleaned;
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get active connection IDs
   */
  getActiveConnections(): string[] {
    return Array.from(this.connections.keys());
  }
}
