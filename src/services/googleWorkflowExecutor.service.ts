/**
 * Google Workflow Executor - PARTIALLY DISABLED
 * Gmail and Calendar triggers/actions removed
 */

import { loggingService } from './logging.service';

export class GoogleWorkflowExecutorService {
    static async executeWorkflow(_workflow: any, _trigger: any) {
        loggingService.warn('Workflow execution partially disabled - Gmail/Calendar features removed');
        return { success: false, error: 'Gmail/Calendar workflow features disabled' };
    }
}

export default GoogleWorkflowExecutorService;
