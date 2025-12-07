/**
 * Cost Streaming Service
 * 
 * Provides real-time streaming of cost telemetry data via Server-Sent Events (SSE)
 * for dashboard consumption. Non-blocking and fail-safe.
 */

import { Response } from 'express';
import { loggingService } from './logging.service';
import { EventEmitter } from 'events';

export interface CostTelemetryEvent {
  eventType: 'cost_tracked' | 'cost_spike' | 'budget_warning' | 'optimization_opportunity' | 'cache_hit' | 'cache_miss';
  timestamp: Date;
  userId?: string;
  workspaceId?: string;
  data: {
    model?: string;
    vendor?: string;
    cost?: number;
    tokens?: number;
    latency?: number;
    operation?: string;
    template?: string;
    cacheHit?: boolean;
    budgetRemaining?: number;
    estimatedCost?: number;
    actualCost?: number;
    metadata?: Record<string, any>;
  };
}

export interface StreamClient {
  id: string;
  userId?: string;
  workspaceId?: string;
  res: Response;
  connectedAt: Date;
  lastHeartbeat: Date;
  filters?: {
    eventTypes?: string[];
    minCost?: number;
    operations?: string[];
  };
}

/**
 * Cost Streaming Service for real-time telemetry
 */
export class CostStreamingService {
  private static instance: CostStreamingService;
  private eventEmitter: EventEmitter;
  private clients: Map<string, StreamClient>;
  private heartbeatInterval?: NodeJS.Timeout;
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
  private readonly CLIENT_TIMEOUT = 65000; // 65 seconds
  private eventBuffer: Map<string, CostTelemetryEvent[]>;
  private readonly MAX_BUFFER_SIZE = 100;
  
  // Cost anomaly detection
  private costHistory: Map<string, { costs: number[]; timestamps: Date[] }>;
  private readonly ANOMALY_WINDOW_SIZE = 20; // Track last 20 requests
  private readonly SPIKE_THRESHOLD = 2.5; // 2.5x average cost = spike

  private constructor() {
    this.eventEmitter = new EventEmitter();
    this.eventEmitter.setMaxListeners(1000); // Support many concurrent streams
    this.clients = new Map();
    this.eventBuffer = new Map();
    this.costHistory = new Map();
    this.startHeartbeat();
    
    loggingService.info('🌊 Cost Streaming Service initialized with anomaly detection');
  }

  static getInstance(): CostStreamingService {
    if (!CostStreamingService.instance) {
      CostStreamingService.instance = new CostStreamingService();
    }
    return CostStreamingService.instance;
  }

  /**
   * Register a new SSE client for streaming
   */
  registerClient(
    clientId: string,
    res: Response,
    userId?: string,
    workspaceId?: string,
    filters?: StreamClient['filters']
  ): void {
    try {
      // Set up SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

      const client: StreamClient = {
        id: clientId,
        userId,
        workspaceId,
        res,
        connectedAt: new Date(),
        lastHeartbeat: new Date(),
        filters
      };

      this.clients.set(clientId, client);

      // Send initial connection message
      this.sendToClient(client, {
        eventType: 'cost_tracked',
        timestamp: new Date(),
        data: {
          metadata: {
            message: 'Connected to cost telemetry stream',
            clientId
          }
        }
      });

      // Send buffered events if any
      const bufferedEvents = this.eventBuffer.get(clientId);
      if (bufferedEvents && bufferedEvents.length > 0) {
        bufferedEvents.forEach(event => this.sendToClient(client, event));
        this.eventBuffer.delete(clientId);
      }

      // Handle client disconnect
      res.on('close', () => {
        this.unregisterClient(clientId);
      });

      loggingService.info('Client registered for cost streaming', {
        clientId,
        userId,
        workspaceId,
        totalClients: this.clients.size
      });
    } catch (error) {
      loggingService.error('Failed to register streaming client', {
        error: error instanceof Error ? error.message : String(error),
        clientId
      });
    }
  }

