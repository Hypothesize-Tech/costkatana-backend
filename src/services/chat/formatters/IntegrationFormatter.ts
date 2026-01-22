/**
 * Integration Result Formatter
 * Centralized formatting for all integration results (MongoDB, GitHub, Vercel, Google, Slack, Discord, Jira, Linear, AWS)
 */

import { loggingService } from '../../logging.service';
import { MCPResult, FormattedResult } from '../types/formatter.types';

export class IntegrationFormatter {
    /**
     * Format MongoDB MCP result
     */
    static async formatMongoDBResult(mcpResult: MCPResult): Promise<FormattedResult> {
        try {
            // Determine format type based on the operation
            let formatType: 'table' | 'json' | 'schema' | 'stats' | 'text' = 'json';
            
            if (mcpResult.metadata?.operation === 'mongodb_find') {
                formatType = 'table';
            } else if (mcpResult.metadata?.operation === 'mongodb_analyze_schema') {
                formatType = 'schema';
            } else if (mcpResult.metadata?.operation === 'mongodb_get_stats') {
                formatType = 'stats';
            }

            return {
                type: formatType,
                data: mcpResult.data,
            };
        } catch (error) {
            loggingService.error('Failed to format MongoDB result', {
                error: error instanceof Error ? error.message : String(error),
            });
            return { type: 'json', data: mcpResult.data };
        }
    }

    /**
     * Format GitHub MCP results for display
     */
    static async formatGitHubResult(mcpResult: MCPResult): Promise<FormattedResult> {
        try {
            const operation = mcpResult.metadata?.operation;
            const data = mcpResult.data as any;

            // Handle github_list_repos - GitHub API returns array directly
            if (operation === 'github_list_repos') {
                const repos = Array.isArray(data) ? data : (data?.repositories || []);
                if (repos.length > 0) {
                    return {
                        type: 'list',
                        data: {
                            items: repos.map((repo: any) => {
                                // Ensure we have a proper GitHub web URL
                                let githubUrl = repo.html_url;
                                if (!githubUrl && repo.url) {
                                    // Convert API URL to web URL if needed
                                    if (repo.url.includes('api.github.com')) {
                                        githubUrl = repo.url.replace('api.github.com/repos', 'github.com');
                                    } else if (!repo.url.startsWith('http')) {
                                        // If it's a relative URL or just the repo path
                                        githubUrl = `https://github.com/${repo.full_name || repo.name}`;
                                    } else {
                                        githubUrl = repo.url;
                                    }
                                } else if (!githubUrl) {
                                    // Fallback to constructing URL from repo name
                                    githubUrl = `https://github.com/${repo.full_name || repo.name}`;
                                }
                                
                                return {
                                    id: repo.id,
                                    title: repo.full_name || repo.name,
                                    description: repo.description || 'No description',
                                    url: githubUrl, // Use the corrected web URL
                                    html_url: githubUrl, // Also provide as html_url for consistency
                                    metadata: {
                                        language: repo.language,
                                        stars: repo.stargazers_count,
                                        private: repo.private,
                                        updated: repo.updated_at,
                                    },
                                };
                            }),
                            count: repos.length,
                            title: 'GitHub Repositories',
                        },
                    };
                }
            }

            // Handle github_list_issues
            if (operation === 'github_list_issues') {
                const issues = Array.isArray(data) ? data : (data?.issues || []);
                if (issues.length > 0) {
                    return {
                        type: 'list',
                        data: {
                            items: issues.map((issue: any) => ({
                                id: issue.number,
                                title: `#${issue.number}: ${issue.title}`,
                                description: issue.body,
                                url: issue.html_url,
                                metadata: {
                                    state: issue.state,
                                    assignee: issue.assignee?.login,
                                    labels: issue.labels?.map((l: any) => l.name).join(', '),
                                },
                            })),
                            count: issues.length,
                            title: 'GitHub Issues',
                        },
                    };
                }
            }

            // Handle github_list_prs
            if (operation === 'github_list_prs') {
                const prs = Array.isArray(data) ? data : (data?.pullRequests || []);
                if (prs.length > 0) {
                    return {
                        type: 'list',
                        data: {
                            items: prs.map((pr: any) => ({
                                id: pr.number,
                                title: `#${pr.number}: ${pr.title}`,
                                description: pr.body,
                                url: pr.html_url,
                                metadata: {
                                    state: pr.state,
                                    mergeable: pr.mergeable_state,
                                    head: pr.head?.ref,
                                    base: pr.base?.ref,
                                },
                            })),
                            count: prs.length,
                            title: 'Pull Requests',
                        },
                    };
                }
            }

            // Default format for other operations
            return {
                type: 'json',
                data: mcpResult.data,
            };
        } catch (error) {
            loggingService.error('Failed to format GitHub result', {
                error: error instanceof Error ? error.message : String(error),
            });
            return { type: 'json', data: mcpResult.data };
        }
    }

