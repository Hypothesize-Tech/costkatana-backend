import { loggingService } from './logging.service';
import { GitHubCodeChunkModel } from '../models/GitHubCodeChunk';
import { GitHubConnection } from '../models';
import { permissionService } from './permission.service';
import { User } from '../models';

export interface AccessControlOptions {
    userId: string;
    repoFullName?: string;
    organizationId?: string;
    requireAdmin?: boolean;
}

/**
 * Integration access control service
 * Enforces repo-level ACLs and role-based access
 */
export class IntegrationAccessControlService {
    /**
     * Check if user has access to repository
     */
    static async checkRepositoryAccess(
        userId: string,
        repoFullName: string
    ): Promise<boolean> {
        try {
            // Check if user has any chunks indexed for this repo
            const chunkCount = await GitHubCodeChunkModel.countDocuments({
                userId,
                repoFullName,
                status: 'active'
            });

            // If user has indexed chunks, they have access
            // In production, you'd want more sophisticated ACL checking
            return chunkCount > 0;
        } catch (error) {
            loggingService.error('Access check failed', {
                component: 'IntegrationAccessControlService',
                userId,
                repoFullName,
                error: error instanceof Error ? error.message : 'Unknown'
            });
            return false;
        }
    }

    /**
     * Apply access control filters to queries
     */
    static applyAccessFilters(
        filters: Record<string, unknown>,
        options: AccessControlOptions
    ): Record<string, unknown> {
        const accessFilters: Record<string, unknown> = {
            ...filters,
            userId: options.userId
        };

        if (options.repoFullName) {
            accessFilters.repoFullName = options.repoFullName;
        }

        if (options.organizationId) {
            accessFilters.organizationId = options.organizationId;
        }

        return accessFilters;
    }

    /**
     * Check if user can auto-apply changes
     */
    static async canAutoApply(
        userId: string,
        repoFullName: string,
        riskLevel: 'low' | 'medium' | 'high'
    ): Promise<boolean> {
        try {
            // High risk always requires approval
            if (riskLevel === 'high') {
                return false;
            }

            // Check if user owns the repository (via GitHubConnection)
            const connections = await GitHubConnection.find({
                userId,
                isActive: true,
                'repositories.fullName': repoFullName
            });

            if (connections.length === 0) {
                // User doesn't have access to this repository
                loggingService.warn('User does not have repository access for auto-apply', {
                    component: 'IntegrationAccessControlService',
                    userId,
                    repoFullName
                });
                return false;
            }

            // Check user role in workspace (if applicable)
            try {
                const user = await User.findById(userId).select('workspaceId role').lean();
                if (user?.workspaceId) {
                    // Convert ObjectId to string safely
                    const workspaceIdStr = String(user.workspaceId);
                    const userRole = await permissionService.getUserRole(userId, workspaceIdStr);
                    
                    // Only admins and owners can auto-apply
                    if (userRole && ['owner', 'admin'].includes(userRole)) {
                        // Admins/owners can auto-apply low/medium risk changes
                        return riskLevel === 'low' || riskLevel === 'medium';
                    }
                    
                    // Developers can only auto-apply low risk changes
                    if (userRole === 'developer') {
                        return riskLevel === 'low';
                    }
                    
                    // Viewers cannot auto-apply
                    return false;
                }
            } catch (error) {
                loggingService.warn('Failed to check user role, defaulting to conservative policy', {
                    component: 'IntegrationAccessControlService',
                    userId,
                    error: error instanceof Error ? error.message : 'Unknown'
                });
            }

            // If user has repository connection, allow auto-apply for low risk only
            // (conservative default when role checking fails)
            return riskLevel === 'low';
        } catch (error) {
            loggingService.error('Auto-apply check failed', {
                component: 'IntegrationAccessControlService',
                userId,
                repoFullName,
                error: error instanceof Error ? error.message : 'Unknown'
            });
            // Fail-safe: don't allow auto-apply on error
            return false;
        }
    }

    /**
     * Check if operation requires admin approval
     */
    static requiresAdminApproval(
        operation: string,
        options: AccessControlOptions
    ): boolean {
        const adminOperations = [
            'delete_repository',
            'purge_index',
            'change_settings',
            'auto_apply_high_risk'
        ];

        return adminOperations.includes(operation) || (options.requireAdmin === true);
    }
}

