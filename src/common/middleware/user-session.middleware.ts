import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserSession } from '../../schemas/user/user-session.schema';

@Injectable()
export class UserSessionMiddleware implements NestMiddleware {
  private readonly logger = new Logger(UserSessionMiddleware.name);

  constructor(
    @InjectModel(UserSession.name) private userSessionModel: Model<UserSession>,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const requestId = (req as any).requestId || 'unknown';
    const user = (req as any).user;

    try {
      // Only track sessions for authenticated users
      if (!user || !user.id) {
        this.logger.debug('No authenticated user, skipping session tracking', {
          component: 'UserSessionMiddleware',
          operation: 'use',
          type: 'session_skip',
          requestId,
          hasUser: !!user,
        });
        return next();
      }

      this.logger.log('User session tracking initiated', {
        component: 'UserSessionMiddleware',
        operation: 'use',
        type: 'session_tracking',
        requestId,
        userId: user.id,
        method: req.method,
        url: req.originalUrl,
      });

      const sessionId = user.sessionId;
      if (sessionId) {
        // Update session last activity
        const updateResult = await this.userSessionModel.findByIdAndUpdate(
          sessionId,
          {
            lastActiveAt: new Date(),
          },
          { new: true },
        );

        if (updateResult) {
          this.logger.debug('User session updated', {
            component: 'UserSessionMiddleware',
            operation: 'use',
            type: 'session_updated',
            requestId,
            userId: user.id,
            sessionId,
            lastActiveAt: updateResult.lastActiveAt,
          });
        } else {
          this.logger.warn(
            'Failed to update user session - session not found',
            {
              component: 'UserSessionMiddleware',
              operation: 'use',
              type: 'session_update_failed',
              requestId,
              userId: user.id,
              sessionId,
            },
          );
        }
      } else {
        this.logger.debug('No session ID in user context', {
          component: 'UserSessionMiddleware',
          operation: 'use',
          type: 'session_no_id',
          requestId,
          userId: user.id,
        });
      }

      // Add session info to request for downstream use
      (req as any).sessionInfo = {
        userId: user.id,
        sessionId: sessionId,
        lastActivityAt: new Date(),
        ip: req.ip,
        userAgent: req.get('User-Agent'),
      };

      this.logger.log('User session tracking completed', {
        component: 'UserSessionMiddleware',
        operation: 'use',
        type: 'session_tracking_completed',
        requestId,
        userId: user.id,
        duration: `${Date.now() - startTime}ms`,
      });

      next();
    } catch (error) {
      this.logger.error('User session middleware error', {
        component: 'UserSessionMiddleware',
        operation: 'use',
        type: 'session_error',
        requestId,
        userId: user?.id,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: `${Date.now() - startTime}ms`,
      });

      // Don't fail the request due to session tracking errors
      next();
    }
  }
}
