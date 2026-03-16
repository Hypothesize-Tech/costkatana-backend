import { Injectable } from '@nestjs/common';

export interface IntegrationFormatResult {
  type:
    | 'table'
    | 'json'
    | 'schema'
    | 'stats'
    | 'chart'
    | 'error'
    | 'empty'
    | 'text'
    | 'explain'
    | 'list';
  data: any;
  message?: string;
}

@Injectable()
export class IntegrationFormatterService {
  async formatMongoDBResult(result: {
    metadata: any;
    data: any;
  }): Promise<IntegrationFormatResult> {
    try {
      const { data, metadata } = result;

      if (!data || (Array.isArray(data) && data.length === 0)) {
        return {
          type: 'empty',
          data: [],
          message: 'No data found',
        };
      }

      // Determine best format based on data structure
      if (
        metadata.operation === 'mongodb_find' ||
        metadata.operation === 'mongodb_aggregate'
      ) {
        if (Array.isArray(data)) {
          if (data.length === 1 && typeof data[0] === 'object') {
            // Single document - show as formatted object
            return {
              type: 'json',
              data: data[0],
              message: `Found 1 document`,
            };
          } else if (data.length > 1) {
            // Multiple documents - show as table
            return {
              type: 'table',
              data: data,
              message: `Found ${data.length} documents`,
            };
          }
        }
      }

      if (metadata.operation === 'mongodb_insert') {
        return {
          type: 'text',
          data: { insertedCount: data.insertedCount || 0 },
          message: `Successfully inserted ${data.insertedCount || 0} document(s)`,
        };
      }

      if (metadata.operation === 'mongodb_update') {
        return {
          type: 'text',
          data: { modifiedCount: data.modifiedCount || 0 },
          message: `Successfully updated ${data.modifiedCount || 0} document(s)`,
        };
      }

      if (metadata.operation === 'mongodb_delete') {
        return {
          type: 'text',
          data: { deletedCount: data.deletedCount || 0 },
          message: `Successfully deleted ${data.deletedCount || 0} document(s)`,
        };
      }

      // Default fallback
      return {
        type: 'json',
        data: data,
        message: 'Operation completed',
      };
    } catch (error) {
      return {
        type: 'error',
        data: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        message: 'Error formatting MongoDB result',
      };
    }
  }

  async formatGitHubResult(result: {
    metadata: any;
    data: any;
  }): Promise<IntegrationFormatResult> {
    try {
      const { data, metadata } = result;

      if (!data || (Array.isArray(data) && data.length === 0)) {
        return {
          type: 'empty',
          data: [],
          message: 'No repositories found',
        };
      }

      if (metadata.operation === 'github_list_repos') {
        if (Array.isArray(data)) {
          return {
            type: 'list',
            data: data.map((repo) => ({
              name: repo.name,
              full_name: repo.full_name,
              description: repo.description,
              language: repo.language,
              stars: repo.stargazers_count,
              private: repo.private,
              url: repo.html_url,
            })),
            message: `Found ${data.length} repositories`,
          };
        }
      }

      // Default GitHub result
      return {
        type: 'json',
        data: data,
        message: 'GitHub operation completed',
      };
    } catch (error) {
      return {
        type: 'error',
        data: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        message: 'Error formatting GitHub result',
      };
    }
  }

  async formatVercelResult(result: {
    metadata: any;
    data: any;
  }): Promise<IntegrationFormatResult> {
    try {
      const { data, metadata } = result;

      if (!data) {
        return {
          type: 'empty',
          data: {},
          message: 'No Vercel data available',
        };
      }

      if (metadata.operation === 'vercel_deploy') {
        return {
          type: 'text',
          data: {
            deploymentUrl: data.deploymentUrl,
            status: data.status,
            buildTime: data.buildTime,
          },
          message: `Deployment ${data.status}: ${data.deploymentUrl || 'URL not available'}`,
        };
      }

      return {
        type: 'json',
        data: data,
        message: 'Vercel operation completed',
      };
    } catch (error) {
      return {
        type: 'error',
        data: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        message: 'Error formatting Vercel result',
      };
    }
  }

  async formatGoogleResult(result: {
    metadata: any;
    data: any;
  }): Promise<IntegrationFormatResult> {
    try {
      const { data, metadata } = result;

      if (!data) {
        return {
          type: 'empty',
          data: {},
          message: 'No Google data available',
        };
      }

      // Handle different Google services
      if (metadata.operation?.includes('sheets')) {
        return {
          type: 'table',
          data: data.values || data,
          message: 'Google Sheets data retrieved',
        };
      }

      if (metadata.operation?.includes('docs')) {
        return {
          type: 'text',
          data: { content: data.content || data.body },
          message: 'Google Docs content retrieved',
        };
      }

      return {
        type: 'json',
        data: data,
        message: 'Google operation completed',
      };
    } catch (error) {
      return {
        type: 'error',
        data: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        message: 'Error formatting Google result',
      };
    }
  }

