import { GoogleWorkflow, IGoogleWorkflow, IGoogleWorkflowExecution } from '../models/GoogleWorkflow';
import { GoogleConnection } from '../models/GoogleConnection';
import { GoogleTriggersService } from './automation/triggers/googleTriggers.service';
import { GoogleActionsService } from './automation/actions/googleActions.service';
import { loggingService } from './logging.service';
import mongoose from 'mongoose';

export class GoogleWorkflowExecutorService {
    private static activePollers: Map<string, NodeJS.Timeout> = new Map();

    /**
     * Execute a workflow
     */
    static async executeWorkflow(workflowId: string, triggeredBy?: string): Promise<IGoogleWorkflowExecution> {
        const startTime = Date.now();
        let status: 'success' | 'failure' | 'partial' = 'success';
        let error: string | undefined;

        try {
            const workflow = await GoogleWorkflow.findOne({ workflowId, isActive: true });

            if (!workflow) {
                throw new Error('Workflow not found or inactive');
            }

            loggingService.info('Executing workflow', {
                workflowId,
                workflowName: workflow.name,
                triggeredBy
            });

            // Get Google connection
            const connection = await GoogleConnection.findOne({
                userId: workflow.userId,
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                throw new Error('No active Google connection found');
            }

            // Execute actions in order
            const actionResults: any[] = [];
            for (const action of workflow.actions.sort((a, b) => a.order - b.order)) {
                try {
                    const result = await this.executeAction(action, connection);
                    actionResults.push({ action: action.type, success: true, result });
                } catch (actionError: any) {
                    loggingService.error('Action execution failed', {
                        workflowId,
                        actionType: action.type,
                        error: actionError.message
                    });
                    actionResults.push({ action: action.type, success: false, error: actionError.message });
                    status = 'partial';
                }
            }

            const duration = Date.now() - startTime;

            // Create execution record
            const execution: IGoogleWorkflowExecution = {
                timestamp: new Date(),
                status,
                duration,
                error,
                triggeredBy
            };

            // Update workflow with execution history
            workflow.lastExecution = execution;
            workflow.executionHistory.unshift(execution);

            // Keep only last 100 executions
            if (workflow.executionHistory.length > 100) {
                workflow.executionHistory = workflow.executionHistory.slice(0, 100);
            }

            await workflow.save();

            loggingService.info('Workflow execution completed', {
                workflowId,
                status,
                duration: `${duration}ms`,
                actionsExecuted: actionResults.length
            });

            return execution;
        } catch (err: any) {
            const duration = Date.now() - startTime;
            error = err.message;
            status = 'failure';

            loggingService.error('Workflow execution failed', {
                workflowId,
                error: err.message,
                duration: `${duration}ms`
            });

            return {
                timestamp: new Date(),
                status,
                duration,
                error,
                triggeredBy
            };
        }
    }

    /**
     * Execute a single action
     */
    private static async executeAction(action: any, connection: any): Promise<any> {
        const connectionId = connection._id.toString();
        const config = action.config;

        switch (action.type) {
            case 'send_email':
                return await GoogleActionsService.sendEmail(
                    connectionId,
                    config.to,
                    config.subject,
                    config.body,
                    config.isHtml || false
                );

            case 'create_calendar_event':
                return await GoogleActionsService.createCalendarEvent(
                    connectionId,
                    config.summary,
                    new Date(config.startTime),
                    new Date(config.endTime),
                    config.description || '',
                    config.attendees || []
                );

            case 'export_to_sheets':
                return await GoogleActionsService.exportToSheets(
                    connectionId,
                    config.userId || connection.userId.toString(),
                    config.title || 'Cost Data Export',
                    config.data || []
                );

            case 'create_doc':
                return await GoogleActionsService.createDocReport(
                    connectionId,
                    config.userId || connection.userId.toString(),
                    config.title || 'Cost Report',
                    config.data || {}
                );

            case 'upload_to_drive':
                return await GoogleActionsService.uploadToDrive(
                    connectionId,
                    config.fileName,
                    config.fileContent,
                    config.mimeType || 'text/plain',
                    config.folderId
                );

            case 'share_file':
                return await GoogleActionsService.shareFile(
                    connectionId,
                    config.fileId,
                    config.email,
                    config.role || 'reader'
                );

            default:
                throw new Error(`Unknown action type: ${action.type}`);
        }
    }

    /**
     * Start polling for trigger events
     */
    static async startPolling(workflowId: string): Promise<void> {
        const workflow = await GoogleWorkflow.findOne({ workflowId, isActive: true });

        if (!workflow) {
            throw new Error('Workflow not found or inactive');
        }

        if (this.activePollers.has(workflowId)) {
            loggingService.warn('Workflow already being polled', { workflowId });
            return;
        }

        const pollInterval = workflow.trigger.config.pollInterval || 15; // default 15 minutes

        const poller = setInterval(async () => {
            try {
                const shouldTrigger = await this.checkTrigger(workflow);

                if (shouldTrigger) {
                    await this.executeWorkflow(workflowId, 'automated_trigger');
                }
            } catch (error: any) {
                loggingService.error('Trigger check failed', {
                    workflowId,
                    error: error.message
                });
            }
        }, pollInterval * 60 * 1000); // Convert minutes to milliseconds

        this.activePollers.set(workflowId, poller);

        loggingService.info('Started polling for workflow', {
            workflowId,
            pollInterval: `${pollInterval} minutes`
        });
    }

    /**
     * Stop polling for a workflow
     */
    static stopPolling(workflowId: string): void {
        const poller = this.activePollers.get(workflowId);

        if (poller) {
            clearInterval(poller);
            this.activePollers.delete(workflowId);
            loggingService.info('Stopped polling for workflow', { workflowId });
        }
    }

    /**
     * Check if workflow trigger conditions are met
     */
    private static async checkTrigger(workflow: IGoogleWorkflow): Promise<boolean> {
        try {
            const connection = await GoogleConnection.findOne({
                userId: workflow.userId,
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                return false;
            }

            const connectionId = connection._id.toString();
            const config = workflow.trigger.config;

            switch (workflow.trigger.type) {
                case 'sheet_change': {
                    if (!config.resourceId) {
                        loggingService.warn('Sheet change trigger missing resourceId', { workflowId: workflow.workflowId });
                        return false;
                    }
                    const result = await GoogleTriggersService.checkSheetChange(
                        connectionId,
                        config.resourceId,
                        'A1:Z1000', // Default range
                        (config as any).lastCheckValue
                    );
                    return result.triggered;
                }

                case 'calendar_event': {
                    const eventKeywords = (config as any).eventKeywords 
                        ? (Array.isArray((config as any).eventKeywords) 
                            ? (config as any).eventKeywords 
                            : [(config as any).eventKeywords])
                        : (config as any).eventNamePattern
                        ? [(config as any).eventNamePattern]
                        : [];
                    const result = await GoogleTriggersService.checkCalendarEvent(
                        connectionId,
                        eventKeywords,
                        (config as any).startDate ? new Date((config as any).startDate) : undefined,
                        (config as any).endDate ? new Date((config as any).endDate) : undefined
                    );
                    return result.triggered;
                }

                case 'gmail_alert': {
                    const lastCheckTime = (config as any).lastCheckTime 
                        ? new Date((config as any).lastCheckTime)
                        : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: 24 hours ago
                    const result = await GoogleTriggersService.checkGmailAlert(
                        connectionId,
                        (config as any).query || 'is:unread',
                        lastCheckTime
                    );
                    return result.triggered;
                }

                case 'drive_file_change': {
                    if (!config.resourceId) {
                        loggingService.warn('Drive file change trigger missing resourceId', { workflowId: workflow.workflowId });
                        return false;
                    }
                    const result = await GoogleTriggersService.checkDriveFileChange(
                        connectionId,
                        config.resourceId,
                        (config as any).lastCheckValue
                    );
                    return result.triggered;
                }

                default:
                    loggingService.warn('Unknown trigger type', { triggerType: workflow.trigger.type });
                    return false;
            }
        } catch (error: any) {
            loggingService.error('Trigger check error', {
                workflowId: workflow.workflowId,
                error: error.message
            });
            return false;
        }
    }

    /**
     * Initialize all active workflows (call this when server starts)
     */
    static async initializeActiveWorkflows(): Promise<void> {
        try {
            const activeWorkflows = await GoogleWorkflow.find({ isActive: true });

            loggingService.info('Initializing active workflows', {
                count: activeWorkflows.length
            });

            for (const workflow of activeWorkflows) {
                if (workflow.trigger.config.pollInterval) {
                    await this.startPolling(workflow.workflowId);
                }
            }

            loggingService.info('Active workflows initialized successfully');
        } catch (error: any) {
            loggingService.error('Failed to initialize active workflows', {
                error: error.message
            });
        }
    }

    /**
     * Stop all active pollers (call this when server shuts down)
     */
    static stopAllPolling(): void {
        for (const workflowId of this.activePollers.keys()) {
            this.stopPolling(workflowId);
        }
        loggingService.info('All workflow polling stopped');
    }

    /**
     * Get workflow execution statistics
     */
    static async getWorkflowStats(workflowId: string): Promise<any> {
        const workflow = await GoogleWorkflow.findOne({ workflowId });

        if (!workflow) {
            throw new Error('Workflow not found');
        }

        const totalExecutions = workflow.executionHistory.length;
        const successfulExecutions = workflow.executionHistory.filter(e => e.status === 'success').length;
        const failedExecutions = workflow.executionHistory.filter(e => e.status === 'failure').length;
        const partialExecutions = workflow.executionHistory.filter(e => e.status === 'partial').length;

        const avgDuration = workflow.executionHistory.length > 0
            ? workflow.executionHistory.reduce((sum, e) => sum + e.duration, 0) / workflow.executionHistory.length
            : 0;

        return {
            workflowId,
            name: workflow.name,
            isActive: workflow.isActive,
            totalExecutions,
            successfulExecutions,
            failedExecutions,
            partialExecutions,
            successRate: totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0,
            avgDuration: `${avgDuration.toFixed(2)}ms`,
            lastExecution: workflow.lastExecution
        };
    }
}

