import { Tool } from "@langchain/core/tools";
import mongoose from 'mongoose';

interface MongoQuery {
    collection: string;
    operation: 'find' | 'aggregate' | 'count';
    query?: any;
    options?: any;
    pipeline?: any[];
    limit?: number;
}

export class MongoDbReaderTool extends Tool {
    name = "mongodb_reader";
    description = `Query the MongoDB database for cost and usage information. This tool provides READ-ONLY access to:
    - Usage data and patterns
    - Cost analytics and trends  
    - Project information
    - Optimization history
    - Alert configurations
    
    Input should be a JSON string with: 
    {{
        "collection": "usages|projects|optimizations|alerts|users|prompttemplates",
        "operation": "find|aggregate|count",
        "query": {{...}}, // MongoDB query object
        "options": {{...}}, // Additional options like sort, limit
        "pipeline": [...], // For aggregation operations
        "limit": number // Max results (default: 100)
    }}
    
    IMPORTANT: This tool is READ-ONLY and cannot modify data.`;

    private readonly allowedCollections = [
        'usages',
        'projects', 
        'optimizations',
        'alerts',
        'users',
        'prompttemplates',
        'activities',
        'conversations',
        'chatmessages',
        'qualityscores',
        'tips'
    ];

    private readonly allowedOperations = ['find', 'aggregate', 'count'];

    async _call(input: string): Promise<string> {
        try {
            // Log the input for debugging
            console.log('MongoDB Reader received input:', input.substring(0, 200) + (input.length > 200 ? '...' : ''));
            
            if (!input || input.trim().length === 0) {
                return "Error: Empty input provided. Please provide a valid JSON query.";
            }
            
            if (input.trim() === '{') {
                return "Error: Incomplete JSON input received. Please provide a complete JSON object with collection, operation, and other required fields.";
            }
            
            const queryData: MongoQuery = JSON.parse(input);
            
            // Security validations
            if (!this.isValidQuery(queryData)) {
                return "Invalid query: Check collection name, operation, and parameters.";
            }

            const collection = mongoose.connection.collection(queryData.collection);
            const limit = Math.min(queryData.limit || 100, 500); // Max 500 records

            let result: any;
            
            // Define fields to exclude for security
            const excludeFields = {
                password: 0,
                encryptedKey: 0,
                resetPasswordToken: 0,
                verificationToken: 0,
                keyId: 0,
                maskedKey: 0,
                __v: 0
            };

            switch (queryData.operation) {
                case 'find':
                    result = await collection
                        .find(queryData.query || {}, {
                            ...queryData.options,
                            projection: { ...excludeFields, ...queryData.options?.projection }
                        })
                        .limit(limit)
                        .toArray();
                    
                    // Clean and format results - remove MongoDB ObjectIds and sensitive data
                    result = result.map((doc: any) => {
                        const cleanDoc = { ...doc };
                        
                        // Convert _id to readable id
                        if (cleanDoc._id) {
                            cleanDoc.id = cleanDoc._id.toString();
                            delete cleanDoc._id;
                        }
                        
                        // Convert other ObjectIds to strings for readability
                        Object.keys(cleanDoc).forEach(key => {
                            if (cleanDoc[key] && cleanDoc[key].constructor && cleanDoc[key].constructor.name === 'ObjectId') {
                                cleanDoc[key] = cleanDoc[key].toString();
                            }
                        });
                        
                        // Remove any remaining sensitive fields
                        ['password', 'encryptedKey', 'resetPasswordToken', 'verificationToken', '__v'].forEach(field => {
                            delete cleanDoc[field];
                        });
                        
                        return cleanDoc;
                    });
                    break;

                case 'aggregate':
                    if (!queryData.pipeline) {
                        return "Aggregation operation requires a pipeline.";
                    }
                    // Add limit to pipeline if not present
                    if (!queryData.pipeline.some(stage => '$limit' in stage)) {
                        queryData.pipeline.push({ $limit: limit });
                    }
                    result = await collection.aggregate(queryData.pipeline).toArray();
                    
                    // Clean aggregate results - remove ObjectIds
                    result = result.map((doc: any) => {
                        const cleanDoc = { ...doc };
                        
                        // Convert _id to readable format if present
                        if (cleanDoc._id && typeof cleanDoc._id === 'object') {
                            if (cleanDoc._id.constructor.name === 'ObjectId') {
                                delete cleanDoc._id; // Remove ObjectId completely from aggregates
                            } else {
                                // For grouped results, clean any ObjectIds in the _id field
                                Object.keys(cleanDoc._id).forEach(key => {
                                    if (cleanDoc._id[key] && cleanDoc._id[key].constructor && cleanDoc._id[key].constructor.name === 'ObjectId') {
                                        cleanDoc._id[key] = `[ID-${key}]`; // Generic placeholder
                                    }
                                });
                            }
                        }
                        
                        return cleanDoc;
                    });
                    break;

                case 'count':
                    result = await collection.countDocuments(queryData.query || {});
                    break;

                default:
                    return "Unsupported operation.";
            }

            // Format response
            if (queryData.operation === 'count') {
                return `Count: ${result}`;
            }

            if (!result || result.length === 0) {
                return `No results found in ${queryData.collection} collection.`;
            }

            // Return formatted JSON with metadata
            return JSON.stringify({
                collection: queryData.collection,
                operation: queryData.operation,
                count: Array.isArray(result) ? result.length : 1,
                data: result
            }, null, 2);

        } catch (error) {
            console.error('MongoDB query failed:', error);
            
            if (error instanceof SyntaxError) {
                return `Invalid JSON input. Please provide a valid single-line JSON query. Example: {"collection": "usages", "operation": "find", "query": {"userId": "user-id"}, "limit": 10}`;
            }
            
            return `Database query error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    private isValidQuery(queryData: MongoQuery): boolean {
        // Check required fields
        if (!queryData.collection || !queryData.operation) {
            return false;
        }

        // Check allowed collections
        if (!this.allowedCollections.includes(queryData.collection)) {
            return false;
        }

        // Check allowed operations
        if (!this.allowedOperations.includes(queryData.operation)) {
            return false;
        }

        // Additional security checks
        if (queryData.query && typeof queryData.query !== 'object') {
            return false;
        }

        // Check for dangerous operations in queries
        const queryStr = JSON.stringify(queryData.query || {});
        const dangerousOperations = ['$eval', '$where', '$function', '$accumulator'];
        
        for (const op of dangerousOperations) {
            if (queryStr.includes(op)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Helper method to get collection statistics
     */
    async getCollectionStats(): Promise<string> {
        try {
            const stats: any = {};
            
            for (const collectionName of this.allowedCollections) {
                try {
                    const collection = mongoose.connection.collection(collectionName);
                    const count = await collection.countDocuments();
                    stats[collectionName] = count;
                } catch (error) {
                    stats[collectionName] = 'Error';
                }
            }

            return JSON.stringify(stats, null, 2);
        } catch (error) {
            return `Error getting collection stats: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }
} 