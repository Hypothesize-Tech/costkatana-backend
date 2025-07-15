import { logger } from './logger';

interface SecurityEvent {
    timestamp: string;
    ip: string;
    path: string;
    method: string;
    userAgent: string;
    eventType: 'blocked_request' | 'suspicious_404' | 'rate_limit' | 'dangerous_pattern';
    severity: 'low' | 'medium' | 'high';
    details?: any;
}

class SecurityMonitor {
    private events: SecurityEvent[] = [];
    private readonly MAX_EVENTS = 1000; // Keep last 1000 events in memory
    private suspiciousIPs: Map<string, number> = new Map();

    recordEvent(event: SecurityEvent) {
        this.events.push(event);

        // Keep only the last MAX_EVENTS
        if (this.events.length > this.MAX_EVENTS) {
            this.events.shift();
        }

        // Track suspicious IPs
        const currentCount = this.suspiciousIPs.get(event.ip) || 0;
        this.suspiciousIPs.set(event.ip, currentCount + 1);

        // Log high severity events immediately
        if (event.severity === 'high') {
            logger.error('High severity security event:', event);
        }

        // Check for repeated suspicious activity
        if (currentCount + 1 >= 5) {
            logger.warn('IP showing repeated suspicious activity:', {
                ip: event.ip,
                count: currentCount + 1,
                recentEvents: this.getEventsByIP(event.ip).slice(-5)
            });
        }
    }

    getEventsByIP(ip: string): SecurityEvent[] {
        return this.events.filter(event => event.ip === ip);
    }

    getSuspiciousIPs(): Array<{ ip: string; count: number }> {
        return Array.from(this.suspiciousIPs.entries())
            .map(([ip, count]) => ({ ip, count }))
            .sort((a, b) => b.count - a.count);
    }

    getRecentEvents(count: number = 50): SecurityEvent[] {
        return this.events.slice(-count);
    }

    getEventsByType(eventType: SecurityEvent['eventType']): SecurityEvent[] {
        return this.events.filter(event => event.eventType === eventType);
    }

    getEventsBySeverity(severity: SecurityEvent['severity']): SecurityEvent[] {
        return this.events.filter(event => event.severity === severity);
    }

    generateSecurityReport(): any {
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

        const recentEvents = this.events.filter(event =>
            new Date(event.timestamp) > oneHourAgo
        );

        const eventsByType = {
            blocked_request: recentEvents.filter(e => e.eventType === 'blocked_request').length,
            suspicious_404: recentEvents.filter(e => e.eventType === 'suspicious_404').length,
            rate_limit: recentEvents.filter(e => e.eventType === 'rate_limit').length,
            dangerous_pattern: recentEvents.filter(e => e.eventType === 'dangerous_pattern').length
        };

        const topSuspiciousIPs = this.getSuspiciousIPs().slice(0, 10);

        return {
            timestamp: now.toISOString(),
            period: 'Last 1 hour',
            totalEvents: recentEvents.length,
            eventsByType,
            topSuspiciousIPs,
            severityBreakdown: {
                high: recentEvents.filter(e => e.severity === 'high').length,
                medium: recentEvents.filter(e => e.severity === 'medium').length,
                low: recentEvents.filter(e => e.severity === 'low').length
            }
        };
    }

    // Clean up old IP tracking data
    cleanupOldData() {
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        // Remove events older than 24 hours
        this.events = this.events.filter(event =>
            new Date(event.timestamp) > oneDayAgo
        );

        // Reset IP counts for IPs that haven't been seen recently
        const recentIPs = new Set(this.events.map(event => event.ip));
        for (const ip of this.suspiciousIPs.keys()) {
            if (!recentIPs.has(ip)) {
                this.suspiciousIPs.delete(ip);
            }
        }
    }
}

export const securityMonitor = new SecurityMonitor();

// Helper functions for different types of security events
export const recordBlockedRequest = (ip: string, path: string, method: string, userAgent: string, details?: any) => {
    securityMonitor.recordEvent({
        timestamp: new Date().toISOString(),
        ip,
        path,
        method,
        userAgent,
        eventType: 'blocked_request',
        severity: 'medium',
        details
    });
};

export const recordSuspicious404 = (ip: string, path: string, method: string, userAgent: string, details?: any) => {
    securityMonitor.recordEvent({
        timestamp: new Date().toISOString(),
        ip,
        path,
        method,
        userAgent,
        eventType: 'suspicious_404',
        severity: 'low',
        details
    });
};

export const recordRateLimit = (ip: string, path: string, method: string, userAgent: string, details?: any) => {
    securityMonitor.recordEvent({
        timestamp: new Date().toISOString(),
        ip,
        path,
        method,
        userAgent,
        eventType: 'rate_limit',
        severity: 'medium',
        details
    });
};

export const recordDangerousPattern = (ip: string, path: string, method: string, userAgent: string, details?: any) => {
    securityMonitor.recordEvent({
        timestamp: new Date().toISOString(),
        ip,
        path,
        method,
        userAgent,
        eventType: 'dangerous_pattern',
        severity: 'high',
        details
    });
};

// Schedule cleanup every hour
setInterval(() => {
    securityMonitor.cleanupOldData();
}, 60 * 60 * 1000);

export { SecurityMonitor, SecurityEvent }; 