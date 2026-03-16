import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { LoggerService } from '../logger/logger.service';

interface SSEClient {
  response: any;
  userId: string;
  lastActivity: Date;
}

interface NotificationData {
  type: string;
  id: string;
  title: string;
  message: string;
  data?: any;
  timestamp: string;
  expiresAt?: string;
}

@Injectable()
export class UserNotificationService implements OnModuleDestroy {
  private clients = new Map<string, SSEClient[]>();
  private keepaliveIntervals = new Map<string, NodeJS.Timeout>();
  private pendingConfirmations = new Map<
    string,
    {
      resolve: (approved: boolean) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
      userId: string;
    }
  >();

  constructor(private readonly logger: LoggerService) {}

  onModuleDestroy() {
    // Clean up all clients on module destroy
    for (const [userId, clients] of this.clients.entries()) {
      this.cleanupUserClients(userId);
    }

    // Clean up pending confirmations
    for (const [
      confirmationId,
      { reject, timeout },
    ] of this.pendingConfirmations.entries()) {
      clearTimeout(timeout);
      reject(new Error('Service shutting down'));
    }
  }

  /**
   * Add a client for user notifications
   */
  addClient(userId: string, response: any): string {
    if (!this.clients.has(userId)) {
      this.clients.set(userId, []);
      this.setupKeepalive(userId);
    }

    const client: SSEClient = {
      response,
      userId,
      lastActivity: new Date(),
    };

    this.clients.get(userId)!.push(client);

    // Set SSE headers
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Send initial connection event
    this.sendSSEEvent(response, 'connected', {
      userId,
      timestamp: new Date().toISOString(),
      message: 'Connected to user notifications',
    });

    this.logger.log('SSE client added for user notifications', {
      component: 'UserNotificationService',
      operation: 'addClient',
      userId,
      clientCount: this.clients.get(userId)!.length,
    });

    return `user_${userId}_${Date.now()}`;
  }

  /**
   * Remove a client
   */
  removeClient(userId: string, response: any): void {
    const clients = this.clients.get(userId);
    if (!clients) return;

    const clientIndex = clients.findIndex(
      (client) => client.response === response,
    );
    if (clientIndex !== -1) {
      clients.splice(clientIndex, 1);

      if (clients.length === 0) {
        this.cleanupUserClients(userId);
      }

      this.logger.log('SSE client removed from user notifications', {
        component: 'UserNotificationService',
        operation: 'removeClient',
        userId,
        remainingClients: clients.length,
      });
    }
  }

