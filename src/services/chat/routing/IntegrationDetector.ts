/**
 * Integration Detector
 * Detects integration intent from user messages
 */

import { IntegrationType } from '@mcp/types/permission.types';
import { IntegrationIntent } from './types/routing.types';
import { BedrockService } from '@services/tracedBedrock.service';
import { loggingService } from '@services/logging.service';

export class IntegrationDetector {
    /**
     * Detect if message requires integration tools
     */
    static async detect(message: string, userId: string): Promise<IntegrationIntent> {
        try {
            // Use AI to analyze the message
            const prompt = `Analyze this user message and determine if it requires integration with external tools:

Message: "${message}"

Available integrations: Vercel, GitHub, Google (Drive/Docs/Sheets), MongoDB, Slack, Discord, Jira, Linear, AWS

Return a JSON response with:
{
  "needsIntegration": boolean,
  "integrations": ["integration1", "integration2"],
  "suggestedTools": ["tool1", "tool2"],
  "confidence": number (0-1)
}

Only suggest integrations if the message clearly requires them.`;

            const response = await BedrockService.invokeModel(
                prompt,
                'global.anthropic.claude-haiku-4-5-20251001-v1:0',
                { recentMessages: [{ role: 'user', content: prompt }] }
            );

            try {
                const result = JSON.parse(response);
                return {
                    needsIntegration: result.needsIntegration || false,
                    integrations: result.integrations || [],
                    suggestedTools: result.suggestedTools || [],
                    confidence: result.confidence || 0.5,
                };
            } catch (parseError) {
                // Fallback to keyword matching
                return this.detectWithKeywords(message);
            }
        } catch (error) {
            loggingService.error('Failed to detect integration intent', {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });

            // Fallback to keyword matching
            return this.detectWithKeywords(message);
        }
    }

    /**
     * Keyword-based detection fallback
     */
    static detectWithKeywords(message: string): IntegrationIntent {
        const lowerMessage = message.toLowerCase();
        const integrations: IntegrationType[] = [];
        const suggestedTools: string[] = [];

        // Check for Vercel keywords
        if (lowerMessage.match(/\b(deploy|deployment|vercel|hosting|build\s+log)/)) {
            integrations.push('vercel');
            if (lowerMessage.includes('deploy')) suggestedTools.push('vercel_deploy_project');
            if (lowerMessage.includes('log')) suggestedTools.push('vercel_get_deployment_logs');
        }

        // Check for GitHub keywords
        if (lowerMessage.match(/\b(github|pull\s+request|pr|issue|branch|commit|repository|merge)/)) {
            integrations.push('github');
            if (lowerMessage.match(/\b(create|new)\s+(pull\s+request|pr)/)) suggestedTools.push('github_create_pr');
            if (lowerMessage.match(/\b(create|new)\s+issue/)) suggestedTools.push('github_create_issue');
            if (lowerMessage.match(/\blist\s+(pr|pull\s+request)/)) suggestedTools.push('github_list_prs');
        }

        // Check for Google keywords
        if (lowerMessage.match(/\b(google|drive|docs|sheets|gmail|calendar|workspace)/)) {
            integrations.push('google');
            if (lowerMessage.includes('drive')) suggestedTools.push('google_drive_list_files');
            if (lowerMessage.includes('sheet')) suggestedTools.push('google_sheets_read');
            if (lowerMessage.includes('doc')) suggestedTools.push('google_docs_create');
        }

        // Check for MongoDB keywords
        if (lowerMessage.match(/\b(mongodb|database|collection|query|find|aggregate|insert|update|delete)\b/)) {
            integrations.push('mongodb');
            if (lowerMessage.includes('find') || lowerMessage.includes('query')) suggestedTools.push('mongodb_find');
            if (lowerMessage.includes('insert')) suggestedTools.push('mongodb_insert');
            if (lowerMessage.includes('update')) suggestedTools.push('mongodb_update');
            if (lowerMessage.includes('delete')) suggestedTools.push('mongodb_delete');
            if (lowerMessage.includes('aggregate')) suggestedTools.push('mongodb_aggregate');
        }

        // Check for Slack keywords
        if (lowerMessage.match(/\b(slack|channel|notify)/)) {
            integrations.push('slack');
            suggestedTools.push('slack_send_message');
        }

        // Check for Discord keywords
        if (lowerMessage.match(/\b(discord|server)/)) {
            integrations.push('discord');
            suggestedTools.push('discord_send_message');
        }

        // Check for Jira keywords
        if (lowerMessage.match(/\b(jira|ticket|epic|sprint)/)) {
            integrations.push('jira');
            if (lowerMessage.match(/\b(create|new)\s+(ticket|issue)/)) suggestedTools.push('jira_create_issue');
        }

        // Check for Linear keywords
        if (lowerMessage.match(/\b(linear|cycle)/)) {
            integrations.push('linear');
            if (lowerMessage.match(/\b(create|new)\s+issue/)) suggestedTools.push('linear_create_issue');
        }

        // Check for AWS keywords
        if (lowerMessage.match(/\b(aws|s3|ec2|lambda|cloudformation)/)) {
            integrations.push('aws');
        }

        return {
            needsIntegration: integrations.length > 0,
            integrations: integrations as IntegrationType[],
            suggestedTools,
            confidence: integrations.length > 0 ? 0.8 : 0.0,
        };
    }
}
