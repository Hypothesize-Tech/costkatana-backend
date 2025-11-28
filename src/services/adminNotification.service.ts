import { loggingService } from './logging.service';

interface NotificationData {
    type: string;
    [key: string]: unknown;
}

export class AdminNotificationService {
    private static instance: AdminNotificationService;
    private notificationClients: Map<string, Set<(data: NotificationData) => void>> = new Map(); // adminId -> Set of callbacks

    private constructor() {}

    static getInstance(): AdminNotificationService {
        if (!AdminNotificationService.instance) {
            AdminNotificationService.instance = new AdminNotificationService();
        }
        return AdminNotificationService.instance;
    }

    /**
     * Subscribe admin to notifications
     */
    subscribe(adminId: string, callback: (data: NotificationData) => void): () => void {
        if (!this.notificationClients.has(adminId)) {
            this.notificationClients.set(adminId, new Set());
        }

        const clients = this.notificationClients.get(adminId);
        if (clients) {
            clients.add(callback);
        }

        // Return unsubscribe function
        return () => {
            const clientSet = this.notificationClients.get(adminId);
            if (clientSet) {
                clientSet.delete(callback);
                if (clientSet.size === 0) {
                    this.notificationClients.delete(adminId);
                }
            }
        };
    }

    /**
     * Broadcast notification to specific admin
     */
    notifyAdmin(adminId: string, data: NotificationData): void {
        const clients = this.notificationClients.get(adminId);
        if (clients) {
            clients.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    loggingService.error('Admin notification error', { adminId, error });
                }
            });
        }
    }

    /**
     * Broadcast notification to all admins
     */
    notifyAllAdmins(data: NotificationData): void {
        this.notificationClients.forEach((clients, adminId) => {
            clients.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    loggingService.error('Admin notification error', { adminId, error });
                }
            });
        });
    }

    /**
     * Check if admin is online
     */
    isAdminOnline(adminId: string): boolean {
        return this.notificationClients.has(adminId) && 
               (this.notificationClients.get(adminId)?.size ?? 0) > 0;
    }

    /**
     * Get all online admins
     */
    getOnlineAdmins(): string[] {
        return Array.from(this.notificationClients.keys()).filter(adminId => 
            this.isAdminOnline(adminId)
        );
    }
}

export const adminNotificationService = AdminNotificationService.getInstance();