  /**
   * Send notification to user
   */
  async sendNotification(
    userId: string,
    notification: Omit<NotificationData, 'timestamp'>,
  ): Promise<void> {
    const clients = this.clients.get(userId);
    if (!clients || clients.length === 0) {
      this.logger.warn('No active SSE clients for user notifications', {
        component: 'UserNotificationService',
        operation: 'sendNotification',
        userId,
        notificationType: notification.type,
      });
      return;
    }

    const fullNotification: NotificationData = {
      ...notification,
      timestamp: new Date().toISOString(),
    };

    let sentCount = 0;
    const failedClients: number[] = [];

    clients.forEach((client, index) => {
      try {
        this.sendSSEEvent(client.response, 'notification', fullNotification);
        client.lastActivity = new Date();
        sentCount++;
      } catch (error) {
        this.logger.warn('Failed to send notification to client', {
          component: 'UserNotificationService',
          operation: 'sendNotification',
          userId,
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

    this.logger.log('Notification sent to user', {
      component: 'UserNotificationService',
      operation: 'sendNotification',
      userId,
      notificationType: notification.type,
      notificationId: notification.id,
      sentCount,
      totalClients: clients.length,
      failedClients: failedClients.length,
    });
  }

  /**
   * Request user approval with timeout
   */
  async requestApproval(
    userId: string,
    confirmationId: string,
    title: string,
    message: string,
    data?: any,
    timeoutSeconds: number = 300, // 5 minutes default
  ): Promise<boolean> {
    // Send approval request notification
    await this.sendNotification(userId, {
      type: 'approval_request',
      id: confirmationId,
      title,
      message,
      data: {
        ...data,
        approvalRequired: true,
        actions: {
          approve: `/api/user/approvals/${confirmationId}/approve`,
          reject: `/api/user/approvals/${confirmationId}/reject`,
        },
      },
      expiresAt: new Date(Date.now() + timeoutSeconds * 1000).toISOString(),
    });

    // Wait for approval response or timeout
    return new Promise<boolean>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingConfirmations.delete(confirmationId);
        this.logger.warn('Approval request timeout', {
          component: 'UserNotificationService',
          operation: 'requestApproval',
          userId,
          confirmationId,
        });
        resolve(false); // Default to denied on timeout
      }, timeoutSeconds * 1000);

      this.pendingConfirmations.set(confirmationId, {
        resolve,
        reject,
        timeout,
        userId,
      });
    });
  }

  /**
   * Handle approval response from user
   */
  handleApprovalResponse(confirmationId: string, approved: boolean): boolean {
    const pending = this.pendingConfirmations.get(confirmationId);
    if (!pending) {
      this.logger.warn('Received approval response for unknown confirmation', {
        component: 'UserNotificationService',
        operation: 'handleApprovalResponse',
        confirmationId,
        approved,
      });
      return false;
    }

    const { resolve, timeout } = pending;
    clearTimeout(timeout);
    this.pendingConfirmations.delete(confirmationId);

    // Send confirmation notification
    const { userId } = pending;
    if (userId) {
      this.sendNotification(userId, {
        type: 'approval_response',
        id: confirmationId,
        title: approved ? 'Request Approved' : 'Request Denied',
        message: `Your approval request has been ${approved ? 'approved' : 'denied'}.`,
        data: { approved, confirmationId },
      }).catch((error) => {
        this.logger.error('Failed to send approval confirmation notification', {
          component: 'UserNotificationService',
          operation: 'handleApprovalResponse',
          confirmationId,
          approved,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    resolve(approved);

    this.logger.log('Approval response handled', {
      component: 'UserNotificationService',
      operation: 'handleApprovalResponse',
      confirmationId,
      approved,
    });

    return true;
  }

  /**
   * Check if user has active notification connections
   */
  isUserOnline(userId: string): boolean {
    const clients = this.clients.get(userId);
    return Boolean(clients && clients.length > 0);
  }

  /**
   * Get client count for user
   */
  getUserClientCount(userId: string): number {
    return this.clients.get(userId)?.length || 0;
  }

  /**
   * Clean up stale connections
   */
  cleanupStaleConnections(maxAgeMinutes: number = 30): number {
    let cleanedCount = 0;

    for (const [userId, clients] of this.clients.entries()) {
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
        this.clients.set(userId, activeClients);
        cleanedCount += removedCount;

        if (activeClients.length === 0) {
          this.cleanupUserClients(userId);
        }
      }
    }

    if (cleanedCount > 0) {
      this.logger.log('Cleaned up stale user notification clients', {
        component: 'UserNotificationService',
        operation: 'cleanupStaleConnections',
        cleanedCount,
      });
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
   * Setup keepalive for user
   */
  private setupKeepalive(userId: string): void {
    const interval = setInterval(() => {
      const clients = this.clients.get(userId);

      if (!clients || clients.length === 0) {
        clearInterval(interval);
        this.keepaliveIntervals.delete(userId);
        return;
      }

      clients.forEach((client) => {
        try {
          this.sendSSEEvent(client.response, 'ping', {
            timestamp: new Date().toISOString(),
            userId,
          });
        } catch (error) {
          this.logger.warn('Failed to send keepalive ping', {
            component: 'UserNotificationService',
            operation: 'setupKeepalive',
            userId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    }, 30000); // Every 30 seconds

    this.keepaliveIntervals.set(userId, interval);
  }

  /**
   * Clean up user clients
   */
  private cleanupUserClients(userId: string): void {
    this.clients.delete(userId);

    const interval = this.keepaliveIntervals.get(userId);
    if (interval) {
      clearInterval(interval);
      this.keepaliveIntervals.delete(userId);
    }
  }
}