    /**
     * Format Vercel MCP results for display
     */
    static async formatVercelResult(mcpResult: MCPResult): Promise<FormattedResult> {
        try {
            const operation = mcpResult.metadata?.operation;
            const data = mcpResult.data as any;

            if (operation === 'vercel_list_deployments' && data?.deployments) {
                return {
                    type: 'list',
                    data: {
                        items: data.deployments.map((deployment: any) => ({
                            id: deployment.uid,
                            title: deployment.name,
                            description: `${deployment.state} - ${deployment.target || 'production'}`,
                            url: deployment.url,
                            metadata: {
                                state: deployment.state,
                                created: deployment.created,
                                creator: deployment.creator?.username,
                            },
                        })),
                        count: data.count || data.deployments.length,
                        title: 'Vercel Deployments',
                    },
                };
            }

            if (operation === 'vercel_list_projects' && data?.projects) {
                return {
                    type: 'list',
                    data: {
                        items: data.projects.map((project: any) => ({
                            id: project.id,
                            title: project.name,
                            description: project.framework || 'No framework',
                            url: `https://vercel.com/${project.accountId}/${project.name}`,
                            metadata: {
                                framework: project.framework,
                                updated: project.updatedAt,
                            },
                        })),
                        count: data.count || data.projects.length,
                        title: 'Vercel Projects',
                    },
                };
            }

            return { type: 'json', data: mcpResult.data };
        } catch (error) {
            loggingService.error('Failed to format Vercel result', {
                error: error instanceof Error ? error.message : String(error),
            });
            return { type: 'json', data: mcpResult.data };
        }
    }

    /**
     * Format Google MCP results for display
     */
    static async formatGoogleResult(mcpResult: MCPResult): Promise<FormattedResult> {
        try {
            const operation = mcpResult.metadata?.operation;
            const data = mcpResult.data as any;

            if (operation === 'drive_list_files' && data?.files) {
                return {
                    type: 'list',
                    data: {
                        items: data.files.map((file: any) => ({
                            id: file.id,
                            title: file.name,
                            description: file.mimeType,
                            url: file.webViewLink,
                            metadata: {
                                size: file.size,
                                modified: file.modifiedTime,
                                mimeType: file.mimeType,
                            },
                        })),
                        count: data.count || data.files.length,
                        title: 'Google Drive Files',
                    },
                };
            }

            if (operation === 'sheets_list_spreadsheets' && data?.spreadsheets) {
                return {
                    type: 'list',
                    data: {
                        items: data.spreadsheets.map((sheet: any) => ({
                            id: sheet.id,
                            title: sheet.name,
                            description: 'Google Spreadsheet',
                            url: sheet.webViewLink,
                            metadata: {
                                modified: sheet.modifiedTime,
                            },
                        })),
                        count: data.count || data.spreadsheets.length,
                        title: 'Google Sheets',
                    },
                };
            }

            return { type: 'json', data: mcpResult.data };
        } catch (error) {
            loggingService.error('Failed to format Google result', {
                error: error instanceof Error ? error.message : String(error),
            });
            return { type: 'json', data: mcpResult.data };
        }
    }

