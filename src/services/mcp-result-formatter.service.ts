/**
 * MCP Result Formatter Service
 * Formats MCP tool results for consistent frontend display
 */

import { MCPToolResponse } from '../mcp/types/standard-response';
import { loggingService } from './logging.service';

export interface FormattedResult {
    type: 'table' | 'json' | 'schema' | 'stats' | 'text' | 'list' | 'card' | 'markdown';
    data: any;
    metadata?: {
        count?: number;
        columns?: string[];
        title?: string;
        description?: string;
    };
}

export class MCPResultFormatterService {
    /**
     * Format MongoDB MCP results
     */
    static formatMongoDBResult(mcpResponse: MCPToolResponse): FormattedResult {
        try {
            if (!mcpResponse.success || !mcpResponse.data) {
                return {
                    type: 'text',
                    data: mcpResponse.error?.message || 'No data available',
                };
            }

            const operation = mcpResponse.metadata.operation;
            const data = mcpResponse.data;

            switch (operation) {
                case 'mongodb_find':
                case 'mongodb_aggregate':
                    return this.formatMongoDBQueryResult(data);
                
                case 'mongodb_analyze_schema':
                    return this.formatMongoDBSchemaResult(data);
                
                case 'mongodb_get_stats':
                    return this.formatMongoDBStatsResult(data);
                
                case 'mongodb_insert':
                case 'mongodb_update':
                case 'mongodb_delete':
                    return this.formatMongoDBMutationResult(data, operation);
                
                default:
                    return {
                        type: 'json',
                        data: data,
                    };
            }
        } catch (error) {
            loggingService.error('Failed to format MongoDB result', {
                error: error instanceof Error ? error.message : String(error),
            });
            return {
                type: 'text',
                data: 'Error formatting result',
            };
        }
    }

    /**
     * Format GitHub MCP results
     */
    static formatGitHubResult(mcpResponse: MCPToolResponse): FormattedResult {
        try {
            if (!mcpResponse.success || !mcpResponse.data) {
                return {
                    type: 'text',
                    data: mcpResponse.error?.message || 'No data available',
                };
            }

            const operation = mcpResponse.metadata.operation;
            const data = mcpResponse.data;

            switch (operation) {
                case 'github_list_repos':
                    return {
                        type: 'list',
                        data: data.map((repo: any) => ({
                            title: repo.full_name,
                            description: repo.description,
                            url: repo.html_url,
                            metadata: {
                                stars: repo.stargazers_count,
                                language: repo.language,
                                private: repo.private,
                            },
                        })),
                        metadata: {
                            count: data.length,
                            title: 'GitHub Repositories',
                        },
                    };

                case 'github_create_pr':
                case 'github_create_issue':
                    return {
                        type: 'card',
                        data: {
                            title: data.title,
                            description: data.body,
                            url: data.html_url,
                            state: data.state,
                            number: data.number,
                            author: data.user?.login,
                            created: data.created_at,
                        },
                        metadata: {
                            title: operation === 'github_create_pr' ? 'Pull Request Created' : 'Issue Created',
                        },
                    };

                case 'github_list_prs':
                case 'github_list_issues':
                    return {
                        type: 'table',
                        data: data.map((item: any) => ({
                            Number: `#${item.number}`,
                            Title: item.title,
                            State: item.state,
                            Author: item.user?.login,
                            Created: new Date(item.created_at).toLocaleDateString(),
                        })),
                        metadata: {
                            columns: ['Number', 'Title', 'State', 'Author', 'Created'],
                            count: data.length,
                            title: operation === 'github_list_prs' ? 'Pull Requests' : 'Issues',
                        },
                    };

                default:
                    return {
                        type: 'json',
                        data: data,
                    };
            }
        } catch (error) {
            loggingService.error('Failed to format GitHub result', {
                error: error instanceof Error ? error.message : String(error),
            });
            return {
                type: 'text',
                data: 'Error formatting result',
            };
        }
    }

    /**
     * Format Vercel MCP results
     */
    static formatVercelResult(mcpResponse: MCPToolResponse): FormattedResult {
        try {
            if (!mcpResponse.success || !mcpResponse.data) {
                return {
                    type: 'text',
                    data: mcpResponse.error?.message || 'No data available',
                };
            }

            const operation = mcpResponse.metadata.operation;
            const data = mcpResponse.data;

            switch (operation) {
                case 'vercel_deploy_project':
                    return {
                        type: 'card',
                        data: {
                            title: 'Deployment Created',
                            url: data.url,
                            state: data.state,
                            id: data.id,
                            created: data.createdAt,
                            target: data.target,
                        },
                        metadata: {
                            title: 'Vercel Deployment',
                            description: `Deployment ${data.state}`,
                        },
                    };

                case 'vercel_list_deployments':
                    return {
                        type: 'table',
                        data: data.map((deployment: any) => ({
                            ID: deployment.id.substring(0, 8),
                            URL: deployment.url,
                            State: deployment.state,
                            Target: deployment.target,
                            Created: new Date(deployment.createdAt).toLocaleDateString(),
                        })),
                        metadata: {
                            columns: ['ID', 'URL', 'State', 'Target', 'Created'],
                            count: data.length,
                            title: 'Vercel Deployments',
                        },
                    };

                case 'vercel_get_deployment_logs':
                    return {
                        type: 'markdown',
                        data: '```\n' + data.logs.join('\n') + '\n```',
                        metadata: {
                            title: 'Deployment Logs',
                        },
                    };

                default:
                    return {
                        type: 'json',
                        data: data,
                    };
            }
        } catch (error) {
            loggingService.error('Failed to format Vercel result', {
                error: error instanceof Error ? error.message : String(error),
            });
            return {
                type: 'text',
                data: 'Error formatting result',
            };
        }
    }

