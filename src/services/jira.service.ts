import axios, { AxiosInstance } from 'axios';
import { IAlert } from '../models/Alert';
import { loggingService } from './logging.service';
import { formatCurrency } from '../utils/helpers';

export interface JiraProject {
    id: string;
    key: string;
    name: string;
    projectTypeKey: string;
    simplified?: boolean;
    avatarUrls?: {
        '48x48': string;
        '24x24': string;
        '16x16': string;
        '32x32': string;
    };
}

export interface JiraIssueType {
    id: string;
    name: string;
    description?: string;
    iconUrl?: string;
    subtask: boolean;
}

export interface JiraPriority {
    id: string;
    name: string;
    iconUrl?: string;
}

export interface JiraComponent {
    id: string;
    name: string;
    description?: string;
}

export interface JiraIssue {
    id: string;
    key: string;
    self: string;
    fields: {
        summary: string;
        description?: string;
        status: {
            id: string;
            name: string;
            statusCategory: {
                id: number;
                key: string;
                name: string;
            };
        };
        priority?: JiraPriority;
        project: JiraProject;
        issuetype: JiraIssueType;
    };
}

export interface JiraComment {
    id: string;
    body: string;
    created: string;
    author: {
        accountId: string;
        displayName: string;
    };
}

export interface JiraOAuthTokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token?: string;
    scope: string;
}

export interface JiraUser {
    accountId: string;
    accountType: string;
    displayName: string;
    emailAddress?: string;
    active: boolean;
}

export interface JiraCreateIssueRequest {
    fields: {
        project: {
            key: string;
        };
        summary: string;
        description?: string | {
            type: string;
            version: number;
            content: any[];
        };
        issuetype: {
            id: string;
        };
        priority?: {
            id: string;
        };
        labels?: string[];
        components?: Array<{ id: string }>;
    };
}

export class JiraService {
    /**
     * Create a REST API client for JIRA
     * Supports both OAuth 2.0 (with cloudId) and API token (with siteUrl)
     */
    private static createClient(siteUrlOrCloudId: string, accessToken: string, useCloudId: boolean = false): AxiosInstance {
        let baseURL: string;
        
        if (useCloudId) {
            // For JIRA Cloud OAuth 2.0, use the cloud ID API endpoint
            baseURL = `https://api.atlassian.com/ex/jira/${siteUrlOrCloudId}/rest/api/3`;
        } else {
            // For API token authentication, use the site URL directly
            const baseUrl = siteUrlOrCloudId.endsWith('/') ? siteUrlOrCloudId.slice(0, -1) : siteUrlOrCloudId;
            baseURL = `${baseUrl}/rest/api/3`;
        }
        
        return axios.create({
            baseURL,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 30000
        });
    }