    /**
     * Format Slack MCP results for display
     */
    static async formatSlackResult(mcpResult: MCPResult): Promise<FormattedResult> {
        try {
            const operation = mcpResult.metadata?.operation;
            const data = mcpResult.data as any;

            if (operation === 'slack_list_channels' && data?.channels) {
                return {
                    type: 'list',
                    data: {
                        items: data.channels.map((channel: any) => ({
                            id: channel.id,
                            title: `#${channel.name}`,
                            description: channel.purpose?.value || 'No description',
                            metadata: {
                                members: channel.num_members,
                                private: channel.is_private,
                            },
                        })),
                        count: data.count || data.channels.length,
                        title: 'Slack Channels',
                    },
                };
            }

            if (operation === 'slack_list_users' && data?.members) {
                return {
                    type: 'list',
                    data: {
                        items: data.members.map((user: any) => ({
                            id: user.id,
                            title: user.real_name || user.name,
                            description: user.profile?.title || 'Team member',
                            metadata: {
                                username: user.name,
                                status: user.profile?.status_text,
                            },
                        })),
                        count: data.count || data.members.length,
                        title: 'Slack Users',
                    },
                };
            }

            return { type: 'json', data: mcpResult.data };
        } catch (error) {
            loggingService.error('Failed to format Slack result', {
                error: error instanceof Error ? error.message : String(error),
            });
            return { type: 'json', data: mcpResult.data };
        }
    }

    /**
     * Format Discord MCP results for display
     */
    static async formatDiscordResult(mcpResult: MCPResult): Promise<FormattedResult> {
        try {
            const operation = mcpResult.metadata?.operation;
            const data = mcpResult.data as any;

            if (operation === 'discord_list_channels' && data?.channels) {
                return {
                    type: 'list',
                    data: {
                        items: data.channels.map((channel: any) => ({
                            id: channel.id,
                            title: channel.name,
                            description: channel.topic || 'No topic',
                            metadata: {
                                type: channel.type === 0 ? 'Text' : 'Voice',
                                position: channel.position,
                            },
                        })),
                        count: data.count || data.channels.length,
                        title: 'Discord Channels',
                    },
                };
            }

            if (operation === 'discord_list_users' && data?.members) {
                return {
                    type: 'list',
                    data: {
                        items: data.members.map((member: any) => ({
                            id: member.user?.id,
                            title: member.nick || member.user?.username,
                            description: member.user?.discriminator ? `#${member.user.discriminator}` : 'Member',
                            metadata: {
                                roles: member.roles?.length || 0,
                                joined: member.joined_at,
                            },
                        })),
                        count: data.count || data.members.length,
                        title: 'Discord Members',
                    },
                };
            }

            return { type: 'json', data: mcpResult.data };
        } catch (error) {
            loggingService.error('Failed to format Discord result', {
                error: error instanceof Error ? error.message : String(error),
            });
            return { type: 'json', data: mcpResult.data };
        }
    }

    /**
     * Format Jira MCP results for display
     */
    static async formatJiraResult(mcpResult: MCPResult): Promise<FormattedResult> {
        try {
            const operation = mcpResult.metadata?.operation;
            const data = mcpResult.data as any;

            if (operation === 'jira_list_issues' && data?.issues) {
                return {
                    type: 'list',
                    data: {
                        items: data.issues.map((issue: any) => ({
                            id: issue.key,
                            title: `${issue.key}: ${issue.fields?.summary}`,
                            description: issue.fields?.description?.content?.[0]?.content?.[0]?.text || 'No description',
                            url: issue.self,
                            metadata: {
                                status: issue.fields?.status?.name,
                                priority: issue.fields?.priority?.name,
                                assignee: issue.fields?.assignee?.displayName,
                                type: issue.fields?.issuetype?.name,
                            },
                        })),
                        count: data.total || data.issues.length,
                        title: 'Jira Issues',
                    },
                };
            }

            if (operation === 'jira_list_projects' && data?.projects) {
                return {
                    type: 'list',
                    data: {
                        items: data.projects.map((project: any) => ({
                            id: project.id,
                            title: `${project.key}: ${project.name}`,
                            description: project.description || 'No description',
                            metadata: {
                                projectType: project.projectTypeKey,
                                lead: project.lead?.displayName,
                            },
                        })),
                        count: data.count || data.projects.length,
                        title: 'Jira Projects',
                    },
                };
            }

            return { type: 'json', data: mcpResult.data };
        } catch (error) {
            loggingService.error('Failed to format Jira result', {
                error: error instanceof Error ? error.message : String(error),
            });
            return { type: 'json', data: mcpResult.data };
        }
    }

