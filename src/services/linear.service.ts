import axios, { AxiosInstance } from 'axios';
import { IAlert } from '../models/Alert';
import { loggingService } from './logging.service';
import { formatCurrency } from '../utils/helpers';

export interface LinearTeam {
    id: string;
    name: string;
    key: string;
    description?: string;
}

export interface LinearProject {
    id: string;
    name: string;
    description?: string;
    icon?: string;
}

export interface LinearIssue {
    id: string;
    title: string;
    description?: string;
    identifier: string;
    url: string;
    state?: {
        id: string;
        name: string;
        type: string;
    };
}

export interface LinearComment {
    id: string;
    body: string;
    createdAt: string;
}

export interface LinearOAuthTokenResponse {
    access_token: string;
    token_type: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
}

export interface LinearUser {
    id: string;
    name: string;
    email?: string;
    active: boolean;
}

export class LinearService {
    private static readonly LINEAR_API_BASE = 'https://api.linear.app/graphql';
    private static readonly LINEAR_OAUTH_BASE = 'https://api.linear.app';

    /**
     * Create a GraphQL client for Linear API
     */
    private static createClient(accessToken: string): AxiosInstance {
        return axios.create({
            baseURL: this.LINEAR_API_BASE,
            headers: {
                'Authorization': accessToken,
                'Content-Type': 'application/json'
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
    ): Promise<LinearOAuthTokenResponse> {
        const startTime = Date.now();
        
        try {
            const response = await axios.post(
                `${this.LINEAR_OAUTH_BASE}/oauth/token`,
                {
                    code,
                    client_id: clientId,
                    client_secret: clientSecret,
                    redirect_uri: redirectUri,
                    grant_type: 'authorization_code'
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            const responseTime = Date.now() - startTime;
            loggingService.info('Linear OAuth token exchange successful', { responseTime });

            return response.data;
        } catch (error: any) {
            const responseTime = Date.now() - startTime;
            loggingService.error('Failed to exchange Linear OAuth code for token', {
                error: error.message,
                responseTime,
                status: error.response?.status,
                statusText: error.response?.statusText
            });
            throw error;
        }
    }

    /**
     * Get authenticated user information
     */
    static async getAuthenticatedUser(accessToken: string): Promise<LinearUser> {
        const query = `
            query {
                viewer {
                    id
                    name
                    email
                    active
                }
            }
        `;

        try {
            const data = await this.executeQuery<{ viewer: LinearUser }>(accessToken, query);
            return data.viewer;
        } catch (error: any) {
            loggingService.error('Failed to get Linear authenticated user', { error: error.message });
            throw error;
        }
    }

    /**
     * Execute a GraphQL query
     */
    private static async executeQuery<T>(
        accessToken: string,
        query: string,
        variables?: Record<string, any>
    ): Promise<T> {
        const client = this.createClient(accessToken);
        
        try {
            const response = await client.post('', {
                query,
                variables
            });

            if (response.data.errors) {
                throw new Error(`Linear API error: ${response.data.errors[0]?.message || 'Unknown error'}`);
            }

            return response.data.data;
        } catch (error: any) {
            loggingService.error('Linear GraphQL query failed', {
                error: error.message,
                query: query.substring(0, 100)
            });
            throw error;
        }
    }

    /**
     * List available teams
     */
    static async listTeams(accessToken: string): Promise<LinearTeam[]> {
        const query = `
            query {
                teams {
                    nodes {
                        id
                        name
                        key
                        description
                    }
                }
            }
        `;

        try {
            const data = await this.executeQuery<{ teams: { nodes: LinearTeam[] } }>(accessToken, query);
            return data.teams.nodes || [];
        } catch (error: any) {
            loggingService.error('Failed to list Linear teams', { error: error.message });
            throw error;
        }
    }

    /**
     * List users in organization
     */
    static async listUsers(accessToken: string): Promise<LinearUser[]> {
        const query = `
            query {
                users {
                    nodes {
                        id
                        name
                        email
                        active
                    }
                }
            }
        `;

        try {
            const data = await this.executeQuery<{ users: { nodes: LinearUser[] } }>(accessToken, query);
            return data.users.nodes || [];
        } catch (error: any) {
            loggingService.error('Failed to list Linear users', { error: error.message });
            throw error;
        }
    }

    /**
     * List workflows (states) for a team
     */
    static async listWorkflows(accessToken: string, teamId: string): Promise<any[]> {
        const query = `
            query($teamId: String!) {
                team(id: $teamId) {
                    states {
                        nodes {
                            id
                            name
                            type
                            color
                            description
                        }
                    }
                }
            }
        `;

        try {
            const data = await this.executeQuery<{ team: { states: { nodes: any[] } } }>(
                accessToken,
                query,
                { teamId }
            );
            return data.team?.states?.nodes || [];
        } catch (error: any) {
            loggingService.error('Failed to list Linear workflows', { error: error.message, teamId });
            throw error;
        }
    }

    /**
     * List labels (tags) for a team
     */
    static async listLabels(accessToken: string, teamId: string): Promise<any[]> {
        const query = `
            query($teamId: String!) {
                team(id: $teamId) {
                    labels {
                        nodes {
                            id
                            name
                            color
                            description
                        }
                    }
                }
            }
        `;

        try {
            const data = await this.executeQuery<{ team: { labels: { nodes: any[] } } }>(
                accessToken,
                query,
                { teamId }
            );
            return data.team?.labels?.nodes || [];
        } catch (error: any) {
            loggingService.error('Failed to list Linear labels', { error: error.message, teamId });
            throw error;
        }
    }

    /**
     * List cycles (iterations) for a team
     */
    static async listCycles(accessToken: string, teamId: string): Promise<any[]> {
        const query = `
            query($teamId: String!) {
                team(id: $teamId) {
                    cycles {
                        nodes {
                            id
                            number
                            name
                            startsAt
                            endsAt
                            completedAt
                            progress
                        }
                    }
                }
            }
        `;

        try {
            const data = await this.executeQuery<{ team: { cycles: { nodes: any[] } } }>(
                accessToken,
                query,
                { teamId }
            );
            return data.team?.cycles?.nodes || [];
        } catch (error: any) {
            loggingService.error('Failed to list Linear cycles', { error: error.message, teamId });
            throw error;
        }
    }

    /**
     * List projects for a team
     */
    static async listProjects(accessToken: string, teamId: string): Promise<LinearProject[]> {
        const query = `
            query($teamId: String!) {
                team(id: $teamId) {
                    projects {
                        nodes {
                            id
                            name
                            description
                            icon
                        }
                    }
                }
            }
        `;

        try {
            const data = await this.executeQuery<{ team: { projects: { nodes: LinearProject[] } } }>(
                accessToken,
                query,
                { teamId }
            );
            return data.team?.projects?.nodes || [];
        } catch (error: any) {
            loggingService.error('Failed to list Linear projects', { error: error.message, teamId });
            throw error;
        }
    }

    /**
     * Get issue details
     */
    static async getIssue(accessToken: string, issueId: string): Promise<LinearIssue | null> {
        const query = `
            query($issueId: String!) {
                issue(id: $issueId) {
                    id
                    title
                    description
                    identifier
                    url
                    state {
                        id
                        name
                        type
                    }
                }
            }
        `;

        try {
            const data = await this.executeQuery<{ issue: LinearIssue | null }>(
                accessToken,
                query,
                { issueId }
            );
            return data.issue;
        } catch (error: any) {
            loggingService.error('Failed to get Linear issue', { error: error.message, issueId });
            throw error;
        }
    }

    /**
     * List issues for a team
     */
    static async listIssues(
        accessToken: string,
        teamId: string,
        filters?: {
            state?: string;
            assigneeId?: string;
            limit?: number;
        }
    ): Promise<{ issues: LinearIssue[]; total: number }> {
        const limit = filters?.limit || 50;
        
        const query = `
            query($teamId: String!, $first: Int!) {
                issues(
                    filter: { 
                        team: { id: { eq: $teamId } }
                        ${filters?.state ? `state: { name: { eq: "${filters.state}" } }` : ''}
                    }
                    first: $first
                ) {
                    nodes {
                        id
                        title
                        description
                        identifier
                        url
                        state {
                            id
                            name
                            type
                        }
                    }
                    pageInfo {
                        hasNextPage
                    }
                }
            }
        `;

        try {
            const data = await this.executeQuery<{ 
                issues: { 
                    nodes: LinearIssue[];
                    pageInfo: { hasNextPage: boolean };
                } 
            }>(
                accessToken,
                query,
                { teamId, first: limit }
            );
            
            return {
                issues: data.issues.nodes || [],
                total: data.issues.nodes.length
            };
        } catch (error: any) {
            loggingService.error('Failed to list Linear issues', { 
                error: error.message, 
                teamId,
                filters 
            });
            throw error;
        }
    }

    /**
     * Search issues
     */
    static async searchIssues(accessToken: string, teamId: string, query: string): Promise<LinearIssue[]> {
        const graphqlQuery = `
            query($teamId: String!, $query: String!) {
                issues(
                    filter: { team: { id: { eq: $teamId } } }
                    first: 20
                ) {
                    nodes {
                        id
                        title
                        description
                        identifier
                        url
                        state {
                            id
                            name
                            type
                        }
                    }
                }
            }
        `;

        try {
            const data = await this.executeQuery<{ issues: { nodes: LinearIssue[] } }>(
                accessToken,
                graphqlQuery,
                { teamId, query }
            );
            
            // Filter results based on search query if provided
            let issues = data.issues?.nodes || [];
            if (query) {
                const searchLower = query.toLowerCase();
                issues = issues.filter(issue =>
                    issue.title.toLowerCase().includes(searchLower) ||
                    issue.identifier.toLowerCase().includes(searchLower) ||
                    issue.description?.toLowerCase().includes(searchLower)
                );
            }
            
            return issues;
        } catch (error: any) {
            loggingService.error('Failed to search Linear issues', { error: error.message, teamId, query });
            throw error;
        }
    }

    /**
     * Post alert as comment on Linear issue
     */
    static async sendAlertComment(
        accessToken: string,
        issueId: string,
        alert: IAlert,
        dashboardUrl?: string
    ): Promise<{ success: boolean; responseTime: number; commentId?: string }> {
        const startTime = Date.now();
        
        try {
            const commentBody = this.formatAlertMessage(alert, dashboardUrl);
            
            const mutation = `
                mutation($issueId: String!, $body: String!) {
                    commentCreate(
                        input: {
                            issueId: $issueId
                            body: $body
                        }
                    ) {
                        success
                        comment {
                            id
                        }
                    }
                }
            `;

            const data = await this.executeQuery<{ commentCreate: { success: boolean; comment?: { id: string } } }>(
                accessToken,
                mutation,
                { issueId, body: commentBody }
            );

            const responseTime = Date.now() - startTime;

            if (!data.commentCreate.success) {
                throw new Error('Failed to create comment on Linear issue');
            }

            loggingService.info('Linear comment sent successfully', {
                issueId,
                alertId: alert._id,
                commentId: data.commentCreate.comment?.id,
                responseTime
            });

            return {
                success: true,
                responseTime,
                commentId: data.commentCreate.comment?.id
            };
        } catch (error: any) {
            const responseTime = Date.now() - startTime;
            loggingService.error('Failed to send Linear comment', {
                error: error.message,
                issueId,
                alertId: alert._id,
                responseTime
            });
            throw error;
        }
    }

    /**
     * Create Linear issue
     */
    static async createIssue(
        accessToken: string,
        options: {
            teamId: string;
            title: string;
            description?: string;
            projectId?: string;
        }
    ): Promise<LinearIssue> {
        const mutation = `
            mutation($teamId: String!, $title: String!, $description: String, $projectId: String) {
                issueCreate(
                    input: {
                        teamId: $teamId
                        title: $title
                        description: $description
                        projectId: $projectId
                    }
                ) {
                    success
                    issue {
                        id
                        title
                        description
                        identifier
                        url
                        state {
                            id
                            name
                            type
                        }
                    }
                }
            }
        `;

        try {
            const data = await this.executeQuery<{ 
                issueCreate: { 
                    success: boolean; 
                    issue: LinearIssue | null;
                } 
            }>(
                accessToken,
                mutation,
                {
                    teamId: options.teamId,
                    title: options.title,
                    description: options.description,
                    projectId: options.projectId
                }
            );

            if (!data.issueCreate.success || !data.issueCreate.issue) {
                throw new Error('Failed to create Linear issue');
            }

            loggingService.info('Linear issue created successfully', {
                teamId: options.teamId,
                issueId: data.issueCreate.issue.id,
                identifier: data.issueCreate.issue.identifier
            });

            return data.issueCreate.issue;
        } catch (error: any) {
            loggingService.error('Failed to create Linear issue', {
                error: error.message,
                teamId: options.teamId
            });
            throw error;
        }
    }

    /**
     * Create Linear issue from alert
     */
    static async createIssueFromAlert(
        accessToken: string,
        teamId: string,
        projectId: string | undefined,
        alert: IAlert,
        dashboardUrl?: string
    ): Promise<{ success: boolean; responseTime: number; issueId?: string; issueUrl?: string }> {
        const startTime = Date.now();
        
        try {
            const issueData = this.formatIssueFromAlert(alert, dashboardUrl);
            
            const mutation = `
                mutation($teamId: String!, $title: String!, $description: String, $projectId: String) {
                    issueCreate(
                        input: {
                            teamId: $teamId
                            title: $title
                            description: $description
                            ${projectId ? 'projectId: $projectId' : ''}
                        }
                    ) {
                        success
                        issue {
                            id
                            identifier
                            url
                            title
                        }
                    }
                }
            `;

            const variables: Record<string, any> = {
                teamId,
                title: issueData.title,
                description: issueData.description
            };

            if (projectId) {
                variables.projectId = projectId;
            }

            const data = await this.executeQuery<{
                issueCreate: {
                    success: boolean;
                    issue?: {
                        id: string;
                        identifier: string;
                        url: string;
                        title: string;
                    };
                };
            }>(accessToken, mutation, variables);

            const responseTime = Date.now() - startTime;

            if (!data.issueCreate.success || !data.issueCreate.issue) {
                throw new Error('Failed to create Linear issue');
            }

            loggingService.info('Linear issue created successfully', {
                teamId,
                alertId: alert._id,
                issueId: data.issueCreate.issue.id,
                issueIdentifier: data.issueCreate.issue.identifier,
                responseTime
            });

            return {
                success: true,
                responseTime,
                issueId: data.issueCreate.issue.id,
                issueUrl: data.issueCreate.issue.url
            };
        } catch (error: any) {
            const responseTime = Date.now() - startTime;
            loggingService.error('Failed to create Linear issue', {
                error: error.message,
                teamId,
                alertId: alert._id,
                responseTime
            });
            throw error;
        }
    }

    /**
     * Update Linear issue
     */
    static async updateIssue(
        accessToken: string,
        issueId: string,
        updates: {
            title?: string;
            description?: string;
            stateId?: string;
            priority?: number;
        }
    ): Promise<{ success: boolean; responseTime: number }> {
        const startTime = Date.now();
        
        try {
            const inputFields: string[] = [];
            const variables: Record<string, any> = { issueId };

            if (updates.title !== undefined) {
                inputFields.push('title: $title');
                variables.title = updates.title;
            }

            if (updates.description !== undefined) {
                inputFields.push('description: $description');
                variables.description = updates.description;
            }

            if (updates.stateId !== undefined) {
                inputFields.push('stateId: $stateId');
                variables.stateId = updates.stateId;
            }

            if (updates.priority !== undefined) {
                inputFields.push('priority: $priority');
                variables.priority = updates.priority;
            }

            if (inputFields.length === 0) {
                throw new Error('No update fields provided');
            }

            const mutation = `
                mutation($issueId: String!, ${Object.keys(variables).filter(k => k !== 'issueId').map(k => `$${k}: ${k === 'priority' ? 'Int' : 'String'}`).join(', ')}) {
                    issueUpdate(
                        id: $issueId
                        input: {
                            ${inputFields.join('\n                            ')}
                        }
                    ) {
                        success
                        issue {
                            id
                            title
                        }
                    }
                }
            `;

            const data = await this.executeQuery<{ issueUpdate: { success: boolean } }>(
                accessToken,
                mutation,
                variables
            );

            const responseTime = Date.now() - startTime;

            if (!data.issueUpdate.success) {
                throw new Error('Failed to update Linear issue');
            }

            loggingService.info('Linear issue updated successfully', {
                issueId,
                responseTime
            });

            return {
                success: true,
                responseTime
            };
        } catch (error: any) {
            const responseTime = Date.now() - startTime;
            loggingService.error('Failed to update Linear issue', {
                error: error.message,
                issueId,
                responseTime
            });
            throw error;
        }
    }

    /**
     * Format alert as markdown comment for Linear
     */
    static formatAlertMessage(alert: IAlert, dashboardUrl?: string): string {
        const severityEmoji = this.getSeverityEmoji(alert.severity);
        const timestamp = new Date(alert.createdAt).toISOString();
        
        let markdown = `## ${severityEmoji} ${alert.title}\n\n`;
        markdown += `${alert.message}\n\n`;
        markdown += `**Type:** ${this.formatAlertType(alert.type)}\n`;
        markdown += `**Severity:** ${alert.severity.toUpperCase()}\n`;
        markdown += `**Time:** ${timestamp}\n\n`;

        // Add type-specific details
        switch (alert.type) {
            case 'cost_threshold':
            case 'cost':
                if (alert.data.currentValue !== undefined && alert.data.threshold !== undefined) {
                    const percentage = alert.data.percentage || 
                        ((alert.data.currentValue / alert.data.threshold) * 100);
                    markdown += `### Cost Details\n\n`;
                    markdown += `- **Current Cost:** ${formatCurrency(alert.data.currentValue)}\n`;
                    markdown += `- **Threshold:** ${formatCurrency(alert.data.threshold)}\n`;
                    markdown += `- **Usage:** ${percentage.toFixed(1)}%\n`;
                    if (alert.data.period) {
                        markdown += `- **Period:** ${alert.data.period}\n`;
                    }
                    markdown += `\n`;
                }
                break;

            case 'optimization_available':
            case 'optimization':
                if (alert.data.potentialSavings !== undefined) {
                    markdown += `### Optimization Opportunity\n\n`;
                    markdown += `- **Potential Savings:** ${formatCurrency(alert.data.potentialSavings)}\n`;
                    if (alert.data.recommendations && Array.isArray(alert.data.recommendations)) {
                        markdown += `\n**Recommendations:**\n`;
                        alert.data.recommendations.slice(0, 5).forEach((rec, idx) => {
                            markdown += `${idx + 1}. ${rec}\n`;
                        });
                    }
                    markdown += `\n`;
                }
                break;

            case 'anomaly':
                if (alert.data.expectedValue !== undefined && alert.data.actualValue !== undefined) {
                    const deviation = ((alert.data.actualValue - alert.data.expectedValue) / alert.data.expectedValue) * 100;
                    markdown += `### Anomaly Details\n\n`;
                    markdown += `- **Expected:** ${formatCurrency(alert.data.expectedValue)}\n`;
                    markdown += `- **Actual:** ${formatCurrency(alert.data.actualValue)}\n`;
                    markdown += `- **Deviation:** ${deviation > 0 ? '+' : ''}${deviation.toFixed(1)}%\n\n`;
                }
                break;

            case 'usage_spike':
                if (alert.data.currentUsage !== undefined && alert.data.averageUsage !== undefined) {
                    const increasePercentage = ((alert.data.currentUsage - alert.data.averageUsage) / alert.data.averageUsage) * 100;
                    markdown += `### Usage Spike Details\n\n`;
                    markdown += `- **Current Usage:** ${alert.data.currentUsage.toLocaleString()}\n`;
                    markdown += `- **Average Usage:** ${alert.data.averageUsage.toLocaleString()}\n`;
                    markdown += `- **Increase:** +${increasePercentage.toFixed(1)}%\n\n`;
                }
                break;
        }

        if (dashboardUrl) {
            markdown += `---\n\n`;
            markdown += `[View in CostKatana Dashboard](${dashboardUrl})`;
            if (alert.actionRequired) {
                markdown += ` | [Take Action](${dashboardUrl}/alerts/${alert._id})`;
            }
        }

        markdown += `\n\n*Alert ID: ${alert._id}*`;

        return markdown;
    }

    /**
     * Format alert as Linear issue
     */
    static formatIssueFromAlert(alert: IAlert, dashboardUrl?: string): { title: string; description: string } {
        const severityEmoji = this.getSeverityEmoji(alert.severity);
        const title = `${severityEmoji} [${alert.severity.toUpperCase()}] ${alert.title}`;
        
        let description = `${alert.message}\n\n`;
        description += `**Alert Type:** ${this.formatAlertType(alert.type)}\n`;
        description += `**Severity:** ${alert.severity.toUpperCase()}\n`;
        description += `**Created:** ${new Date(alert.createdAt).toISOString()}\n\n`;

        // Add type-specific details
        if (alert.type === 'cost_threshold' || alert.type === 'cost') {
            if (alert.data.currentValue !== undefined && alert.data.threshold !== undefined) {
                const percentage = alert.data.percentage || 
                    ((alert.data.currentValue / alert.data.threshold) * 100);
                description += `## Cost Details\n\n`;
                description += `- Current: ${formatCurrency(alert.data.currentValue)}\n`;
                description += `- Threshold: ${formatCurrency(alert.data.threshold)}\n`;
                description += `- Usage: ${percentage.toFixed(1)}%\n`;
            }
        } else if (alert.type === 'optimization_available' || alert.type === 'optimization') {
            if (alert.data.potentialSavings !== undefined) {
                description += `## Savings Opportunity\n\n`;
                description += `Potential savings: ${formatCurrency(alert.data.potentialSavings)}\n`;
            }
        }

        if (dashboardUrl) {
            description += `\n\n[View Details in CostKatana](${dashboardUrl}/alerts/${alert._id})`;
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
     * Test Linear integration
     */
    static async testIntegration(
        accessToken: string,
        teamId: string
    ): Promise<{ success: boolean; message: string; responseTime: number }> {
        const startTime = Date.now();
        
        try {
            // Try to fetch team details as a test
            const query = `
                query($teamId: String!) {
                    team(id: $teamId) {
                        id
                        name
                        key
                    }
                }
            `;

            const data = await this.executeQuery<{ team: { id: string; name: string; key: string } | null }>(
                accessToken,
                query,
                { teamId }
            );

            const responseTime = Date.now() - startTime;

            if (!data.team) {
                throw new Error('Team not found');
            }

            return {
                success: true,
                message: `Successfully connected to Linear team: ${data.team.name}`,
                responseTime
            };
        } catch (error: any) {
            const responseTime = Date.now() - startTime;
            return {
                success: false,
                message: error.message || 'Failed to test Linear connection',
                responseTime
            };
        }
    }
}