  async formatAWSResult(result: {
    metadata: any;
    data: any;
  }): Promise<IntegrationFormatResult> {
    try {
      const { data, metadata } = result;

      if (!data) {
        return {
          type: 'empty',
          data: {},
          message: 'No AWS data available',
        };
      }

      // Handle different AWS services
      if (metadata.operation?.includes('bedrock')) {
        return {
          type: 'text',
          data: data,
          message: 'AWS Bedrock operation completed',
        };
      }

      if (metadata.operation?.includes('s3')) {
        return {
          type: 'list',
          data: Array.isArray(data) ? data : [data],
          message: 'S3 objects retrieved',
        };
      }

      if (metadata.operation?.includes('ec2')) {
        return {
          type: 'table',
          data: Array.isArray(data) ? data : [data],
          message: 'EC2 instances retrieved',
        };
      }

      return {
        type: 'json',
        data: data,
        message: 'AWS operation completed',
      };
    } catch (error) {
      return {
        type: 'error',
        data: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        message: 'Error formatting AWS result',
      };
    }
  }

  async formatSlackResult(result: {
    metadata: any;
    data: any;
  }): Promise<IntegrationFormatResult> {
    try {
      const { data, metadata } = result;

      if (!data) {
        return {
          type: 'empty',
          data: {},
          message: 'No Slack data available',
        };
      }

      if (metadata.operation?.includes('channels')) {
        return {
          type: 'list',
          data: Array.isArray(data) ? data : [data],
          message: `Found ${Array.isArray(data) ? data.length : 1} Slack channels`,
        };
      }

      if (metadata.operation?.includes('messages')) {
        return {
          type: 'list',
          data: Array.isArray(data) ? data : [data],
          message: 'Slack messages retrieved',
        };
      }

      return {
        type: 'json',
        data: data,
        message: 'Slack operation completed',
      };
    } catch (error) {
      return {
        type: 'error',
        data: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        message: 'Error formatting Slack result',
      };
    }
  }

  async formatDiscordResult(result: {
    metadata: any;
    data: any;
  }): Promise<IntegrationFormatResult> {
    try {
      const { data, metadata } = result;

      if (!data) {
        return {
          type: 'empty',
          data: {},
          message: 'No Discord data available',
        };
      }

      if (metadata.operation?.includes('channels')) {
        return {
          type: 'list',
          data: Array.isArray(data) ? data : [data],
          message: `Found ${Array.isArray(data) ? data.length : 1} Discord channels`,
        };
      }

      return {
        type: 'json',
        data: data,
        message: 'Discord operation completed',
      };
    } catch (error) {
      return {
        type: 'error',
        data: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        message: 'Error formatting Discord result',
      };
    }
  }

  async formatJiraResult(result: {
    metadata: any;
    data: any;
  }): Promise<IntegrationFormatResult> {
    try {
      const { data, metadata } = result;

      if (!data) {
        return {
          type: 'empty',
          data: {},
          message: 'No Jira data available',
        };
      }

      if (metadata.operation?.includes('issues')) {
        return {
          type: 'list',
          data: Array.isArray(data) ? data : [data],
          message: `Found ${Array.isArray(data) ? data.length : 1} Jira issues`,
        };
      }

      return {
        type: 'json',
        data: data,
        message: 'Jira operation completed',
      };
    } catch (error) {
      return {
        type: 'error',
        data: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        message: 'Error formatting Jira result',
      };
    }
  }

  async formatLinearResult(result: {
    metadata: any;
    data: any;
  }): Promise<IntegrationFormatResult> {
    try {
      const { data, metadata } = result;

      if (!data) {
        return {
          type: 'empty',
          data: {},
          message: 'No Linear data available',
        };
      }

      if (metadata.operation?.includes('issues')) {
        return {
          type: 'list',
          data: Array.isArray(data) ? data : [data],
          message: `Found ${Array.isArray(data) ? data.length : 1} Linear issues`,
        };
      }

      return {
        type: 'json',
        data: data,
        message: 'Linear operation completed',
      };
    } catch (error) {
      return {
        type: 'error',
        data: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        message: 'Error formatting Linear result',
      };
    }
  }
}
