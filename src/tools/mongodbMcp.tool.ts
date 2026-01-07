import { Tool } from '@langchain/core/tools';
import { MongoDBMCPService, MCPToolResult } from '../services/mongodbMcp.service';
import { MongoDBConnection } from '../models/MongoDBConnection';
import { loggingService } from '../services/logging.service';
import { MongoDBResultFormatterService } from '../services/mongodbResultFormatter.service';

/**
 * LangChain tool wrappers for MongoDB MCP operations
 * These tools allow the main agent to interact with MongoDB databases
 */

/**
 * Base MongoDB Tool
 */
abstract class BaseMongoDBTool extends Tool {
    protected userId: string;
    protected connectionId?: string;

    constructor(userId: string, connectionId?: string) {
        super();
        this.userId = userId;
        this.connectionId = connectionId;
    }

    protected async getMCPService(): Promise<MongoDBMCPService> {
        if (!this.connectionId) {
            throw new Error('No MongoDB connection configured for this user');
        }

        const connection = await MongoDBConnection.findOne({
            _id: this.connectionId,
            userId: this.userId,
            isActive: true,
        });

        if (!connection) {
            throw new Error('MongoDB connection not found or inactive');
        }

        return new MongoDBMCPService({
            userId: this.userId,
            connectionId: this.connectionId,
            transport: 'http',
        });
    }

