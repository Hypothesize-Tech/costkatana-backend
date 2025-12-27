/**
 * MongoDB Atlas Vector Search Index Configurations for Memory Vectorization
 * 
 * This file contains configurations for creating vector search indexes
 * for UserMemory, ConversationMemory, and Message models.
 * 
 * These indexes must be created manually in MongoDB Atlas or via MongoDB CLI.
 * 
 * IMPORTANT: Indexes must be created before vector search functionality will work.
 */

export const MEMORY_VECTOR_INDEX_CONFIGS = {
  
  // UserMemory Vector Search Index
  usermemory_semantic_index: {
    name: "usermemory_semantic_index",
    type: "vectorSearch",
    definition: {
      fields: [
        {
          type: "vector",
          path: "semanticEmbedding",
          numDimensions: 1024,
          similarity: "cosine"
        },
        {
          type: "filter",
          path: "userId"
        },
        {
          type: "filter",
          path: "memoryType"
        },
        {
          type: "filter",
          path: "isActive"
        },
        {
          type: "filter",
          path: "createdAt"
        }
      ]
    }
  },

  // ConversationMemory Vector Search Index
  conversation_semantic_index: {
    name: "conversation_semantic_index",
    type: "vectorSearch",
    definition: {
      fields: [
        {
          type: "vector",
          path: "queryEmbedding",
          numDimensions: 1024,
          similarity: "cosine"
        },
        {
          type: "filter",
          path: "userId"
        },
        {
          type: "filter",
          path: "conversationId"
        },
        {
          type: "filter",
          path: "isArchived"
        },
        {
          type: "filter",
          path: "createdAt"
        }
      ]
    }
  },

  // Message Vector Search Index (for selected high-value messages only)
  message_semantic_index: {
    name: "message_semantic_index",
    type: "vectorSearch",
    definition: {
      fields: [
        {
          type: "vector",
          path: "semanticEmbedding",
          numDimensions: 1024,
          similarity: "cosine"
        },
        {
          type: "filter",
          path: "sessionId"
        },
        {
          type: "filter",
          path: "role"
        },
        {
          type: "filter",
          path: "isVectorized"
        },
        {
          type: "filter",
          path: "timestamp"
        }
      ]
    }
  }
};

/**
 * MongoDB Shell Commands to create the vector search indexes
 * 
 * Run these commands in MongoDB Shell (mongosh) or MongoDB Compass:
 * 
 * IMPORTANT: Replace 'your_database_name' with your actual database name
 */

export const MONGODB_INDEX_COMMANDS = `
// ============================================================================
// UserMemory Vector Search Index
// ============================================================================
db.usermemories.createSearchIndex({
  "name": "usermemory_semantic_index",
  "type": "vectorSearch",
  "definition": {
    "fields": [
      {
        "type": "vector",
        "path": "semanticEmbedding",
        "numDimensions": 1024,
        "similarity": "cosine"
      },
      {
        "type": "filter",
        "path": "userId"
      },
      {
        "type": "filter",
        "path": "memoryType"
      },
      {
        "type": "filter",
        "path": "isActive"
      },
      {
        "type": "filter",
        "path": "createdAt"
      }
    ]
  }
});

// ============================================================================
// ConversationMemory Vector Search Index
// ============================================================================
db.conversationmemories.createSearchIndex({
  "name": "conversation_semantic_index",
  "type": "vectorSearch", 
  "definition": {
    "fields": [
      {
        "type": "vector",
        "path": "queryEmbedding",
        "numDimensions": 1024,
        "similarity": "cosine"
      },
      {
        "type": "filter",
        "path": "userId"
      },
      {
        "type": "filter",
        "path": "conversationId"
      },
      {
        "type": "filter",
        "path": "isArchived"
      },
      {
        "type": "filter",
        "path": "createdAt"
      }
    ]
  }
});

// ============================================================================
// Message Vector Search Index (for selected high-value messages only)
// ============================================================================
db.messages.createSearchIndex({
  "name": "message_semantic_index",
  "type": "vectorSearch",
  "definition": {
    "fields": [
      {
        "type": "vector",
        "path": "semanticEmbedding",
        "numDimensions": 1024,
        "similarity": "cosine"
      },
      {
        "type": "filter",
        "path": "sessionId"
      },
      {
        "type": "filter",
        "path": "role"
      },
      {
        "type": "filter",
        "path": "isVectorized"
      },
      {
        "type": "filter",
        "path": "timestamp"
      }
    ]
  }
});

// ============================================================================
// Verification Queries
// ============================================================================
// Check if indexes were created successfully:
db.usermemories.listSearchIndexes();
db.conversationmemories.listSearchIndexes();
db.messages.listSearchIndexes();

// Get index status:
db.usermemories.getSearchIndexes();
db.conversationmemories.getSearchIndexes();
db.messages.getSearchIndexes();
`;

/**
 * Utility function to get index configuration by model type
 */
export function getVectorIndexConfig(modelType: 'usermemory' | 'conversation' | 'message') {
  const indexMap: Record<string, keyof typeof MEMORY_VECTOR_INDEX_CONFIGS> = {
    'usermemory': 'usermemory_semantic_index',
    'conversation': 'conversation_semantic_index',
    'message': 'message_semantic_index'
  };
  
  const indexKey = indexMap[modelType];
  return indexKey ? MEMORY_VECTOR_INDEX_CONFIGS[indexKey] : null;
}

/**
 * Get all vector index configurations
 */
export function getAllVectorIndexConfigs() {
  return MEMORY_VECTOR_INDEX_CONFIGS;
}

/**
 * Validate index configuration before creation
 */
export function validateIndexConfig(config: typeof MEMORY_VECTOR_INDEX_CONFIGS[keyof typeof MEMORY_VECTOR_INDEX_CONFIGS]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (!config.name || config.name.trim().length === 0) {
    errors.push('Index name is required');
  }
  
  if (config.type !== 'vectorSearch') {
    errors.push('Index type must be "vectorSearch"');
  }
  
  const vectorField = config.definition.fields.find(f => f.type === 'vector');
  if (!vectorField) {
    errors.push('At least one vector field is required');
  } else {
    if (vectorField.numDimensions !== 1024) {
      errors.push('Vector dimensions must be 1024 for Amazon Titan v2');
    }
    if (vectorField.similarity !== 'cosine') {
      errors.push('Similarity metric should be "cosine" for semantic search');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}