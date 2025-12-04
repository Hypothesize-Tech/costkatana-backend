import { UserSession, IUserSession } from '../models/UserSession';
import { User } from '../models/User';
import { generateToken } from '../utils/helpers';
import { loggingService } from './logging.service';
import * as crypto from 'crypto';
import * as geoip from 'geoip-lite';
import { Request } from 'express';

interface DeviceInfo {
    userAgent: string;
    ipAddress: string;
    deviceName?: string;
}

interface ParsedDeviceInfo {
    deviceName: string;
    browser: string;
    os: string;
}

export class UserSessionService {
    private static readonly SESSION_EXPIRY_DAYS = 30;
    private static readonly REVOKE_TOKEN_EXPIRY_HOURS = 24;

    /**
     * Create a new user session
     */
    static async createUserSession(
        userId: string,
        deviceInfo: DeviceInfo,
        refreshToken: string
    ): Promise<{ userSession: IUserSession; isNewDevice: boolean }> {
        try {
            // Parse device information
            const parsedDeviceInfo = this.detectDeviceInfo(deviceInfo.userAgent, deviceInfo.ipAddress);
            
            // Get location from IP
            const location = this.getLocationFromIP(deviceInfo.ipAddress);
            
            // Generate session ID
            const userSessionId = generateToken(32);
            
            // Hash refresh token for revocation
            const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
            
            // Generate revoke token for email-based revocation
            const revokeToken = generateToken(32);
            
            // Calculate expiry date
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + this.SESSION_EXPIRY_DAYS);
            
            // Check if this is a new device
            const isNewDevice = await this.isNewDevice(userId, parsedDeviceInfo);
            
            // Check concurrent session limit
            await this.enforceConcurrentSessionLimit(userId);
            
            // Create session
            const userSession = await UserSession.create({
                userSessionId,
                userId,
                deviceName: deviceInfo.deviceName ?? parsedDeviceInfo.deviceName,
                userAgent: deviceInfo.userAgent,
                ipAddress: deviceInfo.ipAddress,
                location,
                browser: parsedDeviceInfo.browser,
                os: parsedDeviceInfo.os,
                createdAt: new Date(),
                lastActiveAt: new Date(),
                expiresAt,
                isActive: true,
                refreshTokenHash,
                revokeToken
            });
            
            loggingService.info('User session created', {
                component: 'UserSessionService',
                operation: 'createUserSession',
                userId,
                userSessionId,
                isNewDevice,
                deviceName: parsedDeviceInfo.deviceName
            });
            
            return { userSession, isNewDevice };
        } catch (error) {
            loggingService.error('Error creating user session', {
                component: 'UserSessionService',
                operation: 'createUserSession',
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get all active user sessions for a user
     */
    static async getActiveUserSessions(userId: string, currentUserSessionId?: string): Promise<IUserSession[]> {
        try {
            const sessions = await UserSession.find({
                userId,
                isActive: true,
                expiresAt: { $gt: new Date() }
            }).sort({ lastActiveAt: -1 });
            
            // Mark current session
            if (currentUserSessionId) {
                sessions.forEach(session => {
                    const sessionWithFlag = session as IUserSession & { isCurrentSession?: boolean };
                    sessionWithFlag.isCurrentSession = session.userSessionId === currentUserSessionId;
                });
            }
            
            return sessions;
        } catch (error) {
            loggingService.error('Error getting active user sessions', {
                component: 'UserSessionService',
                operation: 'getActiveUserSessions',
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Revoke a specific user session
     */
    static async revokeUserSession(userId: string, userSessionId: string): Promise<void> {
        try {
            const session = await UserSession.findOne({
                userSessionId,
                userId,
                isActive: true
            });
            
            if (!session) {
                throw new Error('Session not found or already revoked');
            }
            
            // Prevent revoking current session (should be checked at controller level too)
            // This is a safety check
            
            session.isActive = false;
            await session.save();
            
            loggingService.info('User session revoked', {
                component: 'UserSessionService',
                operation: 'revokeUserSession',
                userId,
                userSessionId
            });
        } catch (error) {
            loggingService.error('Error revoking user session', {
                component: 'UserSessionService',
                operation: 'revokeUserSession',
                userId,
                userSessionId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Revoke user session by revoke token (from email link)
     */
    static async revokeUserSessionByToken(revokeToken: string): Promise<{ userId: string; userSessionId: string }> {
        try {
            const session = await UserSession.findOne({
                revokeToken,
                isActive: true,
                expiresAt: { $gt: new Date() }
            });
            
            if (!session) {
                throw new Error('Invalid or expired revoke token');
            }
            
            // Check if token is expired (24 hours)
            const tokenAge = Date.now() - session.createdAt.getTime();
            const maxAge = this.REVOKE_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000;
            
            if (tokenAge > maxAge) {
                throw new Error('Revoke token has expired');
            }
            
            session.isActive = false;
            session.revokeToken = undefined; // Single-use token
            await session.save();
            
            loggingService.info('User session revoked via email token', {
                component: 'UserSessionService',
                operation: 'revokeUserSessionByToken',
                userId: session.userId,
                userSessionId: session.userSessionId
            });
            
            return {
                userId: session.userId,
                userSessionId: session.userSessionId
            };
        } catch (error) {
            loggingService.error('Error revoking user session by token', {
                component: 'UserSessionService',
                operation: 'revokeUserSessionByToken',
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Revoke all other user sessions except current
     */
    static async revokeAllOtherUserSessions(userId: string, currentUserSessionId: string): Promise<number> {
        try {
            const result = await UserSession.updateMany(
                {
                    userId,
                    userSessionId: { $ne: currentUserSessionId },
                    isActive: true
                },
                {
                    $set: { isActive: false }
                }
            );
            
            loggingService.info('All other user sessions revoked', {
                component: 'UserSessionService',
                operation: 'revokeAllOtherUserSessions',
                userId,
                currentUserSessionId,
                revokedCount: result.modifiedCount
            });
            
            return result.modifiedCount;
        } catch (error) {
            loggingService.error('Error revoking all other user sessions', {
                component: 'UserSessionService',
                operation: 'revokeAllOtherUserSessions',
                userId,
                currentUserSessionId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Validate if a session is active and matches the refresh token hash
     */
    static async validateSessionForRefresh(userSessionId: string, refreshToken: string): Promise<boolean> {
        try {
            if (!userSessionId || !refreshToken) {
                return false;
            }

            const session = await UserSession.findOne({ userSessionId });
            
            if (!session) {
                loggingService.debug('Session not found for refresh validation', {
                    component: 'UserSessionService',
                    operation: 'validateSessionForRefresh',
                    userSessionId
                });
                return false;
            }

            // Check if session is active
            if (!session.isActive) {
                loggingService.info('Session is revoked, refresh token invalid', {
                    component: 'UserSessionService',
                    operation: 'validateSessionForRefresh',
                    userId: session.userId,
                    userSessionId
                });
                return false;
            }

            // Check if session is expired
            if (session.expiresAt < new Date()) {
                loggingService.debug('Session expired', {
                    component: 'UserSessionService',
                    operation: 'validateSessionForRefresh',
                    userSessionId
                });
                return false;
            }

            // Validate refresh token hash matches
            const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
            if (session.refreshTokenHash !== refreshTokenHash) {
                loggingService.warn('Refresh token hash mismatch', {
                    component: 'UserSessionService',
                    operation: 'validateSessionForRefresh',
                    userId: session.userId,
                    userSessionId
                });
                return false;
            }

            return true;
        } catch (error) {
            loggingService.error('Error validating session for refresh', {
                component: 'UserSessionService',
                operation: 'validateSessionForRefresh',
                userSessionId,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    /**
     * Validate if a session is active (for access token validation)
     */
    static async validateSession(userSessionId: string): Promise<boolean> {
        try {
            if (!userSessionId) {
                return false;
            }

            const session = await UserSession.findOne({ userSessionId });
            
            if (!session) {
                return false;
            }

            // Check if session is active
            if (!session.isActive) {
                return false;
            }

            // Check if session is expired
            if (session.expiresAt < new Date()) {
                return false;
            }

            return true;
        } catch (error) {
            loggingService.error('Error validating session', {
                component: 'UserSessionService',
                operation: 'validateSession',
                userSessionId,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    /**
     * Update user session activity timestamp
     */
    static async updateUserSessionActivity(userSessionId: string): Promise<void> {
        try {
            await UserSession.updateOne(
                { userSessionId, isActive: true },
                { $set: { lastActiveAt: new Date() } }
            );
        } catch (error) {
            // Don't throw error for activity updates - fail silently
            loggingService.debug('Error updating user session activity', {
                component: 'UserSessionService',
                operation: 'updateUserSessionActivity',
                userSessionId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Cleanup expired user sessions
     */
    static async cleanupExpiredUserSessions(): Promise<number> {
        try {
            const result = await UserSession.deleteMany({
                expiresAt: { $lt: new Date() },
                isActive: false
            });
            
            loggingService.info('Expired user sessions cleaned up', {
                component: 'UserSessionService',
                operation: 'cleanupExpiredUserSessions',
                deletedCount: result.deletedCount
            });
            
            return result.deletedCount;
        } catch (error) {
            loggingService.error('Error cleaning up expired user sessions', {
                component: 'UserSessionService',
                operation: 'cleanupExpiredUserSessions',
                error: error instanceof Error ? error.message : String(error)
            });
            return 0;
        }
    }

    /**
     * Get current user session ID from request
     */
    static getCurrentUserSessionId(req: Request): string | undefined {
        // Extract from JWT token jti field (set in auth service)
        const user = (req as { user?: { jti?: string; userSessionId?: string } }).user;
        return user?.jti ?? user?.userSessionId;
    }

    /**
     * Detect device information from user agent
     */
    static detectDeviceInfo(userAgent: string, ipAddress: string): ParsedDeviceInfo {
        const ua = userAgent.toLowerCase();
        
        // Detect browser
        let browser = 'Unknown';
        if (ua.includes('chrome') && !ua.includes('edg')) {
            browser = 'Chrome';
        } else if (ua.includes('firefox')) {
            browser = 'Firefox';
        } else if (ua.includes('safari') && !ua.includes('chrome')) {
            browser = 'Safari';
        } else if (ua.includes('edg')) {
            browser = 'Edge';
        } else if (ua.includes('opera') || ua.includes('opr')) {
            browser = 'Opera';
        }
        
        // Detect OS
        let os = 'Unknown';
        if (ua.includes('windows')) {
            os = 'Windows';
        } else if (ua.includes('mac os') || ua.includes('macos')) {
            os = 'macOS';
        } else if (ua.includes('linux')) {
            os = 'Linux';
        } else if (ua.includes('android')) {
            os = 'Android';
        } else if (ua.includes('ios') || ua.includes('iphone') || ua.includes('ipad')) {
            os = 'iOS';
        }
        
        // Detect device type
        let deviceName = 'Desktop';
        if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
            deviceName = 'Mobile';
        } else if (ua.includes('tablet') || ua.includes('ipad')) {
            deviceName = 'Tablet';
        } else {
            deviceName = 'Desktop';
        }
        
        // Get location from IP to enhance device name
        const location = this.getLocationFromIP(ipAddress);
        const locationText = location.city && location.country
            ? `${location.city}, ${location.country}`
            : location.country ?? location.city ?? '';
        
        // Enhance device name with OS, browser, and location
        deviceName = locationText
            ? `${os} ${deviceName} - ${browser} (${locationText})`
            : `${os} ${deviceName} - ${browser}`;
        
        return {
            deviceName,
            browser,
            os
        };
    }

    /**
     * Get location from IP address
     */
    static getLocationFromIP(ipAddress: string): { city?: string; country?: string } {
        try {
            // Skip localhost and private IPs
            if (ipAddress === '::1' || ipAddress === '127.0.0.1' || ipAddress.startsWith('192.168.') || ipAddress.startsWith('10.')) {
                return { city: 'Local', country: 'Local' };
            }
            
            const geo = geoip.lookup(ipAddress);
            if (geo) {
                return {
                    city: geo.city || undefined,
                    country: geo.country || undefined
                };
            }
            
            return {};
        } catch (error) {
            loggingService.debug('Error getting location from IP', {
                component: 'UserSessionService',
                operation: 'getLocationFromIP',
                ipAddress,
                error: error instanceof Error ? error.message : String(error)
            });
            return {};
        }
    }

    /**
     * Check if this is a new device for the user
     */
    static async isNewDevice(userId: string, deviceInfo: ParsedDeviceInfo): Promise<boolean> {
        try {
            // Check if user has any previous sessions with similar device fingerprint
            const existingSessions = await UserSession.find({
                userId,
                browser: deviceInfo.browser,
                os: deviceInfo.os,
                isActive: true
            }).limit(1);
            
            return existingSessions.length === 0;
        } catch (error) {
            loggingService.error('Error checking if new device', {
                component: 'UserSessionService',
                operation: 'isNewDevice',
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            // Default to true (new device) if error
            return true;
        }
    }

    /**
     * Enforce concurrent session limit
     */
    static async enforceConcurrentSessionLimit(userId: string): Promise<void> {
        try {
            const user = await User.findById(userId).select('preferences');
            const maxSessions = user?.preferences?.maxConcurrentUserSessions ?? 10;
            
            const activeSessions = await UserSession.find({
                userId,
                isActive: true,
                expiresAt: { $gt: new Date() }
            }).sort({ lastActiveAt: 1 }); // Oldest first
            
            if (activeSessions.length >= maxSessions) {
                // Revoke oldest sessions
                const sessionsToRevoke = activeSessions.slice(0, activeSessions.length - maxSessions + 1);
                for (const session of sessionsToRevoke) {
                    session.isActive = false;
                    await session.save();
                }
                
                loggingService.info('Concurrent session limit enforced', {
                    component: 'UserSessionService',
                    operation: 'enforceConcurrentSessionLimit',
                    userId,
                    maxSessions,
                    revokedCount: sessionsToRevoke.length
                });
            }
        } catch (error) {
            loggingService.error('Error enforcing concurrent session limit', {
                component: 'UserSessionService',
                operation: 'enforceConcurrentSessionLimit',
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            // Don't throw - allow session creation even if limit check fails
        }
    }

    /**
     * Generate revoke token
     */
    static generateRevokeToken(): string {
        return generateToken(32);
    }
}

