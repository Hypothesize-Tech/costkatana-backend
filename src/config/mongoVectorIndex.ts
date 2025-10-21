/**
 * MongoDB Atlas Vector Search Index Configuration
 * 
 * This file contains the configuration for setting up MongoDB Atlas Vector Search.
 * The index must be created manually in MongoDB Atlas or via MongoDB CLI.
 */

export const VECTOR_SEARCH_INDEX_CONFIG = {
    name: process.env.MONGODB_VECTOR_INDEX_NAME || 'document_vector_index',
    type: 'vectorSearch',
    definition: {
        fields: [
            {
                type: 'vector',
                path: 'embedding',
                numDimensions: 1024, // Amazon Titan Embed Text v2 dimensions (1024 by default)
                similarity: 'cosine' // or 'euclidean', 'dotProduct'
            },
            // Filter fields for pre-filtering before vector search
            {
                type: 'filter',
                path: 'metadata.userId'
            },
            {
                type: 'filter',
                path: 'metadata.source'
            },
            {
                type: 'filter',
                path: 'metadata.projectId'
            },
            {
                type: 'filter',
                path: 'metadata.conversationId'
            },
            {
                type: 'filter',
                path: 'metadata.tags'
            },
            {
                type: 'filter',
                path: 'status'
            },
            {
                type: 'filter',
                path: 'createdAt'
            }
        ]
    }
};

/**
 * MongoDB Shell Command to create the vector search index
 * 
 * Run this in MongoDB Shell (mongosh) or MongoDB Compass:
 * 
 * ```javascript
 * db.documents.createSearchIndex({
 *   "name": "document_vector_index",
 *   "type": "vectorSearch",
 *   "definition": {
 *     "fields": [
 *       {
 *         "type": "vector",
 *         "path": "embedding",
 *         "numDimensions": 1024,
 *         "similarity": "cosine"
 *       },
 *       {
 *         "type": "filter",
 *         "path": "metadata.userId"
 *       },
 *       {
 *         "type": "filter",
 *         "path": "metadata.source"
 *       },
 *       {
 *         "type": "filter",
 *         "path": "metadata.projectId"
 *       },
 *       {
 *         "type": "filter",
 *         "path": "metadata.conversationId"
 *       },
 *       {
 *         "type": "filter",
 *         "path": "metadata.tags"
 *       },
 *       {
 *         "type": "filter",
 *         "path": "status"
 *       },
 *       {
 *         "type": "filter",
 *         "path": "createdAt"
 *       }
 *     ]
 *   }
 * });
 * ```
 */

/**
 * MongoDB Atlas UI Instructions:
 * 
 * 1. Log into MongoDB Atlas (https://cloud.mongodb.com)
 * 2. Navigate to your cluster
 * 3. Click on "Search" tab
 * 4. Click "Create Search Index"
 * 5. Select "JSON Editor"
 * 6. Choose database and collection: `documents`
 * 7. Paste the index configuration from VECTOR_SEARCH_INDEX_CONFIG
 * 8. Click "Create Search Index"
 * 
 * Note: It may take a few minutes for the index to build
 */

/**
 * Verify index creation
 * 
 * ```javascript
 * db.documents.getSearchIndexes()
 * ```
 */

export const getVectorIndexStatus = async () => {
    try {
        const mongoose = await import('mongoose');
        const db = mongoose.connection.db;
        
        if (!db) {
            return {
                status: 'disconnected',
                message: 'Database not connected'
            };
        }

        // Note: Search indexes are not accessible via standard MongoDB driver
        // They must be checked via Atlas API or UI
        return {
            status: 'unknown',
            message: 'Vector search indexes must be verified in MongoDB Atlas UI or via Atlas API',
            indexName: VECTOR_SEARCH_INDEX_CONFIG.name
        };
    } catch (error) {
        return {
            status: 'error',
            message: error instanceof Error ? error.message : 'Unknown error',
            indexName: VECTOR_SEARCH_INDEX_CONFIG.name
        };
    }
};

/**
 * Atlas API example for programmatic index creation
 * (Requires Atlas API key)
 */
export const ATLAS_API_EXAMPLE = `
curl --request POST \\
  --url "https://cloud.mongodb.com/api/atlas/v2/groups/{groupId}/clusters/{clusterName}/search/indexes" \\
  --header "Content-Type: application/json" \\
  --header "Authorization: Bearer {apiKey}" \\
  --data '{
    "collectionName": "documents",
    "database": "your-database-name",
    "name": "document_vector_index",
    "type": "vectorSearch",
    "definition": {
      "fields": [
        {
          "type": "vector",
          "path": "embedding",
          "numDimensions": 1024,
          "similarity": "cosine"
        },
        {
          "type": "filter",
          "path": "metadata.userId"
        },
        {
          "type": "filter",
          "path": "metadata.source"
        }
      ]
    }
  }'
`;

export default VECTOR_SEARCH_INDEX_CONFIG;