    protected async executeTool(toolName: string, args: any): Promise<string> {
        try {
            const mcpService = await this.getMCPService();
            const result: MCPToolResult = await (mcpService as any).handleToolCall(toolName, args);

            if (result.isError) {
                return `Error: ${result.content[0]?.text || 'Unknown error'}`;
            }

            // Format result for readability
            const formatted = MongoDBResultFormatterService.formatForChat(result);
            return formatted.markdown || JSON.stringify(formatted.data, null, 2);
        } catch (error) {
            loggingService.error('MongoDB tool execution failed', {
                component: 'BaseMongoDBTool',
                operation: 'executeTool',
                toolName,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
}

/**
 * Find documents in MongoDB collection
 */
export class MongoDBFindTool extends BaseMongoDBTool {
    name = 'mongodb_find';
    description = `Query MongoDB documents from a collection. 
Input should be a JSON string with format:
{
  "collection": "collection_name",
  "query": { "field": "value" },
  "limit": 10,
  "sort": { "field": 1 }
}`;

    async _call(input: string): Promise<string> {
        try {
            const args = JSON.parse(input);
            return await this.executeTool('find', args);
        } catch (error) {
            return `Error parsing input or executing query: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
}

/**
 * Aggregate data in MongoDB collection
 */
export class MongoDBAggregateTool extends BaseMongoDBTool {
    name = 'mongodb_aggregate';
    description = `Run aggregation pipeline on MongoDB collection.
Input should be a JSON string with format:
{
  "collection": "collection_name",
  "pipeline": [{ "$match": {...} }, { "$group": {...} }]
}`;

    async _call(input: string): Promise<string> {
        try {
            const args = JSON.parse(input);
            return await this.executeTool('aggregate', args);
        } catch (error) {
            return `Error parsing input or executing aggregation: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
}

/**
 * Count documents in MongoDB collection
 */
export class MongoDBCountTool extends BaseMongoDBTool {
    name = 'mongodb_count';
    description = `Count documents in a MongoDB collection.
Input should be a JSON string with format:
{
  "collection": "collection_name",
  "query": { "field": "value" }
}`;

    async _call(input: string): Promise<string> {
        try {
            const args = JSON.parse(input);
            return await this.executeTool('count', args);
        } catch (error) {
            return `Error parsing input or counting documents: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
}

/**
 * List all collections in MongoDB database
 */
export class MongoDBListCollectionsTool extends BaseMongoDBTool {
    name = 'mongodb_list_collections';
    description = `List all collections in the MongoDB database.
Input should be an empty object: {}`;

    async _call(input: string): Promise<string> {
        try {
            // If input is not empty, parse it (could support future options)
            let args = {};
            if (input && input.trim() !== '') {
                try {
                    args = JSON.parse(input);
                } catch (parseErr) {
                    return `Error parsing input: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`;
                }
            }
            return await this.executeTool('listCollections', args);
        } catch (error) {
            return `Error listing collections: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
}

/**
 * Analyze schema of MongoDB collection
 */
export class MongoDBSchemaAnalyzerTool extends BaseMongoDBTool {
    name = 'mongodb_analyze_schema';
    description = `Analyze the schema/structure of a MongoDB collection.
Input should be a JSON string with format:
{
  "collection": "collection_name",
  "sampleSize": 100
}`;

    async _call(input: string): Promise<string> {
        try {
            const args = JSON.parse(input);
            return await this.executeTool('analyzeSchema', args);
        } catch (error) {
            return `Error analyzing schema: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
}

/**
 * Explain query execution plan
 */
export class MongoDBExplainQueryTool extends BaseMongoDBTool {
    name = 'mongodb_explain_query';
    description = `Get execution plan for a MongoDB query to understand performance.
Input should be a JSON string with format:
{
  "collection": "collection_name",
  "query": { "field": "value" }
}`;

    async _call(input: string): Promise<string> {
        try {
            const args = JSON.parse(input);
            return await this.executeTool('explainQuery', args);
        } catch (error) {
            return `Error explaining query: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
}

/**
 * Get collection statistics
 */
export class MongoDBCollectionStatsTool extends BaseMongoDBTool {
    name = 'mongodb_collection_stats';
    description = `Get detailed statistics for a MongoDB collection.
Input should be a JSON string with format:
{
  "collection": "collection_name"
}`;

    async _call(input: string): Promise<string> {
        try {
            const args = JSON.parse(input);
            return await this.executeTool('collectionStats', args);
        } catch (error) {
            return `Error getting collection stats: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
}

/**
 * List indexes on a collection
 */
export class MongoDBListIndexesTool extends BaseMongoDBTool {
    name = 'mongodb_list_indexes';
    description = `List all indexes on a MongoDB collection.
Input should be a JSON string with format:
{
  "collection": "collection_name"
}`;

    async _call(input: string): Promise<string> {
        try {
            const args = JSON.parse(input);
            return await this.executeTool('listIndexes', args);
        } catch (error) {
            return `Error listing indexes: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
}

/**
 * Get database statistics
 */
export class MongoDBDatabaseStatsTool extends BaseMongoDBTool {
    name = 'mongodb_database_stats';
    description = `Get statistics for the entire MongoDB database.
Input should be an empty object: {}`;

    async _call(input: string): Promise<string> {
        try {
            const args = input && input.trim() ? JSON.parse(input) : {};
            return await this.executeTool('getDatabaseStats', args);
        } catch (error) {
            return `Error getting database stats: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
}

/**
 * Suggest indexes for optimization
 */
export class MongoDBSuggestIndexesTool extends BaseMongoDBTool {
    name = 'mongodb_suggest_indexes';
    description = `Get AI-powered index suggestions for optimizing a MongoDB collection.
Input should be a JSON string with format:
{
  "collection": "collection_name"
}`;

    async _call(input: string): Promise<string> {
        try {
            const args = JSON.parse(input);
            return await this.executeTool('suggestIndexes', args);
        } catch (error) {
            return `Error suggesting indexes: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
}

/**
 * Factory function to create MongoDB tools for a user
 */
export function createMongoDBTools(userId: string, connectionId?: string): Tool[] {
    return [
        new MongoDBFindTool(userId, connectionId),
        new MongoDBAggregateTool(userId, connectionId),
        new MongoDBCountTool(userId, connectionId),
        new MongoDBListCollectionsTool(userId, connectionId),
        new MongoDBSchemaAnalyzerTool(userId, connectionId),
        new MongoDBExplainQueryTool(userId, connectionId),
        new MongoDBCollectionStatsTool(userId, connectionId),
        new MongoDBListIndexesTool(userId, connectionId),
        new MongoDBDatabaseStatsTool(userId, connectionId),
        new MongoDBSuggestIndexesTool(userId, connectionId),
    ];
}
