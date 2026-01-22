import { Response, Request } from 'express';
import { UserSessionService } from '../services/userSession.service';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class UserSessionController {
    /**
     * Get all active user sessions
     */
    static async getActiveUserSessions(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const currentUserSessionId = UserSessionService.getCurrentUserSessionId(req);
        ControllerHelper.logRequestStart('getActiveUserSessions', req);

        try {
            const sessions = await UserSessionService.getActiveUserSessions(userId, currentUserSessionId);

            ControllerHelper.logRequestSuccess('getActiveUserSessions', req, startTime, {
                sessionCount: sessions.length
            });

            res.json({
                success: true,
                data: sessions
            });
        } catch (error: unknown) {
            ControllerHelper.handleError('getActiveUserSessions', error, req, res, startTime);
        }
    }

    /**
     * Revoke a specific user session
     */
    static async revokeUserSession(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { userSessionId } = req.params;
        const currentUserSessionId = UserSessionService.getCurrentUserSessionId(req);
        ControllerHelper.logRequestStart('revokeUserSession', req);

        try {
            // Prevent revoking current session
            if (userSessionId === currentUserSessionId) {
                res.status(400).json({
                    success: false,
                    message: 'Cannot revoke current session'
                });
                return;
            }

            await UserSessionService.revokeUserSession(userId, userSessionId);

            ControllerHelper.logRequestSuccess('revokeUserSession', req, startTime, {
                userSessionId
            });

            res.json({
                success: true,
                message: 'Session revoked successfully'
            });
        } catch (error: unknown) {
            if (error instanceof Error && error.message === 'Session not found or already revoked') {
                res.status(404).json({
                    success: false,
                    message: error.message
                });
                return;
            }
            ControllerHelper.handleError('revokeUserSession', error, req, res, startTime);
        }
    }

    /**
     * Revoke all other user sessions except current
     */
    static async revokeAllOtherUserSessions(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const currentUserSessionId = UserSessionService.getCurrentUserSessionId(req);
        ControllerHelper.logRequestStart('revokeAllOtherUserSessions', req);

        try {
            if (!currentUserSessionId) {
                res.status(400).json({
                    success: false,
                    message: 'Current session not found'
                });
                return;
            }

            const revokedCount = await UserSessionService.revokeAllOtherUserSessions(userId, currentUserSessionId);

            ControllerHelper.logRequestSuccess('revokeAllOtherUserSessions', req, startTime, {
                revokedCount,
                currentUserSessionId
            });

            res.json({
                success: true,
                message: `${revokedCount} session(s) revoked successfully`,
                data: { revokedCount }
            });
        } catch (error: unknown) {
            ControllerHelper.handleError('revokeAllOtherUserSessions', error, req, res, startTime);
        }
    }

    /**
     * Revoke user session from email link (public endpoint)
     */
    static async revokeUserSessionFromEmail(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { userSessionId, revokeToken } = req.params;
        ControllerHelper.logRequestStart('revokeUserSessionFromEmail', req);

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

            ControllerHelper.logRequestSuccess('revokeUserSessionFromEmail', req, startTime, {
                userId: result.userId,
                userSessionId: result.userSessionId
            });

            // Redirect to frontend with success message
            const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
            res.redirect(`${frontendUrl}/settings/security?sessionRevoked=true`);
        } catch (error: unknown) {
            const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
            if (error instanceof Error && (error.message.includes('Invalid') || error.message.includes('expired'))) {
                res.redirect(`${frontendUrl}/settings/security?sessionRevoked=false&error=invalid_token`);
                return;
            }

            ControllerHelper.handleError('revokeUserSessionFromEmail', error, req, res, startTime);
            res.redirect(`${frontendUrl}/settings/security?sessionRevoked=false&error=server_error`);
        }
    }
}

