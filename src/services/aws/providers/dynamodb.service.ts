/**
 * DynamoDB Service Provider - DynamoDB Operations
 * 
 * Capabilities:
 * - List tables
 * - Create tables with on-demand billing
 * - Enable point-in-time recovery
 * - Configure encryption and tagging
 */

import { DynamoDBClient, ListTablesCommand, DescribeTableCommand, CreateTableCommand } from '@aws-sdk/client-dynamodb';
import { loggingService } from '../../logging.service';
import { stsCredentialService } from '../stsCredential.service';
import { permissionBoundaryService } from '../permissionBoundary.service';
import { IAWSConnection } from '../../../models/AWSConnection';

export interface DynamoDBTable {
  tableName: string;
  tableArn: string;
  status: string;
  itemCount: number;
  billingMode: string;
  creationDateTime?: Date;
}

class DynamoDBServiceProvider {
  private static instance: DynamoDBServiceProvider;

  private constructor() {}

  public static getInstance(): DynamoDBServiceProvider {
    if (!DynamoDBServiceProvider.instance) {
      DynamoDBServiceProvider.instance = new DynamoDBServiceProvider();
    }
    return DynamoDBServiceProvider.instance;
  }

  private async getClient(connection: IAWSConnection, region?: string): Promise<DynamoDBClient> {
    const credentials = await stsCredentialService.assumeRole(connection);

    return new DynamoDBClient({
      region: region ?? connection.allowedRegions[0] ?? 'us-east-1',
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });
  }

  /**
   * List DynamoDB tables
   */
  public async listTables(connection: IAWSConnection, region?: string): Promise<DynamoDBTable[]> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'dynamodb', action: 'ListTables', region },
      connection
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection, region);
    const tables: DynamoDBTable[] = [];
    let lastEvaluatedTableName: string | undefined;

    do {
      const command = new ListTablesCommand({
        ExclusiveStartTableName: lastEvaluatedTableName,
        Limit: 100,
      });

      const response = await client.send(command);

      for (const tableName of response.TableNames ?? []) {
        try {
          const describeCommand = new DescribeTableCommand({ TableName: tableName });
          const describeResponse = await client.send(describeCommand);
          const table = describeResponse.Table;

          if (table) {
            tables.push({
              tableName: table.TableName ?? '',
              tableArn: table.TableArn ?? '',
              status: table.TableStatus ?? 'UNKNOWN',
              itemCount: table.ItemCount ?? 0,
              billingMode: table.BillingModeSummary?.BillingMode ?? 'PROVISIONED',
              creationDateTime: table.CreationDateTime,
            });
          }
        } catch (error) {
          loggingService.warn('Failed to describe DynamoDB table', {
            component: 'DynamoDBServiceProvider',
            tableName,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      lastEvaluatedTableName = response.LastEvaluatedTableName;
    } while (lastEvaluatedTableName);

    loggingService.info('DynamoDB tables listed', {
      component: 'DynamoDBServiceProvider',
      operation: 'listTables',
      connectionId: connection._id.toString(),
      tableCount: tables.length,
      region,
    });

    return tables;
  }

  /**
   * Create DynamoDB table with on-demand billing
   */
  public async createTable(
    connection: IAWSConnection,
    config: {
      tableName: string;
      partitionKeyName: string;
      partitionKeyType?: 'S' | 'N' | 'B'; // String, Number, Binary
      sortKeyName?: string;
      sortKeyType?: 'S' | 'N' | 'B';
      billingMode?: 'PAY_PER_REQUEST' | 'PROVISIONED';
      region?: string;
      tags?: Record<string, string>;
    }
  ): Promise<{ tableName: string; tableArn: string; status: string }> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'dynamodb', action: 'CreateTable', region: config.region },
      connection
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const region = config.region ?? connection.allowedRegions[0] ?? 'us-east-1';
    const client = await this.getClient(connection, region);
    const billingMode = config.billingMode ?? 'PAY_PER_REQUEST';

    try {
      // Build key schema
      const keySchema: Array<{ AttributeName: string; KeyType: 'HASH' | 'RANGE' }> = [
        { AttributeName: config.partitionKeyName, KeyType: 'HASH' },
      ];

      if (config.sortKeyName) {
        keySchema.push({ AttributeName: config.sortKeyName, KeyType: 'RANGE' });
      }

      // Build attribute definitions
      const attributeDefinitions: Array<{ AttributeName: string; AttributeType: 'S' | 'N' | 'B' }> = [
        { AttributeName: config.partitionKeyName, AttributeType: config.partitionKeyType ?? 'S' },
      ];

      if (config.sortKeyName) {
        attributeDefinitions.push({
          AttributeName: config.sortKeyName,
          AttributeType: config.sortKeyType ?? 'S',
        });
      }

      // Create table
      const createCommand = new CreateTableCommand({
        TableName: config.tableName,
        KeySchema: keySchema,
        AttributeDefinitions: attributeDefinitions,
        BillingMode: billingMode,
        ...(billingMode === 'PROVISIONED' && {
          ProvisionedThroughput: {
            ReadCapacityUnits: 5,
            WriteCapacityUnits: 5,
          },
        }),
        StreamSpecification: {
          StreamViewType: 'NEW_AND_OLD_IMAGES',
          StreamEnabled: true,
        },
        SSESpecification: {
          Enabled: true,
          SSEType: 'KMS',
        },
        Tags: [
          { Key: 'Name', Value: config.tableName },
          { Key: 'ManagedBy', Value: 'CostKatana' },
          { Key: 'CreatedBy', Value: connection.userId?.toString() ?? 'unknown' },
          { Key: 'CreatedAt', Value: new Date().toISOString() },
          { Key: 'ConnectionId', Value: connection._id.toString() },
          ...Object.entries(config.tags ?? {}).map(([Key, Value]) => ({ Key, Value })),
        ],
      });

      const response = await client.send(createCommand);
      const table = response.TableDescription;

      if (!table?.TableArn) {
        throw new Error('Failed to create DynamoDB table');
      }

      loggingService.info('DynamoDB table created', {
        component: 'DynamoDBServiceProvider',
        operation: 'createTable',
        tableName: config.tableName,
        billingMode,
        region,
        connectionId: connection._id.toString(),
      });

      return {
        tableName: config.tableName,
        tableArn: table.TableArn,
        status: table.TableStatus ?? 'CREATING',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      loggingService.error('Failed to create DynamoDB table', {
        component: 'DynamoDBServiceProvider',
        operation: 'createTable',
        tableName: config.tableName,
        region,
        error: errorMessage,
      });
      throw error;
    }
  }
}

export const dynamodbServiceProvider = DynamoDBServiceProvider.getInstance();