    /**
     * Exchange OAuth authorization code for access token
     */
    static async exchangeCodeForToken(
        code: string,
        clientId: string,
        clientSecret: string,
        redirectUri: string
    ): Promise<JiraOAuthTokenResponse> {
        const startTime = Date.now();
        
        try {
            // JIRA OAuth 2.0 token endpoint
            const response = await axios.post(
                'https://auth.atlassian.com/oauth/token',
                {
                    grant_type: 'authorization_code',
                    client_id: clientId,
                    client_secret: clientSecret,
                    code: code,
                    redirect_uri: redirectUri
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            const responseTime = Date.now() - startTime;
            loggingService.info('JIRA OAuth token exchange successful', { responseTime });

            return response.data;
        } catch (error: any) {
            const responseTime = Date.now() - startTime;
            loggingService.error('Failed to exchange JIRA OAuth code for token', {
                error: error.message,
                responseTime,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            });
            throw error;
        }
    }

    /**
     * Get authenticated user information
     * Supports both OAuth 2.0 (with cloudId) and API token (with siteUrl)
     */
    static async getAuthenticatedUser(siteUrlOrCloudId: string, accessToken: string, useCloudId: boolean = false): Promise<JiraUser> {
        try {
            const client = this.createClient(siteUrlOrCloudId, accessToken, useCloudId);
            const response = await client.get('/myself');
            return response.data;
        } catch (error: any) {
            loggingService.error('Failed to get JIRA authenticated user', { 
                error: error.message,
                siteUrlOrCloudId,
                useCloudId,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            });
            throw error;
        }
    }

    /**
     * List accessible projects
     * Supports both OAuth 2.0 (with cloudId) and API token (with siteUrl)
     */
    static async listProjects(siteUrlOrCloudId: string, accessToken: string, useCloudId: boolean = false): Promise<JiraProject[]> {
        try {
            const client = this.createClient(siteUrlOrCloudId, accessToken, useCloudId);
            const response = await client.get('/project');
            return response.data || [];
        } catch (error: any) {
            loggingService.error('Failed to list JIRA projects', { 
                error: error.message,
                siteUrlOrCloudId,
                useCloudId,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            });
            throw error;
        }
    }

    /**
     * Get issue types for a project
     * Supports both OAuth 2.0 (with cloudId) and API token (with siteUrl)
     */
    static async getIssueTypes(siteUrlOrCloudId: string, accessToken: string, projectKey: string, useCloudId: boolean = false): Promise<JiraIssueType[]> {
        try {
            const client = this.createClient(siteUrlOrCloudId, accessToken, useCloudId);
            const response = await client.get(`/issue/createmeta?projectKeys=${projectKey}&expand=projects.issuetypes`);
            
            if (response.data.projects && response.data.projects.length > 0) {
                const project = response.data.projects[0];
                return project.issuetypes || [];
            }
            
            return [];
        } catch (error: any) {
            loggingService.error('Failed to get JIRA issue types', { 
                error: error.message,
                siteUrlOrCloudId,
                useCloudId,
                projectKey,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            });
            throw error;
        }
    }

    /**
     * List priorities
     * Supports both OAuth 2.0 (with cloudId) and API token (with siteUrl)
     */
    static async listPriorities(siteUrlOrCloudId: string, accessToken: string, useCloudId: boolean = false): Promise<JiraPriority[]> {
        try {
            const client = this.createClient(siteUrlOrCloudId, accessToken, useCloudId);
            const response = await client.get('/priority');
            return response.data || [];
        } catch (error: any) {
            loggingService.error('Failed to list JIRA priorities', { 
                error: error.message,
                siteUrlOrCloudId,
                useCloudId
            });
            throw error;
        }
    }

    /**
     * Get issue details
     * Supports both OAuth 2.0 (with cloudId) and API token (with siteUrl)
     */
    static async getIssue(siteUrlOrCloudId: string, accessToken: string, issueKey: string, useCloudId: boolean = false): Promise<JiraIssue | null> {
        try {
            const client = this.createClient(siteUrlOrCloudId, accessToken, useCloudId);
            const response = await client.get(`/issue/${issueKey}`);
            return response.data;
        } catch (error: any) {
            loggingService.error('Failed to get JIRA issue', { 
                error: error.message,
                siteUrlOrCloudId,
                issueKey,
                useCloudId
            });
            return null;
        }
    }

    /**
     * Create JIRA issue
     * Supports both OAuth 2.0 (with cloudId) and API token (with siteUrl)
     */
    static async createIssue(
        siteUrlOrCloudId: string,
        accessToken: string,
        options: {
            projectKey: string;
            title: string;
            description?: string;
            issueTypeId: string;
            priorityId?: string;
            labels?: string[];
            components?: Array<{ id: string }>;
            useCloudId?: boolean;
        }
    ): Promise<JiraIssue> {
        const startTime = Date.now();
        const useCloudId = options.useCloudId || false;
        
        try {
            // Convert description to ADF format
            const descriptionContent: any[] = [];
            if (options.description) {
                const descriptionLines = options.description.split('\n');
                descriptionLines.forEach((line) => {
                    if (line.trim()) {
                        descriptionContent.push({
                            type: 'paragraph',
                            content: [{ type: 'text', text: line }]
                        });
                    } else {
                        descriptionContent.push({
                            type: 'paragraph',
                            content: []
                        });
                    }
                });
            }

            const createRequest: JiraCreateIssueRequest = {
                fields: {
                    project: {
                        key: options.projectKey
                    },
                    summary: options.title,
                    issuetype: {
                        id: options.issueTypeId
                    }
                }
            };

            if (options.description) {
                createRequest.fields.description = {
                    type: 'doc',
                    version: 1,
                    content: descriptionContent.length > 0 ? descriptionContent : [
                        {
                            type: 'paragraph',
                            content: [{ type: 'text', text: options.description }]
                        }
                    ]
                };
            }

            if (options.priorityId) {
                createRequest.fields.priority = { id: options.priorityId };
            }

            if (options.labels && options.labels.length > 0) {
                createRequest.fields.labels = options.labels;
            }

            if (options.components && options.components.length > 0) {
                createRequest.fields.components = options.components;
            }

            const client = this.createClient(siteUrlOrCloudId, accessToken, useCloudId);
            const response = await client.post('/issue', createRequest);

            const responseTime = Date.now() - startTime;
            const issue = response.data;

            loggingService.info('JIRA issue created successfully', {
                projectKey: options.projectKey,
                issueKey: issue.key,
                responseTime,
                useCloudId
            });

            return issue;
        } catch (error: any) {
            const responseTime = Date.now() - startTime;
            loggingService.error('Failed to create JIRA issue', {
                error: error.message,
                projectKey: options.projectKey,
                responseTime,
                useCloudId,
                data: error.response?.data
            });
            throw error;
        }
    }

    /**
     * List issues for a project
     * Supports both OAuth 2.0 (with cloudId) and API token (with siteUrl)
     */
    static async listIssues(
        siteUrlOrCloudId: string,
        accessToken: string,
        projectKey: string,
        filters?: {
            status?: string;
            assignee?: string;
            maxResults?: number;
            startAt?: number;
        },
        useCloudId: boolean = false
    ): Promise<{ issues: JiraIssue[]; total: number }> {
        try {
            const client = this.createClient(siteUrlOrCloudId, accessToken, useCloudId);
            
            let jql = `project = ${projectKey}`;
            if (filters?.status) {
                jql += ` AND status = "${filters.status}"`;
            }
            if (filters?.assignee) {
                jql += ` AND assignee = "${filters.assignee}"`;
            }

            const params: any = {
                jql,
                maxResults: filters?.maxResults || 50,
                startAt: filters?.startAt || 0,
                fields: ['summary', 'status', 'priority', 'assignee', 'created', 'updated']
            };

            const response = await client.get('/search', { params });
            
            return {
                issues: response.data.issues || [],
                total: response.data.total || 0
            };
        } catch (error: any) {
            loggingService.error('Failed to list JIRA issues', {
                error: error.message,
                siteUrlOrCloudId,
                projectKey,
                useCloudId,
                status: error.response?.status
            });
            throw error;
        }
    }

    /**
     * Add comment to JIRA issue
     * Supports both OAuth 2.0 (with cloudId) and API token (with siteUrl)
     */
    static async addComment(
        siteUrlOrCloudId: string,
        accessToken: string,
        issueKey: string,
        comment: string,
        useCloudId: boolean = false
    ): Promise<{ success: boolean; commentId?: string; responseTime: number }> {
        const startTime = Date.now();
        
        try {
            // Convert plain text to JIRA ADF format
            const lines = comment.split('\n');
            const content: any[] = [];
            
            lines.forEach((line) => {
                if (line.trim()) {
                    content.push({
                        type: 'paragraph',
                        content: [{ type: 'text', text: line }]
                    });
                } else {
                    content.push({
                        type: 'paragraph',
                        content: []
                    });
                }
            });

            const client = this.createClient(siteUrlOrCloudId, accessToken, useCloudId);
            const response = await client.post(`/issue/${issueKey}/comment`, {
                body: {
                    type: 'doc',
                    version: 1,
                    content: content.length > 0 ? content : [
                        {
                            type: 'paragraph',
                            content: [{ type: 'text', text: comment }]
                        }
                    ]
                }
            });

            const responseTime = Date.now() - startTime;

            loggingService.info('JIRA comment added successfully', {
                issueKey,
                commentId: response.data.id,
                responseTime
            });

            return {
                success: true,
                commentId: response.data.id,
                responseTime
            };
        } catch (error: any) {
            const responseTime = Date.now() - startTime;
            loggingService.error('Failed to add JIRA comment', {
                error: error.message,
                issueKey,
                responseTime,
                status: error.response?.status
            });
            throw error;
        }
    }

    /**
     * Post alert as comment on JIRA issue
     */
    static async sendAlertComment(
        siteUrl: string,
        accessToken: string,
        issueKey: string,
        alert: IAlert,
        dashboardUrl?: string
    ): Promise<{ success: boolean; responseTime: number; commentId?: string }> {
        const startTime = Date.now();
        
        try {
            // Format as plain text first
            const commentText = this.formatAlertMessage(alert, dashboardUrl);
            
            // Convert plain text to JIRA ADF format
            // Split by newlines and create paragraphs
            const lines = commentText.split('\n');
            const content: any[] = [];
            
            lines.forEach((line) => {
                if (line.trim()) {
                    content.push({
                        type: 'paragraph',
                        content: [{ type: 'text', text: line }]
                    });
                } else {
                    // Empty line - add paragraph break
                    content.push({
                        type: 'paragraph',
                        content: []
                    });
                }
            });
            
            const client = this.createClient(siteUrl, accessToken);
            const response = await client.post(`/issue/${issueKey}/comment`, {
                body: {
                    type: 'doc',
                    version: 1,
                    content: content.length > 0 ? content : [
                        {
                            type: 'paragraph',
                            content: [{ type: 'text', text: commentText }]
                        }
                    ]
                }
            });

            const responseTime = Date.now() - startTime;

            loggingService.info('JIRA comment sent successfully', {
                issueKey,
                alertId: alert._id,
                commentId: response.data.id,
                responseTime
            });

            return {
                success: true,
                responseTime,
                commentId: response.data.id
            };
        } catch (error: any) {
            const responseTime = Date.now() - startTime;
            loggingService.error('Failed to send JIRA comment', {
                error: error.message,
                issueKey,
                alertId: alert._id,
                responseTime
            });
            throw error;
        }
    }

    /**
     * Create JIRA issue from alert
     */
    static async createIssueFromAlert(
        siteUrl: string,
        accessToken: string,
        projectKey: string,
        issueTypeId: string,
        alert: IAlert,
        dashboardUrl?: string,
        priorityId?: string,
        labels?: string[],
        components?: Array<{ id: string }>
    ): Promise<{ success: boolean; responseTime: number; issueKey?: string; issueUrl?: string }> {
        const startTime = Date.now();
        
        try {
            const issueData = this.formatIssueFromAlert(alert, dashboardUrl);
            
            // Convert description to ADF format
            const descriptionLines = issueData.description.split('\n');
            const descriptionContent: any[] = [];
            
            descriptionLines.forEach((line) => {
                if (line.trim()) {
                    descriptionContent.push({
                        type: 'paragraph',
                        content: [{ type: 'text', text: line }]
                    });
                } else {
                    descriptionContent.push({
                        type: 'paragraph',
                        content: []
                    });
                }
            });
            
            const createRequest: JiraCreateIssueRequest = {
                fields: {
                    project: {
                        key: projectKey
                    },
                    summary: issueData.title,
                    description: {
                        type: 'doc',
                        version: 1,
                        content: descriptionContent.length > 0 ? descriptionContent : [
                            {
                                type: 'paragraph',
                                content: [{ type: 'text', text: issueData.description }]
                            }
                        ]
                    },
                    issuetype: {
                        id: issueTypeId
                    }
                }
            };

            if (priorityId) {
                createRequest.fields.priority = { id: priorityId };
            }

            if (labels && labels.length > 0) {
                createRequest.fields.labels = labels;
            }

            if (components && components.length > 0) {
                createRequest.fields.components = components;
            }

            const client = this.createClient(siteUrl, accessToken);
            const response = await client.post('/issue', createRequest);

            const responseTime = Date.now() - startTime;
            const issueKey = response.data.key;
            const issueUrl = `${siteUrl}/browse/${issueKey}`;

            loggingService.info('JIRA issue created successfully', {
                projectKey,
                alertId: alert._id,
                issueKey,
                responseTime
            });

            return {
                success: true,
                responseTime,
                issueKey,
                issueUrl
            };
        } catch (error: any) {
            const responseTime = Date.now() - startTime;
            loggingService.error('Failed to create JIRA issue', {
                error: error.message,
                projectKey,
                alertId: alert._id,
                responseTime,
                data: error.response?.data
            });
            throw error;
        }
    }

    /**
     * Update JIRA issue
     */
    static async updateIssue(
        siteUrlOrCloudId: string,
        accessToken: string,
        issueKey: string,
        updates: {
            summary?: string;
            description?: string;
            priorityId?: string;
            labels?: string[];
        },
        useCloudId: boolean = false
    ): Promise<{ success: boolean; responseTime: number }> {
        const startTime = Date.now();
        
        try {
            const updateRequest: any = {
                fields: {}
            };

            if (updates.summary !== undefined) {
                updateRequest.fields.summary = updates.summary;
            }

            if (updates.description !== undefined) {
                updateRequest.fields.description = updates.description;
            }

            if (updates.priorityId !== undefined) {
                updateRequest.fields.priority = { id: updates.priorityId };
            }

            if (updates.labels !== undefined) {
                updateRequest.fields.labels = updates.labels;
            }

            const client = this.createClient(siteUrlOrCloudId, accessToken, useCloudId);
            await client.put(`/issue/${issueKey}`, updateRequest);

            const responseTime = Date.now() - startTime;

            loggingService.info('JIRA issue updated successfully', {
                issueKey,
                responseTime
            });

            return {
                success: true,
                responseTime
            };
        } catch (error: any) {
            const responseTime = Date.now() - startTime;
            loggingService.error('Failed to update JIRA issue', {
                error: error.message,
                issueKey,
                responseTime,
                useCloudId
            });
            throw error;
        }
    }

    /**
     * Format alert as comment for JIRA (plain text for now, can be enhanced with JIRA markup)
     */
    static formatAlertMessage(alert: IAlert, dashboardUrl?: string): string {
        const severityEmoji = this.getSeverityEmoji(alert.severity);
        const timestamp = new Date(alert.createdAt).toISOString();
        
        let message = `${severityEmoji} *${alert.title}*\n\n`;
        message += `${alert.message}\n\n`;
        message += `*Type:* ${this.formatAlertType(alert.type)}\n`;
        message += `*Severity:* ${alert.severity.toUpperCase()}\n`;
        message += `*Time:* ${timestamp}\n\n`;

        // Add type-specific details
        switch (alert.type) {
            case 'cost_threshold':
            case 'cost':
                if (alert.data.currentValue !== undefined && alert.data.threshold !== undefined) {
                    const percentage = alert.data.percentage || 
                        ((alert.data.currentValue / alert.data.threshold) * 100);
                    message += `*Cost Details*\n\n`;
                    message += `• Current Cost: ${formatCurrency(alert.data.currentValue)}\n`;
                    message += `• Threshold: ${formatCurrency(alert.data.threshold)}\n`;
                    message += `• Usage: ${percentage.toFixed(1)}%\n`;
                    if (alert.data.period) {
                        message += `• Period: ${alert.data.period}\n`;
                    }
                    message += `\n`;
                }
                break;

            case 'optimization_available':
            case 'optimization':
                if (alert.data.potentialSavings !== undefined) {
                    message += `*Optimization Opportunity*\n\n`;
                    message += `• Potential Savings: ${formatCurrency(alert.data.potentialSavings)}\n`;
                    if (alert.data.recommendations && Array.isArray(alert.data.recommendations)) {
                        message += `\n*Recommendations:*\n`;
                        alert.data.recommendations.slice(0, 5).forEach((rec, idx) => {
                            message += `${idx + 1}. ${rec}\n`;
                        });
                    }
                    message += `\n`;
                }
                break;

            case 'anomaly':
                if (alert.data.expectedValue !== undefined && alert.data.actualValue !== undefined) {
                    const deviation = ((alert.data.actualValue - alert.data.expectedValue) / alert.data.expectedValue) * 100;
                    message += `*Anomaly Details*\n\n`;
                    message += `• Expected: ${formatCurrency(alert.data.expectedValue)}\n`;
                    message += `• Actual: ${formatCurrency(alert.data.actualValue)}\n`;
                    message += `• Deviation: ${deviation > 0 ? '+' : ''}${deviation.toFixed(1)}%\n\n`;
                }
                break;

            case 'usage_spike':
                if (alert.data.currentUsage !== undefined && alert.data.averageUsage !== undefined) {
                    const increasePercentage = ((alert.data.currentUsage - alert.data.averageUsage) / alert.data.averageUsage) * 100;
                    message += `*Usage Spike Details*\n\n`;
                    message += `• Current Usage: ${alert.data.currentUsage.toLocaleString()}\n`;
                    message += `• Average Usage: ${alert.data.averageUsage.toLocaleString()}\n`;
                    message += `• Increase: +${increasePercentage.toFixed(1)}%\n\n`;
                }
                break;
        }

        if (dashboardUrl) {
            message += `---\n\n`;
            message += `[View in CostKatana Dashboard|${dashboardUrl}]`;
            if (alert.actionRequired) {
                message += ` | [Take Action|${dashboardUrl}/alerts/${alert._id}]`;
            }
        }

        message += `\n\n_Alert ID: ${alert._id}_`;

        return message;
    }

    /**
     * Format alert as JIRA issue
     */
    static formatIssueFromAlert(alert: IAlert, dashboardUrl?: string): { title: string; description: string } {
        const severityEmoji = this.getSeverityEmoji(alert.severity);
        const title = `${severityEmoji} [${alert.severity.toUpperCase()}] ${alert.title}`;
        
        let description = `${alert.message}\n\n`;
        description += `*Alert Type:* ${this.formatAlertType(alert.type)}\n`;
        description += `*Severity:* ${alert.severity.toUpperCase()}\n`;
        description += `*Created:* ${new Date(alert.createdAt).toISOString()}\n\n`;

        // Add type-specific details
        if (alert.type === 'cost_threshold' || alert.type === 'cost') {
            if (alert.data.currentValue !== undefined && alert.data.threshold !== undefined) {
                const percentage = alert.data.percentage || 
                    ((alert.data.currentValue / alert.data.threshold) * 100);
                description += `*Cost Details*\n\n`;
                description += `• Current: ${formatCurrency(alert.data.currentValue)}\n`;
                description += `• Threshold: ${formatCurrency(alert.data.threshold)}\n`;
                description += `• Usage: ${percentage.toFixed(1)}%\n`;
            }
        } else if (alert.type === 'optimization_available' || alert.type === 'optimization') {
            if (alert.data.potentialSavings !== undefined) {
                description += `*Savings Opportunity*\n\n`;
                description += `Potential savings: ${formatCurrency(alert.data.potentialSavings)}\n`;
            }
        }

        if (dashboardUrl) {
            description += `\n\n[View Details in CostKatana|${dashboardUrl}/alerts/${alert._id}]`;
        }

        return { title, description };
    }

    /**
     * Get emoji for severity level
     */
    private static getSeverityEmoji(severity: string): string {
        const emojiMap: Record<string, string> = {
            low: '🔵',
            medium: '🟡',
            high: '🟠',
            critical: '🔴'
        };
        return emojiMap[severity] || '⚪';
    }

    /**
     * Format alert type for display
     */
    private static formatAlertType(type: string): string {
        return type
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    /**
     * Test JIRA integration
     */
    static async testIntegration(
        siteUrl: string,
        accessToken: string,
        projectKey: string
    ): Promise<{ success: boolean; message: string; responseTime: number }> {
        const startTime = Date.now();
        
        try {
            // Try to fetch project details as a test
            const client = this.createClient(siteUrl, accessToken);
            const response = await client.get(`/project/${projectKey}`);

            const responseTime = Date.now() - startTime;

            if (!response.data) {
                throw new Error('Project not found');
            }

            return {
                success: true,
                message: `Successfully connected to JIRA project: ${response.data.name}`,
                responseTime
            };
        } catch (error: any) {
            const responseTime = Date.now() - startTime;
            return {
                success: false,
                message: error.message || 'Failed to test JIRA connection',
                responseTime
            };
        }
    }
}