  /**
   * Unregister a client
   */
  unregisterClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      try {
        client.res.end();
      } catch (error) {
        // Ignore errors when closing already closed connections
      }
      this.clients.delete(clientId);
      
      loggingService.debug('Client unregistered from cost streaming', {
        clientId,
        totalClients: this.clients.size
      });
    }
  }

  /**
   * Emit a cost telemetry event to all subscribed clients
   */
  emitCostEvent(event: CostTelemetryEvent): void {
    try {
      // 🚨 P0: Real-time cost anomaly detection
      if (event.eventType === 'cost_tracked' && event.data.cost && event.userId) {
        this.detectCostAnomaly(event);
      }

      // Filter and send to matching clients
      const clientsToNotify = Array.from(this.clients.values()).filter(client => 
        this.shouldNotifyClient(client, event)
      );

      if (clientsToNotify.length === 0) {
        // Buffer event for future clients if relevant
        this.bufferEvent(event);
        return;
      }

      clientsToNotify.forEach(client => {
        this.sendToClient(client, event);
      });

      loggingService.debug('Cost event emitted to clients', {
        eventType: event.eventType,
        clientsNotified: clientsToNotify.length,
        cost: event.data.cost
      });
    } catch (error) {
      loggingService.error('Failed to emit cost event', {
        error: error instanceof Error ? error.message : String(error),
        eventType: event.eventType
      });
    }
  }

  /**
   * 🚨 Detect cost anomalies in real-time (P0 Feature)
   */
  private detectCostAnomaly(event: CostTelemetryEvent): void {
    if (!event.userId || !event.data.cost) return;

    const userKey = `${event.userId}:${event.data.model || 'all'}`;
    
    // Initialize cost history for this user+model
    if (!this.costHistory.has(userKey)) {
      this.costHistory.set(userKey, { costs: [], timestamps: [] });
    }

    const history = this.costHistory.get(userKey)!;
    history.costs.push(event.data.cost);
    history.timestamps.push(event.timestamp);

    // Keep only recent history
    if (history.costs.length > this.ANOMALY_WINDOW_SIZE) {
      history.costs.shift();
      history.timestamps.shift();
    }

    // Need at least 5 requests for baseline
    if (history.costs.length < 5) return;

    // Calculate average and detect spikes
    const recentCosts = history.costs.slice(0, -1); // Exclude current
    const avgCost = recentCosts.reduce((a, b) => a + b, 0) / recentCosts.length;
    const currentCost = event.data.cost;

    // Detect cost spike
    if (currentCost > avgCost * this.SPIKE_THRESHOLD) {
      const spikeEvent: CostTelemetryEvent = {
        eventType: 'cost_spike',
        timestamp: new Date(),
        userId: event.userId,
        workspaceId: event.workspaceId,
        data: {
          ...event.data,
          metadata: {
            ...event.data.metadata,
            averageCost: avgCost,
            currentCost,
            spikeMultiplier: currentCost / avgCost,
            recentRequests: history.costs.length
          }
        }
      };

      // Emit spike event immediately
      this.emitCostEvent(spikeEvent);

      loggingService.warn('💸 Cost spike detected!', {
        userId: event.userId,
        model: event.data.model,
        averageCost: avgCost.toFixed(4),
        currentCost: currentCost.toFixed(4),
        spikeMultiplier: (currentCost / avgCost).toFixed(2) + 'x'
      });
    }
  }

  /**
   * Check if a client should receive this event
   */
  private shouldNotifyClient(client: StreamClient, event: CostTelemetryEvent): boolean {
    // Filter by userId
    if (client.userId && event.userId && client.userId !== event.userId) {
      return false;
    }

    // Filter by workspaceId
    if (client.workspaceId && event.workspaceId && client.workspaceId !== event.workspaceId) {
      return false;
    }

    // Apply client-specific filters
    if (client.filters) {
      // Event type filter
      if (client.filters.eventTypes && 
          !client.filters.eventTypes.includes(event.eventType)) {
        return false;
      }

      // Minimum cost filter
      if (client.filters.minCost && 
          event.data.cost && 
          event.data.cost < client.filters.minCost) {
        return false;
      }

      // Operation filter
      if (client.filters.operations && 
          event.data.operation && 
          !client.filters.operations.includes(event.data.operation)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Send event to a specific client
   */
  private sendToClient(client: StreamClient, event: CostTelemetryEvent): void {
    try {
      const data = JSON.stringify(event);
      client.res.write(`data: ${data}\n\n`);
      client.lastHeartbeat = new Date();
    } catch (error) {
      loggingService.warn('Failed to send to client, removing', {
        clientId: client.id,
        error: error instanceof Error ? error.message : String(error)
      });
      this.unregisterClient(client.id);
    }
  }

  /**
   * Buffer events for future clients
   */
  private bufferEvent(event: CostTelemetryEvent): void {
    // Create a global buffer key
    const bufferKey = 'global';
    
    if (!this.eventBuffer.has(bufferKey)) {
      this.eventBuffer.set(bufferKey, []);
    }

    const buffer = this.eventBuffer.get(bufferKey)!;
    buffer.push(event);

    // Keep buffer size limited
    if (buffer.length > this.MAX_BUFFER_SIZE) {
      buffer.shift(); // Remove oldest event
    }
  }

  /**
   * Send heartbeat to all clients
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = new Date();
      const clientsToRemove: string[] = [];

      this.clients.forEach((client, clientId) => {
        const timeSinceLastHeartbeat = now.getTime() - client.lastHeartbeat.getTime();

        // Remove clients that haven't responded in a while
        if (timeSinceLastHeartbeat > this.CLIENT_TIMEOUT) {
          clientsToRemove.push(clientId);
          return;
        }

        // Send heartbeat
        try {
          client.res.write(`:heartbeat ${now.toISOString()}\n\n`);
          client.lastHeartbeat = now;
        } catch (error) {
          clientsToRemove.push(clientId);
        }
      });

      // Remove dead clients
      clientsToRemove.forEach(clientId => this.unregisterClient(clientId));

      if (clientsToRemove.length > 0) {
        loggingService.debug('Cleaned up inactive streaming clients', {
          removed: clientsToRemove.length,
          active: this.clients.size
        });
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  /**
   * Get streaming statistics
   */
  getStats(): {
    activeClients: number;
    clientsByUser: Map<string, number>;
    clientsByWorkspace: Map<string, number>;
    bufferedEvents: number;
    oldestConnection?: Date;
  } {
    const clientsByUser = new Map<string, number>();
    const clientsByWorkspace = new Map<string, number>();
    let oldestConnection: Date | undefined;

    this.clients.forEach(client => {
      if (client.userId) {
        clientsByUser.set(client.userId, (clientsByUser.get(client.userId) || 0) + 1);
      }
      if (client.workspaceId) {
        clientsByWorkspace.set(client.workspaceId, (clientsByWorkspace.get(client.workspaceId) || 0) + 1);
      }
      if (!oldestConnection || client.connectedAt < oldestConnection) {
        oldestConnection = client.connectedAt;
      }
    });

    const bufferedEvents = Array.from(this.eventBuffer.values())
      .reduce((sum, buffer) => sum + buffer.length, 0);

    return {
      activeClients: this.clients.size,
      clientsByUser,
      clientsByWorkspace,
      bufferedEvents,
      oldestConnection
    };
  }

  /**
   * Cleanup and shutdown
   */
  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Close all client connections
    this.clients.forEach((client, clientId) => {
      this.unregisterClient(clientId);
    });

    this.eventBuffer.clear();
    
    loggingService.info('Cost Streaming Service shut down');
  }
}

// Export singleton instance
export const costStreamingService = CostStreamingService.getInstance();