    /**
     * Format Linear MCP results for display
     */
    static async formatLinearResult(mcpResult: MCPResult): Promise<FormattedResult> {
        try {
            const operation = mcpResult.metadata?.operation;
            const data = mcpResult.data as any;

            if (operation === 'linear_list_issues' && data?.issues) {
                return {
                    type: 'list',
                    data: {
                        items: data.issues.map((issue: any) => ({
                            id: issue.id,
                            title: issue.title,
                            description: issue.description || 'No description',
                            url: issue.url,
                            metadata: {
                                state: issue.state?.name,
                                priority: issue.priority,
                                assignee: issue.assignee?.name,
                                team: issue.team?.name,
                            },
                        })),
                        count: data.count || data.issues.length,
                        title: 'Linear Issues',
                    },
                };
            }

            if (operation === 'linear_list_projects' && data?.projects) {
                return {
                    type: 'list',
                    data: {
                        items: data.projects.map((project: any) => ({
                            id: project.id,
                            title: project.name,
                            description: project.description || 'No description',
                            metadata: {
                                state: project.state,
                                progress: project.progress,
                            },
                        })),
                        count: data.count || data.projects.length,
                        title: 'Linear Projects',
                    },
                };
            }

            if (operation === 'linear_list_teams' && data?.teams) {
                return {
                    type: 'list',
                    data: {
                        items: data.teams.map((team: any) => ({
                            id: team.id,
                            title: `${team.key}: ${team.name}`,
                            description: team.description || 'No description',
                            metadata: {
                                key: team.key,
                            },
                        })),
                        count: data.count || data.teams.length,
                        title: 'Linear Teams',
                    },
                };
            }

            return { type: 'json', data: mcpResult.data };
        } catch (error) {
            loggingService.error('Failed to format Linear result', {
                error: error instanceof Error ? error.message : String(error),
            });
            return { type: 'json', data: mcpResult.data };
        }
    }

    /**
     * Format AWS MCP results for display
     */
    static async formatAWSResult(mcpResult: MCPResult): Promise<FormattedResult> {
        try {
            const operation = mcpResult.metadata?.operation;
            const data = mcpResult.data as any;

            if (operation === 'aws_list_ec2' && data?.instances) {
                return {
                    type: 'list',
                    data: {
                        items: data.instances.map((instance: any) => ({
                            id: instance.instanceId,
                            title: instance.name || instance.instanceId,
                            description: instance.instanceType,
                            metadata: {
                                state: instance.state,
                                region: instance.region,
                                publicIp: instance.publicIp,
                            },
                        })),
                        count: data.count || data.instances.length,
                        title: 'EC2 Instances',
                    },
                };
            }

            if (operation === 'aws_list_s3' && data?.buckets) {
                return {
                    type: 'list',
                    data: {
                        items: data.buckets.map((bucket: any) => ({
                            id: bucket.name,
                            title: bucket.name,
                            description: `Created: ${bucket.creationDate}`,
                            metadata: {
                                region: bucket.region,
                            },
                        })),
                        count: data.count || data.buckets.length,
                        title: 'S3 Buckets',
                    },
                };
            }

            if (operation === 'aws_get_costs' && data?.costData) {
                return {
                    type: 'table',
                    data: data.costData,
                };
            }

            return { type: 'json', data: mcpResult.data };
        } catch (error) {
            loggingService.error('Failed to format AWS result', {
                error: error instanceof Error ? error.message : String(error),
            });
            return { type: 'json', data: mcpResult.data };
        }
    }
}