    /**
     * Format Google MCP results
     */
    static formatGoogleResult(mcpResponse: MCPToolResponse): FormattedResult {
        try {
            if (!mcpResponse.success || !mcpResponse.data) {
                return {
                    type: 'text',
                    data: mcpResponse.error?.message || 'No data available',
                };
            }

            const operation = mcpResponse.metadata.operation;
            const data = mcpResponse.data;

            switch (operation) {
                case 'google_drive_list_files':
                    return {
                        type: 'table',
                        data: data.files.map((file: any) => ({
                            Name: file.name,
                            Type: file.mimeType.split('.').pop(),
                            Modified: new Date(file.modifiedTime).toLocaleDateString(),
                            Size: this.formatFileSize(file.size),
                            Owner: file.owners?.[0]?.displayName,
                        })),
                        metadata: {
                            columns: ['Name', 'Type', 'Modified', 'Size', 'Owner'],
                            count: data.files.length,
                            title: 'Google Drive Files',
                        },
                    };

                case 'google_sheets_read':
                    return {
                        type: 'table',
                        data: data.values,
                        metadata: {
                            title: 'Google Sheets Data',
                            count: data.values?.length || 0,
                        },
                    };

                case 'google_docs_create':
                    return {
                        type: 'card',
                        data: {
                            title: data.title,
                            url: data.webViewLink,
                            id: data.documentId,
                            created: new Date().toISOString(),
                        },
                        metadata: {
                            title: 'Document Created',
                            description: 'Google Docs document created successfully',
                        },
                    };

                default:
                    return {
                        type: 'json',
                        data: data,
                    };
            }
        } catch (error) {
            loggingService.error('Failed to format Google result', {
                error: error instanceof Error ? error.message : String(error),
            });
            return {
                type: 'text',
                data: 'Error formatting result',
            };
        }
    }

    /**
     * Generic formatter
     */
    static formatResult(integration: string, mcpResponse: MCPToolResponse): FormattedResult {
        switch (integration) {
            case 'mongodb':
                return this.formatMongoDBResult(mcpResponse);
            case 'github':
                return this.formatGitHubResult(mcpResponse);
            case 'vercel':
                return this.formatVercelResult(mcpResponse);
            case 'google':
                return this.formatGoogleResult(mcpResponse);
            default:
                return {
                    type: 'json',
                    data: mcpResponse.data,
                };
        }
    }

    /**
     * Helper: Format MongoDB query result
     */
    private static formatMongoDBQueryResult(data: any): FormattedResult {
        if (!data.documents || data.documents.length === 0) {
            return {
                type: 'text',
                data: 'No documents found',
            };
        }

        // Extract columns from first document
        const firstDoc = data.documents[0];
        const columns = Object.keys(firstDoc).filter(key => key !== '__v');

        // Format for table display
        const tableData = data.documents.map((doc: any) => {
            const row: any = {};
            columns.forEach(col => {
                const value = doc[col];
                if (value instanceof Date) {
                    row[col] = value.toLocaleDateString();
                } else if (typeof value === 'object' && value !== null) {
                    row[col] = JSON.stringify(value);
                } else {
                    row[col] = value;
                }
            });
            return row;
        });

        return {
            type: 'table',
            data: tableData,
            metadata: {
                columns,
                count: data.count || data.documents.length,
                title: 'Query Results',
            },
        };
    }

    /**
     * Helper: Format MongoDB schema result
     */
    private static formatMongoDBSchemaResult(data: any): FormattedResult {
        return {
            type: 'schema',
            data: data.schema,
            metadata: {
                title: 'Collection Schema',
                count: data.sampleSize,
            },
        };
    }

    /**
     * Helper: Format MongoDB stats result
     */
    private static formatMongoDBStatsResult(data: any): FormattedResult {
        return {
            type: 'stats',
            data: {
                'Document Count': data.count,
                'Average Document Size': this.formatFileSize(data.avgObjSize),
                'Total Size': this.formatFileSize(data.size),
                'Storage Size': this.formatFileSize(data.storageSize),
                'Indexes': data.nindexes,
                'Index Size': this.formatFileSize(data.totalIndexSize),
            },
            metadata: {
                title: 'Collection Statistics',
            },
        };
    }

    /**
     * Helper: Format MongoDB mutation result
     */
    private static formatMongoDBMutationResult(data: any, operation: string): FormattedResult {
        let message = '';
        
        switch (operation) {
            case 'mongodb_insert':
                message = `Inserted ${data.insertedCount || 1} document(s)`;
                break;
            case 'mongodb_update':
                message = `Updated ${data.modifiedCount || 0} document(s)`;
                break;
            case 'mongodb_delete':
                message = `Deleted ${data.deletedCount || 0} document(s)`;
                break;
        }

        return {
            type: 'text',
            data: message,
            metadata: {
                title: 'Operation Result',
            },
        };
    }

    /**
     * Helper: Format file size
     */
    private static formatFileSize(bytes?: number): string {
        if (!bytes) return 'N/A';
        
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        if (bytes === 0) return '0 Bytes';
        
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }
}