import { Response, Request } from 'express';
import { UserSessionService } from '../services/userSession.service';
import { loggingService } from '../services/logging.service';

export class UserSessionController {
    /**
     * Get all active user sessions
     */
    static async getActiveUserSessions(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = (req as { user?: { id: string } }).user?.id;
        const currentUserSessionId = UserSessionService.getCurrentUserSessionId(req);

        try {
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
                return;
            }

            const sessions = await UserSessionService.getActiveUserSessions(userId, currentUserSessionId);

            const duration = Date.now() - startTime;
            loggingService.info('Active user sessions retrieved', {
                component: 'UserSessionController',
                operation: 'getActiveUserSessions',
                userId,
                sessionCount: sessions.length,
                duration
            });

            res.json({
                success: true,
                data: sessions
            });
        } catch (error: unknown) {
            const duration = Date.now() - startTime;
            loggingService.error('Error getting active user sessions', {
                component: 'UserSessionController',
                operation: 'getActiveUserSessions',
                userId,
                error: error instanceof Error ? error.message : String(error),
                duration
            });

            res.status(500).json({
                success: false,
                message: 'Failed to retrieve user sessions'
            });
        }
    }

    /**
     * Revoke a specific user session
     */
    static async revokeUserSession(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = (req as { user?: { id: string } }).user?.id;
        const { userSessionId } = req.params;
        const currentUserSessionId = UserSessionService.getCurrentUserSessionId(req);

        try {
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
                return;
            }

            // Prevent revoking current session
            if (userSessionId === currentUserSessionId) {
                res.status(400).json({
                    success: false,
                    message: 'Cannot revoke current session'
                });
                return;
            }

            await UserSessionService.revokeUserSession(userId, userSessionId);

            const duration = Date.now() - startTime;
            loggingService.info('User session revoked', {
                component: 'UserSessionController',
                operation: 'revokeUserSession',
                userId,
                userSessionId,
                duration
            });

            res.json({
                success: true,
                message: 'Session revoked successfully'
            });
        } catch (error: unknown) {
            const duration = Date.now() - startTime;
            loggingService.error('Error revoking user session', {
                component: 'UserSessionController',
                operation: 'revokeUserSession',
                userId,
                userSessionId,
                error: error instanceof Error ? error.message : String(error),
                duration
            });

            if (error instanceof Error && error.message === 'Session not found or already revoked') {
                res.status(404).json({
                    success: false,
                    message: error.message
                });
                return;
            }

            res.status(500).json({
                success: false,
                message: 'Failed to revoke session'
            });
        }
    }

    /**
     * Revoke all other user sessions except current
     */
    static async revokeAllOtherUserSessions(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = (req as { user?: { id: string } }).user?.id;
        const currentUserSessionId = UserSessionService.getCurrentUserSessionId(req);

        try {
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
                return;
            }

            if (!currentUserSessionId) {
                res.status(400).json({
                    success: false,
                    message: 'Current session not found'
                });
                return;
            }

            const revokedCount = await UserSessionService.revokeAllOtherUserSessions(userId, currentUserSessionId);

            const duration = Date.now() - startTime;
            loggingService.info('All other user sessions revoked', {
                component: 'UserSessionController',
                operation: 'revokeAllOtherUserSessions',
                userId,
                currentUserSessionId,
                revokedCount,
                duration
            });

            res.json({
                success: true,
                message: `${revokedCount} session(s) revoked successfully`,
                data: { revokedCount }
            });
        } catch (error: unknown) {
            const duration = Date.now() - startTime;
            loggingService.error('Error revoking all other user sessions', {
                component: 'UserSessionController',
                operation: 'revokeAllOtherUserSessions',
                userId,
                error: error instanceof Error ? error.message : String(error),
                duration
            });

            res.status(500).json({
                success: false,
                message: 'Failed to revoke sessions'
            });
        }
    }

    /**
     * Revoke user session from email link (public endpoint)
     */
    static async revokeUserSessionFromEmail(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        const { userSessionId, revokeToken } = req.params;

        try {
            if (!revokeToken || !userSessionId) {
                res.status(400).json({
                    success: false,
                    message: 'User session ID and revoke token are required'
                });
                return;
            }

            const result = await UserSessionService.revokeUserSessionByToken(revokeToken);

            // Verify that the userSessionId matches
            if (result.userSessionId !== userSessionId) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid user session ID'
                });
                return;
            }

            const duration = Date.now() - startTime;
            loggingService.info('User session revoked via email token', {
                component: 'UserSessionController',
                operation: 'revokeUserSessionFromEmail',
                userId: result.userId,
                userSessionId: result.userSessionId,
                duration
            });

            // Redirect to frontend with success message
            const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
            res.redirect(`${frontendUrl}/settings/security?sessionRevoked=true`);
        } catch (error: unknown) {
            const duration = Date.now() - startTime;
            loggingService.error('Error revoking user session from email', {
                component: 'UserSessionController',
                operation: 'revokeUserSessionFromEmail',
                userSessionId,
                revokeToken,
                error: error instanceof Error ? error.message : String(error),
                duration
            });

            const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
            if (error instanceof Error && (error.message.includes('Invalid') || error.message.includes('expired'))) {
                res.redirect(`${frontendUrl}/settings/security?sessionRevoked=false&error=invalid_token`);
                return;
            }

            res.redirect(`${frontendUrl}/settings/security?sessionRevoked=false&error=server_error`);
        }
    }
}

