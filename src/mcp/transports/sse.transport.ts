/**
 * SSE (Server-Sent Events) Transport for MCP
 * Used for web-based agents and browser clients
 * Supports bidirectional communication for confirmations
 */

import { MCPMessage } from '../types/mcp.types';
import { BaseTransport } from './base.transport';
import { loggingService } from '../../services/logging.service';
import { Request, Response } from 'express';
import { EventEmitter } from 'events';

export interface SSEConnection {
  connectionId: string;
  userId: string;
  res: Response;
  lastActivity: Date;
}

export class SSETransport extends BaseTransport {
  private connections = new Map<string, SSEConnection>();
  private messageQueues = new Map<string, MCPMessage[]>();
  private receivePromises = new Map<string, Array<(msg: MCPMessage) => void>>();
  private confirmationEmitter = new EventEmitter();

  /**
   * Create a new SSE connection
   */
  createConnection(req: Request, res: Response, userId: string): string {
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

    loggingService.info('MCP SSE connection created', {
      connectionId,
      userId,
    });

    return connectionId;
  }

  /**
   * Send message to specific connection
   */
  async send(message: MCPMessage, connectionId?: string): Promise<void> {
    if (this.closed) {
      throw new Error('Transport is closed');
    }

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

    loggingService.debug('MCP SSE sent', {
      method: message.method,
      id: message.id,
      connectionId: connectionId || 'broadcast',
    });
  }

  /**
   * Receive message from specific connection
   */
  async receive(connectionId?: string): Promise<MCPMessage> {
    if (this.closed) {
      throw new Error('Transport is closed');
    }

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
      loggingService.warn('Message received for unknown connection', {
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

    this.handleMessage(message);

    // Special handling for confirmation responses
    if (message.method === 'confirmation/response') {
      this.confirmationEmitter.emit(`confirmation:${message.params?.confirmationId}`, message.params);
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
    timeoutSeconds: number = 120
  ): Promise<boolean> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    // Send confirmation request
    await this.send({
      jsonrpc: '2.0',
      method: 'confirmation/request',
      params: {
        confirmationId,
        resource,
        action,
        impact,
        expiresIn: timeoutSeconds,
      },
    }, connectionId);

    // Wait for confirmation response or timeout
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        this.confirmationEmitter.off(`confirmation:${confirmationId}`, handler);
        loggingService.warn('Confirmation timeout', {
          connectionId,
          confirmationId,
          resource,
        });
        resolve(false);
      }, timeoutSeconds * 1000);

      const handler = (response: any) => {
        clearTimeout(timeout);
        loggingService.info('Confirmation received', {
          connectionId,
          confirmationId,
          confirmed: response.confirmed,
        });
        resolve(response.confirmed === true);
      };

      this.confirmationEmitter.once(`confirmation:${confirmationId}`, handler);
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
  private sendSSEEvent(res: Response, event: string, data: any): void {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      loggingService.error('Failed to send SSE event', {
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
        return;
      }

      try {
        this.sendSSEEvent(connection.res, 'ping', { timestamp: Date.now() });
      } catch (error) {
        clearInterval(interval);
        this.handleDisconnect(connectionId);
      }
    }, 30000); // Every 30 seconds
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

      loggingService.info('MCP SSE connection closed', {
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
    return `sse_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    if (!this.closed) {
      for (const connectionId of Array.from(this.connections.keys())) {
        this.handleDisconnect(connectionId);
      }

      await super.close();
      
      loggingService.info('MCP SSE transport closed');
    }
  }

  /**
   * Clean up stale connections
   */
  cleanupStaleConnections(maxAgeMinutes: number = 60): number {
    const now = new Date();
    let cleaned = 0;

    for (const [connectionId, connection] of this.connections.entries()) {
      const ageMinutes = (now.getTime() - connection.lastActivity.getTime()) / 1000 / 60;
      if (ageMinutes > maxAgeMinutes) {
        this.handleDisconnect(connectionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      loggingService.info('Cleaned up stale SSE connections', { count: cleaned });
    }

    return cleaned;
  }
}
