import { Router, Request, Response, NextFunction } from 'express';
import { loggingService } from '../services/logging.service';
import { IncrementalIndexService } from '../services/incrementalIndex.service';
import { GitHubConnection } from '../models';
import * as crypto from 'crypto';

const router = Router();

/**
 * Verify GitHub webhook signature
 */
function verifySignature(payload: string, signature: string, secret: string): boolean {
    if (!signature || !secret) {
        return false;
    }

    const hmac = crypto.createHmac('sha256', secret);
    const digest = 'sha256=' + hmac.update(payload).digest('hex');
    
    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(digest)
    );
}

/**
 * POST /api/github/webhooks
 * Handle GitHub webhook events
 */
router.post('/webhooks', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const signature = req.headers['x-hub-signature-256'] as string;
        const event = req.headers['x-github-event'] as string;
        const deliveryId = req.headers['x-github-delivery'] as string;

        // Verify webhook signature
        const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
        if (webhookSecret) {
            const rawBody = JSON.stringify(req.body);
            if (!verifySignature(rawBody, signature, webhookSecret)) {
                loggingService.warn('Invalid webhook signature', {
                    component: 'GitHubWebhooks',
                    deliveryId
                });
                res.status(401).json({ error: 'Invalid signature' });
                return;
            }
        }

        loggingService.info('GitHub webhook received', {
            component: 'GitHubWebhooks',
            event,
            deliveryId
        });

        // Handle push events (for incremental indexing)
        if (event === 'push') {
            await handlePushEvent(req.body);
        }

        // Acknowledge webhook
        res.status(200).json({ received: true });
    } catch (error) {
        loggingService.error('Webhook processing failed', {
            component: 'GitHubWebhooks',
            error: error instanceof Error ? error.message : 'Unknown'
        });
        next(error);
    }
});

/**
 * Handle GitHub push event
 */
async function handlePushEvent(payload: any): Promise<void> {
    try {
        const repository = payload.repository;
        const commits = payload.commits || [];
        const ref = payload.ref;
        const branch = ref.replace('refs/heads/', '');

        if (!repository || commits.length === 0) {
            loggingService.info('Push event has no commits, skipping', {
                component: 'GitHubWebhooks'
            });
            return;
        }

        const repoFullName = repository.full_name;
        const latestCommit = commits[commits.length - 1];
        const commitSha = latestCommit.id;

        // Get list of changed files
        const changedFiles: string[] = [];
        for (const commit of commits) {
            changedFiles.push(...(commit.added || []));
            changedFiles.push(...(commit.modified || []));
            // Note: deleted files are handled by deprecating chunks
        }

        if (changedFiles.length === 0) {
            loggingService.info('No changed files in push event', {
                component: 'GitHubWebhooks',
                repoFullName
            });
            return;
        }

        // Find GitHub connection for this repository
        // Note: This assumes we have a way to map repository to user
        // In production, you'd want to store this mapping
        const connections = await GitHubConnection.find({
            'repositories.fullName': repoFullName,
            isActive: true
        });

        if (connections.length === 0) {
            loggingService.warn('No active connection found for repository', {
                component: 'GitHubWebhooks',
                repoFullName
            });
            return;
        }

        // Process indexing for each connection (multi-user repos)
        for (const connection of connections) {
            const userId = connection.userId.toString();
            
            try {
                const decryptToken = connection.decryptToken.bind(connection);
                
                const result = await IncrementalIndexService.indexChangedFiles(
                    { ...connection.toObject(), decryptToken } as any,
                    {
                        repoFullName,
                        commitSha,
                        branch,
                        changedFiles: Array.from(new Set(changedFiles)), // Deduplicate
                        userId,
                        organizationId: undefined // Could be extracted from connection
                    }
                );

                loggingService.info('Incremental indexing completed', {
                    component: 'GitHubWebhooks',
                    repoFullName,
                    userId,
                    filesIndexed: result.filesIndexed,
                    chunksCreated: result.totalChunksCreated
                });
            } catch (error) {
                loggingService.error('Incremental indexing failed for connection', {
                    component: 'GitHubWebhooks',
                    repoFullName,
                    userId,
                    error: error instanceof Error ? error.message : 'Unknown'
                });
                // Continue with other connections
            }
        }
    } catch (error) {
        loggingService.error('Push event handling failed', {
            component: 'GitHubWebhooks',
            error: error instanceof Error ? error.message : 'Unknown'
        });
        throw error;
    }
}

export default router;

