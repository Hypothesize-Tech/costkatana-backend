import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';

interface SSEClient {
  response: any;
  userId: string;
  taskId: string;
  lastActivity: Date;
}

@Injectable()
export class GovernedAgentSseService implements OnModuleDestroy {
  private clients = new Map<string, SSEClient[]>();
  private keepaliveIntervals = new Map<string, NodeJS.Timeout>();

  constructor(private readonly logger: LoggerService) {}

  onModuleDestroy() {
    // Clean up all clients on module destroy
    for (const [channelId, clients] of this.clients.entries()) {
      this.cleanupChannel(channelId);
    }
  }

  /**
   * Add a client to a task channel
   */
  addClient(taskId: string, userId: string, response: any): string {
    const channelId = `task_${taskId}`;

    if (!this.clients.has(channelId)) {
      this.clients.set(channelId, []);
      this.setupKeepalive(channelId);
    }

    const client: SSEClient = {
      response,
      userId,
      taskId,
      lastActivity: new Date(),
    };

    this.clients.get(channelId)!.push(client);

    // Set SSE headers
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Send initial connection event
    this.sendSSEEvent(response, 'connected', {
      taskId,
      channelId,
      timestamp: new Date().toISOString(),
    });

    this.logger.log('SSE client added to task channel', {
      component: 'GovernedAgentSseService',
      operation: 'addClient',
      channelId,
      taskId,
      userId,
      clientCount: this.clients.get(channelId)!.length,
    });

    return channelId;
  }

  /**
   * Remove a client from a task channel
   */
  removeClient(taskId: string, response: any): void {
    const channelId = `task_${taskId}`;
    const clients = this.clients.get(channelId);

    if (!clients) return;

    const clientIndex = clients.findIndex(
      (client) => client.response === response,
    );
    if (clientIndex !== -1) {
      clients.splice(clientIndex, 1);

      if (clients.length === 0) {
        this.cleanupChannel(channelId);
      }

      this.logger.log('SSE client removed from task channel', {
        component: 'GovernedAgentSseService',
        operation: 'removeClient',
        channelId,
        taskId,
        remainingClients: clients.length,
      });
    }
  }

  /**
   * Send event to all clients in a task channel
   */
  sendEvent(taskId: string, event: string, data: any): void {
    const channelId = `task_${taskId}`;
    const clients = this.clients.get(channelId);

    if (!clients || clients.length === 0) {
      return;
    }

    let sentCount = 0;
    const failedClients: number[] = [];

    clients.forEach((client, index) => {
      try {
        this.sendSSEEvent(client.response, event, data);
        client.lastActivity = new Date();
        sentCount++;
      } catch (error) {
        this.logger.warn('Failed to send SSE event to client', {
          component: 'GovernedAgentSseService',
          operation: 'sendEvent',
          taskId,
          clientIndex: index,
          error: error instanceof Error ? error.message : String(error),
        });
        failedClients.push(index);
      }
    });

    // Remove failed clients
    failedClients.reverse().forEach((index) => {
      clients.splice(index, 1);
    });

    if (failedClients.length > 0) {
      this.logger.log('Removed failed SSE clients', {
        component: 'GovernedAgentSseService',
        operation: 'sendEvent',
        taskId,
        removedCount: failedClients.length,
        remainingClients: clients.length,
      });
    }

    this.logger.debug('SSE event sent to task channel', {
      component: 'GovernedAgentSseService',
      operation: 'sendEvent',
      channelId,
      taskId,
      event,
      sentCount,
      totalClients: clients.length,
    });
  }

  /**
   * Send event to all clients across all channels (broadcast)
   */
  broadcastEvent(event: string, data: any): void {
    let totalSent = 0;
    let totalChannels = 0;

    for (const [channelId, clients] of this.clients.entries()) {
      totalChannels++;
      clients.forEach((client) => {
        try {
          this.sendSSEEvent(client.response, event, data);
          client.lastActivity = new Date();
          totalSent++;
        } catch (error) {
          this.logger.warn('Failed to broadcast SSE event to client', {
            component: 'GovernedAgentSseService',
            operation: 'broadcastEvent',
            channelId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    }

    this.logger.debug('SSE broadcast completed', {
      component: 'GovernedAgentSseService',
      operation: 'broadcastEvent',
      event,
      totalSent,
      totalChannels,
    });
  }

  /**
   * Get client count for a task channel
   */
  getClientCount(taskId: string): number {
    const channelId = `task_${taskId}`;
    return this.clients.get(channelId)?.length || 0;
  }

  /**
   * Get all active channels
   */
  getActiveChannels(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Clean up stale connections
   */
  cleanupStaleConnections(maxAgeMinutes: number = 30): number {
    let cleanedCount = 0;

    for (const [channelId, clients] of this.clients.entries()) {
      const originalLength = clients.length;
      const now = new Date();

      // Filter out stale clients
      const activeClients = clients.filter((client) => {
        const ageMinutes =
          (now.getTime() - client.lastActivity.getTime()) / (1000 * 60);
        return ageMinutes <= maxAgeMinutes;
      });

      const removedCount = originalLength - activeClients.length;

      if (removedCount > 0) {
        this.clients.set(channelId, activeClients);
        cleanedCount += removedCount;

        if (activeClients.length === 0) {
          this.cleanupChannel(channelId);
        }

        this.logger.log('Cleaned up stale SSE clients', {
          component: 'GovernedAgentSseService',
          operation: 'cleanupStaleConnections',
          channelId,
          removedCount,
          remainingClients: activeClients.length,
        });
      }
    }

    return cleanedCount;
  }

  /**
   * Send SSE event to response
   */
  private sendSSEEvent(response: any, event: string, data: any): void {
    try {
      response.write(`event: ${event}\n`);
      response.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      throw new Error(
        `Failed to send SSE event: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Setup keepalive for a channel
   */
  private setupKeepalive(channelId: string): void {
    const interval = setInterval(() => {
      const clients = this.clients.get(channelId);

      if (!clients || clients.length === 0) {
        clearInterval(interval);
        this.keepaliveIntervals.delete(channelId);
        return;
      }

      clients.forEach((client) => {
        try {
          this.sendSSEEvent(client.response, 'ping', {
            timestamp: new Date().toISOString(),
            clientCount: clients.length,
          });
        } catch (error) {
          this.logger.warn('Failed to send keepalive ping', {
            component: 'GovernedAgentSseService',
            operation: 'setupKeepalive',
            channelId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    }, 30000); // Every 30 seconds

    this.keepaliveIntervals.set(channelId, interval);
  }

  /**
   * Clean up a channel
   */
  private cleanupChannel(channelId: string): void {
    this.clients.delete(channelId);

    const interval = this.keepaliveIntervals.get(channelId);
    if (interval) {
      clearInterval(interval);
      this.keepaliveIntervals.delete(channelId);
    }

    this.logger.debug('SSE channel cleaned up', {
      component: 'GovernedAgentSseService',
      operation: 'cleanupChannel',
      channelId,
    });
  }
}
