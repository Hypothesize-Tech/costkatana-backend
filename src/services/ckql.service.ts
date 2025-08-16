
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { logger } from '../utils/logger';
import { embeddingsService } from './embeddings.service';
import { Telemetry } from '../models/Telemetry';

export interface CKQLQuery {
  naturalLanguage: string;
  mongoQuery: any;
  vectorSearch?: {
    embedding: number[];
    similarity: number;
  };
  explanation: string;
  suggestedFilters?: string[];
}

export interface CKQLResult {
  query: CKQLQuery;
  results: any[];
  totalCount: number;
  executionTime: number;
  insights: string[];
}

export class CKQLService {
  private static instance: CKQLService;
  private bedrockClient: BedrockRuntimeClient;

  private constructor() {
    this.bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_BEDROCK_REGION || 'us-east-1',
    });
  }

  static getInstance(): CKQLService {
    if (!CKQLService.instance) {
      CKQLService.instance = new CKQLService();
    }
    return CKQLService.instance;
  }

  /**
   * Parse natural language query into CKQL
   */
  async parseQuery(naturalLanguage: string, context?: {
    tenant_id?: string;
    workspace_id?: string;
    timeframe?: string;
  }): Promise<CKQLQuery> {
    try {
      const startTime = Date.now();

      // Use fallback approach if AI services are slow
      const timeoutMs = 10000; // 10 second timeout
      
      const parseWithTimeout = Promise.race([
        this.parseWithAI(naturalLanguage, context),
        new Promise<CKQLQuery>((_, reject) => 
          setTimeout(() => reject(new Error('AI parsing timeout')), timeoutMs)
        )
      ]);

      try {
        const result = await parseWithTimeout;
        logger.info(`CKQL query parsed with AI in ${Date.now() - startTime}ms`);
        return result;
      } catch (aiError) {
        logger.warn('AI parsing failed or timed out, using fallback:', aiError);
        return this.parseWithFallback(naturalLanguage, context);
      }
    } catch (error) {
      logger.error('Failed to parse CKQL query:', error);
      throw new Error(`CKQL parsing failed: ${error}`);
    }
  }

  private async parseWithAI(naturalLanguage: string, context?: any): Promise<CKQLQuery> {
    // Generate embedding for semantic search
    const embedding = await embeddingsService.generateEmbedding(naturalLanguage);

    // Use AI to convert natural language to MongoDB query
    const mongoQuery = await this.generateMongoQuery(naturalLanguage, context);

    // Generate explanation
    const explanation = await this.generateExplanation(naturalLanguage, mongoQuery);

    return {
      naturalLanguage,
      mongoQuery,
      vectorSearch: {
        embedding: embedding.embedding,
        similarity: 0.8 // Default similarity threshold
      },
      explanation,
      suggestedFilters: this.extractSuggestedFilters(naturalLanguage)
    };
  }

  private parseWithFallback(naturalLanguage: string, context?: any): CKQLQuery {
    // Simple pattern matching for common queries
    const mongoQuery = this.generateFallbackQuery(naturalLanguage, context);
    
    return {
      naturalLanguage,
      mongoQuery,
      explanation: `Simple pattern-based query for: "${naturalLanguage}"`,
      suggestedFilters: this.extractSuggestedFilters(naturalLanguage)
    };
  }

  private generateFallbackQuery(naturalLanguage: string, context?: any): any {
    const query: any = {};
    const lowerQuery = naturalLanguage.toLowerCase();

    // Add context filters
    if (context?.tenant_id) query.tenant_id = context.tenant_id;
    if (context?.workspace_id) query.workspace_id = context.workspace_id;

    // Time-based patterns
    if (lowerQuery.includes('today')) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      query.timestamp = { $gte: today };
    } else if (lowerQuery.includes('last hour')) {
      const lastHour = new Date();
      lastHour.setHours(lastHour.getHours() - 1);
      query.timestamp = { $gte: lastHour };
    } else if (lowerQuery.includes('last 24 hours')) {
      const last24h = new Date();
      last24h.setHours(last24h.getHours() - 24);
      query.timestamp = { $gte: last24h };
    }

    // Cost-based patterns
    if (lowerQuery.includes('expensive') || lowerQuery.includes('high cost')) {
      query.cost_usd = { $gte: 0.01 };
    } else if (lowerQuery.includes('cheap') || lowerQuery.includes('low cost')) {
      query.cost_usd = { $lt: 0.01 };
    }

    // Error patterns
    if (lowerQuery.includes('error') || lowerQuery.includes('failed')) {
      query.status = 'error';
    } else if (lowerQuery.includes('success')) {
      query.status = 'success';
    }

    // AI model patterns
    if (lowerQuery.includes('claude')) {
      query.gen_ai_model = { $regex: 'claude', $options: 'i' };
    } else if (lowerQuery.includes('gpt')) {
      query.gen_ai_model = { $regex: 'gpt', $options: 'i' };
    } else if (lowerQuery.includes('ai') || lowerQuery.includes('model')) {
      query.gen_ai_model = { $exists: true, $ne: null };
    }

    // Performance patterns
    if (lowerQuery.includes('slow') || lowerQuery.includes('latency')) {
      query.duration_ms = { $gte: 1000 };
    } else if (lowerQuery.includes('fast') || lowerQuery.includes('quick')) {
      query.duration_ms = { $lt: 500 };
    }

    // Similarity patterns
    if (lowerQuery.includes('similar') && lowerQuery.includes('cost')) {
      // For similarity queries about cost, find operations with significant cost
      query.cost_usd = { $gte: 0.0001 };
      if (!query.timestamp) {
        query.timestamp = { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }; // Last 24 hours
      }
    } else if (lowerQuery.includes('similar') && lowerQuery.includes('operation')) {
      // For similarity queries about operations, find common operations
      query.operation_name = { $in: ['gen_ai.chat.completions', 'http.get', 'http.post'] };
      if (!query.timestamp) {
        query.timestamp = { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }; // Last 24 hours
      }
    } else if (lowerQuery.includes('similar') || lowerQuery.includes('like') || lowerQuery.includes('pattern')) {
      // Generic similarity query - find recent operations with some activity
      if (!query.cost_usd && !query.duration_ms && !query.operation_name) {
        query.$or = [
          { cost_usd: { $gt: 0 } },
          { duration_ms: { $gt: 500 } },
          { operation_name: { $in: ['gen_ai.chat.completions', 'http.get', 'http.post'] } }
        ];
      }
      if (!query.timestamp) {
        query.timestamp = { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }; // Last 24 hours
      }
    }

    // If no specific patterns matched, add a default time filter
    if (Object.keys(query).length === 0 || (Object.keys(query).length === 2 && query.tenant_id && query.workspace_id)) {
      query.timestamp = { $gte: new Date(Date.now() - 60 * 60 * 1000) }; // Last hour
    }

    return query;
  }

  /**
   * Execute CKQL query
   */
  async executeQuery(query: CKQLQuery, options?: {
    limit?: number;
    offset?: number;
  }): Promise<CKQLResult> {
    const startTime = Date.now();
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    try {
      let results: any[] = [];
      let totalCount = 0;

      // Determine if we need vector search or traditional query
      const needsSemanticSearch = this.needsSemanticSearch(query.naturalLanguage);

      if (needsSemanticSearch && query.vectorSearch) {
        // Ensure vector search query is also safe
        const safeQuery = { ...query, mongoQuery: this.ensureSafeFindQuery(query.mongoQuery) };
        
        try {
          // Use MongoDB Atlas Vector Search
          const vectorResults = await this.executeVectorSearch(safeQuery, limit, offset);
          results = vectorResults;
          totalCount = results.length; // Vector search doesn't provide total count easily
          
          // If vector search returns no results, try fallback query
          if (results.length === 0) {
            logger.info('Vector search returned no results, trying fallback query');
            const fallbackQuery = this.generateFallbackQuery(query.naturalLanguage);
            const safeFilter = this.ensureSafeFindQuery(fallbackQuery);
            const mongoResults = await Telemetry.find(safeFilter)
              .sort({ timestamp: -1 })
              .limit(limit)
              .skip(offset)
              .lean();

            results = mongoResults;
            totalCount = await Telemetry.countDocuments(safeFilter);
          }
        } catch (vectorError) {
          logger.error('Vector search failed, falling back to regular search:', vectorError);
          // Fallback to regular MongoDB query with enhanced pattern matching
          const fallbackQuery = this.generateFallbackQuery(query.naturalLanguage);
          const safeFilter = this.ensureSafeFindQuery(fallbackQuery);
          const mongoResults = await Telemetry.find(safeFilter)
            .sort({ timestamp: -1 })
            .limit(limit)
            .skip(offset)
            .lean();

          results = mongoResults;
          totalCount = await Telemetry.countDocuments(safeFilter);
        }
      } else {
        // Final safety check: ensure no aggregation operators in find query
        const safeQuery = this.ensureSafeFindQuery(query.mongoQuery);
        
        // Use traditional MongoDB query
        const mongoResults = await Telemetry.find(safeQuery)
          .sort({ timestamp: -1 })
          .limit(limit)
          .skip(offset)
          .lean();

        results = mongoResults;
        totalCount = await Telemetry.countDocuments(safeQuery);
      }

      // Generate insights from results
      const insights = await this.generateInsights(query.naturalLanguage, results);

      const executionTime = Date.now() - startTime;

      return {
        query,
        results,
        totalCount,
        executionTime,
        insights
      };
    } catch (error) {
      logger.error('Failed to execute CKQL query:', error);
      throw new Error(`CKQL execution failed: ${error}`);
    }
  }

  /**
   * Generate MongoDB query from natural language
   */
  private async generateMongoQuery(naturalLanguage: string, context?: any): Promise<any> {
    const prompt = `Convert this natural language query about telemetry/cost data into a MongoDB FIND query (NOT aggregation).

Natural Language: "${naturalLanguage}"

CRITICAL RULES:
1. Return ONLY valid JSON for MongoDB find() method
2. Use ONLY find query operators: $gt, $gte, $lt, $lte, $eq, $ne, $in, $nin, $and, $or, $exists, $regex
3. NEVER use aggregation operators: $match, $group, $sort, $limit, $project, $lookup, $unwind, $facet, $bucket
4. NEVER use aggregation math operators: $avg, $sum, $max, $min, $add, $multiply, $subtract, $divide, $stdDevPop
5. NEVER use MongoDB shell functions: ISODate(), ObjectId(), new Date(), NumberLong()
6. NEVER use MongoDB variables: $$NOW, $$ROOT, $$CURRENT
7. NEVER use date operators: $hour, $dayOfWeek, $dateSubtract, $dateAdd, $dateToString
8. Use time placeholders: HOUR_AGO, DAY_AGO, WEEK_AGO, MONTH_AGO, TODAY_START
9. $or and $and must be arrays, not objects

Available fields:
- timestamp: Date (use time placeholders)
- operation_name: String (API operations)
- service_name: String
- duration_ms: Number (response time)
- cost_usd: Number (cost in dollars)
- status: Number/String (HTTP status)
- gen_ai_model: String
- http_method: String
- http_route: String
- error_message: String
- tenant_id: String
- workspace_id: String

${context ? `Additional context: ${JSON.stringify(context)}` : ''}

GOOD examples:
"expensive AI calls" → {"cost_usd": {"$gt": 0.01}, "gen_ai_model": {"$exists": true}}
"slow requests today" → {"duration_ms": {"$gt": 2000}, "timestamp": {"$gte": "TODAY_START"}}
"errors in the last hour" → {"status": {"$gte": 400}, "timestamp": {"$gte": "HOUR_AGO"}}
"high cost or slow" → {"$or": [{"cost_usd": {"$gt": 0.1}}, {"duration_ms": {"$gt": 1000}}]}
"recent and expensive" → {"$and": [{"timestamp": {"$gte": "HOUR_AGO"}}, {"cost_usd": {"$gt": 0.05}}]}

BAD examples (NEVER DO):
{"$match": {"cost_usd": {"$gt": 0.01}}} ❌ (aggregation)
{"timestamp": {"$gte": ISODate("2024-01-01")}} ❌ (shell function)
{"$or": {"0": {"cost": {"$gt": 0.1}}, "1": {"duration": {"$gt": 1000}}}} ❌ (object instead of array)
{"cost_usd": {"$gte": {"$avg": "$cost_usd"}}} ❌ (aggregation math)
{"timestamp": {"$gte": "$$NOW"}} ❌ (MongoDB variable)

Return ONLY the JSON query object:`;

    try {
      const modelId = process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';
      
      let requestBody;
      if (modelId.includes('nova')) {
        // Nova Pro format
        requestBody = JSON.stringify({
          messages: [{
            role: 'user',
            content: [{ text: prompt }]
          }],
          inferenceConfig: {
            max_new_tokens: 300,
            temperature: 0.1
          }
        });
      } else {
        // Claude format (fallback)
        requestBody = JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: prompt
          }]
        });
      }

      const command = new InvokeModelCommand({
        modelId,
        body: requestBody,
        contentType: 'application/json',
        accept: 'application/json'
      });

      const response = await this.executeWithRetry(command, 3);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      
      let queryText;
      if (modelId.includes('nova')) {
        // Nova Pro response format
        queryText = (responseBody.output?.message?.content?.[0]?.text || responseBody.output?.text || '').trim();
      } else {
        // Claude response format
        queryText = (responseBody.content?.[0]?.text || '').trim();
      }

                  // Clean the response text (remove markdown code blocks if present)
            let cleanedQueryText = queryText.trim();
            if (cleanedQueryText.startsWith('```json')) {
              cleanedQueryText = cleanedQueryText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
            } else if (cleanedQueryText.startsWith('```')) {
              cleanedQueryText = cleanedQueryText.replace(/^```\s*/, '').replace(/\s*```$/, '');
            }
            
            // Clean MongoDB shell syntax that's not valid JSON
            cleanedQueryText = this.cleanMongoShellSyntax(cleanedQueryText);
            
            // Additional aggressive cleaning for common AI mistakes
            cleanedQueryText = this.aggressiveQueryCleaning(cleanedQueryText);
            
            // Parse and process the query with error handling
            let mongoQuery;
            try {
              mongoQuery = JSON.parse(cleanedQueryText);
            } catch (parseError) {
              logger.error('JSON parse failed for cleaned query text:', {
                originalText: queryText,
                cleanedText: cleanedQueryText,
                error: parseError
              });
              // Try one more aggressive cleaning attempt
              const emergencyClean = this.emergencyQueryCleaning(cleanedQueryText);
              try {
                mongoQuery = JSON.parse(emergencyClean);
                logger.info('Emergency cleaning succeeded');
              } catch (emergencyError) {
                logger.error('Emergency cleaning also failed, using fallback');
                mongoQuery = { timestamp: { $gte: new Date(Date.now() - 3600000) } };
              }
            }

      // Fix malformed MongoDB query structures
      mongoQuery = this.fixMalformedQuery(mongoQuery);
      logger.debug('Query after malformed fix:', JSON.stringify(mongoQuery));

      // Fix data type casting issues
      mongoQuery = this.fixDataTypes(mongoQuery);
      logger.debug('Query after data type fix:', JSON.stringify(mongoQuery));

      // Process time-based placeholders
      mongoQuery = this.processTimeFilters(mongoQuery);
      logger.debug('Query after time processing:', JSON.stringify(mongoQuery));

      // Add context filters
      if (context?.tenant_id) {
        mongoQuery.tenant_id = context.tenant_id;
      }
      if (context?.workspace_id) {
        mongoQuery.workspace_id = context.workspace_id;
      }

      return mongoQuery;
    } catch (error) {
      logger.error('Failed to generate MongoDB query:', error);
      // Fallback to basic query
      return { timestamp: { $gte: new Date(Date.now() - 3600000) } };
    }
  }


  /**
   * Execute vector search using MongoDB Atlas Vector Search
   */
  private async executeVectorSearch(query: CKQLQuery, limit: number, offset: number): Promise<any[]> {
    try {
      // Ensure the filter is safe for vector search (no aggregation operators)
      const safeFilter = this.ensureSafeFindQuery(query.mongoQuery);
      
      // MongoDB Atlas Vector Search aggregation pipeline
      const pipeline = [
        {
          $vectorSearch: {
            index: "semantic_search_index",
            path: "semantic_embedding",
            queryVector: query.vectorSearch!.embedding,
            numCandidates: limit * 10, // Search more candidates for better results
            limit: limit + offset,
            filter: safeFilter // Use safe filter
          }
        },
        {
          $addFields: {
            score: { $meta: "vectorSearchScore" }
          }
        },
        {
          $match: {
            score: { $gte: query.vectorSearch!.similarity }
          }
        },
        {
          $skip: offset
        },
        {
          $limit: limit
        }
      ];

      const results = await Telemetry.aggregate(pipeline);
      return results;
    } catch (error) {
      logger.error('Vector search failed, falling back to regular search:', error);
      // Fallback to regular MongoDB query with safe filter
      const safeQuery = this.ensureSafeFindQuery(query.mongoQuery);
      return await Telemetry.find(safeQuery)
        .sort({ timestamp: -1 })
        .limit(limit)
        .skip(offset)
        .lean();
    }
  }

  /**
   * Generate explanation for the query
   */
  private async generateExplanation(naturalLanguage: string, mongoQuery: any): Promise<string> {
    try {
      const prompt = `Explain this database query in simple terms:

Natural Language: "${naturalLanguage}"
MongoDB Query: ${JSON.stringify(mongoQuery)}

Provide a 1-sentence explanation of what this query will find.`;

      const modelId = process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';
      
      let requestBody;
      if (modelId.includes('nova')) {
        // Nova Pro format
        requestBody = JSON.stringify({
          messages: [{
            role: 'user',
            content: [{ text: prompt }]
          }],
          inferenceConfig: {
            max_new_tokens: 100,
            temperature: 0.1
          }
        });
      } else {
        // Claude format (fallback)
        requestBody = JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 100,
          messages: [{
            role: 'user',
            content: prompt
          }]
        });
      }

      const command = new InvokeModelCommand({
        modelId,
        body: requestBody,
        contentType: 'application/json',
        accept: 'application/json'
      });

      const response = await this.executeWithRetry(command, 3);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      
      let responseText;
      if (modelId.includes('nova')) {
        responseText = responseBody.output?.message?.content?.[0]?.text || responseBody.output?.text || '';
      } else {
        responseText = responseBody.content?.[0]?.text || '';
      }
      
      return responseText.trim();
    } catch (error) {
      return `Finding telemetry data matching: ${naturalLanguage}`;
    }
  }

  /**
   * Generate insights from query results
   */
  private async generateInsights(naturalLanguage: string, results: any[]): Promise<string[]> {
    if (results.length === 0) {
      return ['No data found matching your query. Try adjusting the time range or search terms.'];
    }

    try {
      // Analyze results for patterns
      const totalCost = results.reduce((sum, r) => sum + (r.cost_usd || 0), 0);
      const avgDuration = results.reduce((sum, r) => sum + (r.duration_ms || 0), 0) / results.length;
      const errorCount = results.filter(r => r.status === 'error').length;
      const uniqueOperations = new Set(results.map(r => r.operation_name)).size;

      const insights: string[] = [];

      if (totalCost > 0) {
        insights.push(`Total cost: $${totalCost.toFixed(4)} across ${results.length} operations`);
      }

      if (avgDuration > 0) {
        insights.push(`Average duration: ${avgDuration.toFixed(0)}ms`);
      }

      if (errorCount > 0) {
        insights.push(`${errorCount} errors found (${(errorCount/results.length*100).toFixed(1)}% error rate)`);
      }

      if (uniqueOperations > 1) {
        insights.push(`${uniqueOperations} different operation types found`);
      }

      // Add AI-generated insight
      const aiInsight = await this.generateAIInsight(naturalLanguage, results);
      if (aiInsight) {
        insights.push(aiInsight);
      }

      return insights;
    } catch (error) {
      logger.error('Failed to generate insights:', error);
      return [`Found ${results.length} results matching your query.`];
    }
  }

  /**
   * Generate AI insight from results
   */
  private async generateAIInsight(naturalLanguage: string, results: any[]): Promise<string> {
    try {
      const summary = {
        count: results.length,
        totalCost: results.reduce((sum, r) => sum + (r.cost_usd || 0), 0),
        avgDuration: results.reduce((sum, r) => sum + (r.duration_ms || 0), 0) / results.length,
        operations: [...new Set(results.map(r => r.operation_name))].slice(0, 3),
        errors: results.filter(r => r.status === 'error').length
      };

      const prompt = `Based on this telemetry query and results, provide one actionable insight:

Query: "${naturalLanguage}"
Results Summary: ${JSON.stringify(summary)}

Provide a single, specific recommendation for optimization or investigation.`;

      const modelId = process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';
      
      let requestBody;
      if (modelId.includes('nova')) {
        // Nova Pro format
        requestBody = JSON.stringify({
          messages: [{
            role: 'user',
            content: [{ text: prompt }]
          }],
          inferenceConfig: {
            max_new_tokens: 100,
            temperature: 0.7
          }
        });
      } else {
        // Claude format (fallback)
        requestBody = JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 100,
          messages: [{
            role: 'user',
            content: prompt
          }]
        });
      }

      const command = new InvokeModelCommand({
        modelId,
        body: requestBody,
        contentType: 'application/json',
        accept: 'application/json'
      });

      const response = await this.executeWithRetry(command, 3);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      
      let responseText;
      if (modelId.includes('nova')) {
        responseText = responseBody.output?.message?.content?.[0]?.text || responseBody.output?.text || '';
      } else {
        responseText = responseBody.content?.[0]?.text || '';
      }
      
      return responseText.trim();
    } catch (error) {
      return '';
    }
  }

  /**
   * Clean aggregation operators from a query object
   */
  private cleanAggregationOperators(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    const cleaned: any = {};
    const aggregationOps = ['$avg', '$sum', '$max', '$min', '$stdDevPop', '$stdDevSamp', '$add', '$subtract', '$multiply', '$divide', '$mod', '$abs', '$ceil', '$floor', '$round', '$sqrt', '$pow', '$log', '$log10', '$ln', '$exp'];

    for (const key in obj) {
      if (aggregationOps.includes(key)) {
        // Replace aggregation operators with simple values
        if (key === '$avg' || key === '$sum' || key === '$max' || key === '$min') {
          cleaned[key.replace('$', '')] = 0; // Convert to simple field
        }
        // Skip other complex aggregation operators
        continue;
      } else if (key === '$in' && !Array.isArray(obj[key])) {
        // Fix $in operator - ensure it's always an array
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          // Convert object to array of values
          const values = Object.values(obj[key]).filter(v => v !== null && v !== undefined && typeof v === 'string');
          if (values.length > 0) {
            cleaned[key] = values;
          } else {
            // If no valid values, skip this condition
            continue;
          }
        } else if (obj[key] !== null && obj[key] !== undefined) {
          // Single value, wrap in array
          cleaned[key] = [obj[key]];
        }
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        const cleanedValue = this.cleanAggregationOperators(obj[key]);
        if (cleanedValue && Object.keys(cleanedValue).length > 0) {
          cleaned[key] = cleanedValue;
        }
      } else {
        cleaned[key] = obj[key];
      }
    }

    return cleaned;
  }

  /**
   * Fix malformed MongoDB query structures
   */
  private fixMalformedQuery(query: any): any {
    try {
      // Fix $or operator if it's an object instead of array
      if (query.$or && typeof query.$or === 'object' && !Array.isArray(query.$or)) {
        const orConditions = [];
        for (const key in query.$or) {
          // Clean each condition recursively
          const condition = this.cleanAggregationOperators(query.$or[key]);
          if (condition && Object.keys(condition).length > 0) {
            orConditions.push(condition);
          }
        }
        // If no valid conditions remain, remove $or entirely
        if (orConditions.length === 0) {
          delete query.$or;
        } else {
          query.$or = orConditions;
        }
      }

      // Fix $and operator if it's an object instead of array
      if (query.$and && typeof query.$and === 'object' && !Array.isArray(query.$and)) {
        const andConditions = [];
        for (const key in query.$and) {
          // Clean each condition recursively
          const condition = this.cleanAggregationOperators(query.$and[key]);
          if (condition && Object.keys(condition).length > 0) {
            andConditions.push(condition);
          }
        }
        // If no valid conditions remain, remove $and entirely
        if (andConditions.length === 0) {
          delete query.$and;
        } else {
          query.$and = andConditions;
        }
      }

      // Remove any invalid operators or fields that might cause issues
      const validQueryOperators = ['$or', '$and', '$nor', '$not', '$gt', '$gte', '$lt', '$lte', '$eq', '$ne', '$in', '$nin', '$exists', '$regex', '$options'];
      const validFields = ['timestamp', 'operation_name', 'service_name', 'duration_ms', 'cost_usd', 'status', 'gen_ai_model', 'http_method', 'http_route', 'error_message', 'tenant_id', 'workspace_id'];
      
      // Remove problematic aggregation operators that should not be in find queries
      const problematicOperators = ['$match', '$group', '$sort', '$limit', '$skip', '$project', '$hour', '$dayOfWeek', '$dayOfMonth', '$month', '$year', '$dateSubtract', '$dateAdd', '$dateTrunc', '$lookup', '$unwind', '$facet', '$bucket'];
      this.removeProblematicOperators(query, problematicOperators);

      // Clean up the query recursively
      return this.cleanQueryObject(query, validQueryOperators, validFields);
    } catch (error) {
      logger.warn('Failed to fix malformed query, using original:', error);
      return query;
    }
  }

  /**
   * Clean MongoDB shell syntax that's not valid JSON
   */
  private cleanMongoShellSyntax(queryText: string): string {
    try {
      logger.debug('Original query text before shell cleaning:', queryText);
      
      // More aggressive ISODate cleaning - handle all possible patterns
      queryText = queryText.replace(/ISODate\s*\(\s*"([^"]+)"\s*\)/g, '"$1"');
      queryText = queryText.replace(/ISODate\s*\(\s*'([^']+)'\s*\)/g, '"$1"');
      
      // Handle complex ISODate patterns with nested expressions
      queryText = queryText.replace(/ISODate\s*\(\s*\([^)]+\)\s*\)/g, `"${new Date().toISOString()}"`);
      queryText = queryText.replace(/ISODate\s*\(\s*([^)]*new Date[^)]*)\s*\)/g, `"${new Date().toISOString()}"`);
      queryText = queryText.replace(/ISODate\s*\(\s*([^)]*Date\.now[^)]*)\s*\)/g, `"${new Date().toISOString()}"`);
      
      // Catch any remaining ISODate patterns
      queryText = queryText.replace(/ISODate\s*\([^)]*\)/g, `"${new Date().toISOString()}"`);
      
      // More aggressive pattern to catch malformed ISODate
      queryText = queryText.replace(/ISODate\s*\(\s*\([^)]*\)/g, `"${new Date().toISOString()}"`);
      queryText = queryText.replace(/ISODate\s*\([^)]*$/g, `"${new Date().toISOString()}"`);
      
      // Replace ObjectId() with string representation
      queryText = queryText.replace(/ObjectId\s*\(\s*"([^"]+)"\s*\)/g, '"$1"');
      queryText = queryText.replace(/ObjectId\s*\(\s*'([^']+)'\s*\)/g, '"$1"');
      queryText = queryText.replace(/ObjectId\s*\([^)]*\)/g, '"000000000000000000000000"');
      
      // Replace NumberLong() with regular numbers
      queryText = queryText.replace(/NumberLong\s*\(\s*(\d+)\s*\)/g, '$1');
      queryText = queryText.replace(/NumberLong\s*\([^)]*\)/g, '0');
      
      // Replace NumberInt() with regular numbers
      queryText = queryText.replace(/NumberInt\s*\(\s*(\d+)\s*\)/g, '$1');
      queryText = queryText.replace(/NumberInt\s*\([^)]*\)/g, '0');
      
      // Replace new Date() with ISO string
      queryText = queryText.replace(/new Date\(\)/g, `"${new Date().toISOString()}"`);
      queryText = queryText.replace(/new Date\s*\([^)]*\)/g, `"${new Date().toISOString()}"`);
      
      // Replace Date.now() with current timestamp
      queryText = queryText.replace(/Date\.now\(\)/g, Date.now().toString());
      
      // Clean up any remaining MongoDB shell patterns
      queryText = queryText.replace(/BinData\s*\([^)]*\)/g, '""');
      queryText = queryText.replace(/UUID\s*\([^)]*\)/g, '""');
      queryText = queryText.replace(/HexData\s*\([^)]*\)/g, '""');
      
      logger.debug('Query text after shell cleaning:', queryText);
      return queryText;
    } catch (error) {
      logger.warn('Failed to clean MongoDB shell syntax:', error);
      // Return a safe fallback
      return '{"timestamp": {"$gte": "HOUR_AGO"}}';
    }
  }

  /**
   * Emergency cleaning when all else fails
   */
  private emergencyQueryCleaning(queryText: string): string {
    try {
      logger.debug('Emergency cleaning input:', queryText);
      
      // Remove any remaining function calls entirely
      queryText = queryText.replace(/\w+\s*\([^)]*\)/g, '""');
      
      // Remove any remaining MongoDB shell syntax
      queryText = queryText.replace(/ISODate[^,}]*/g, `"${new Date().toISOString()}"`);
      queryText = queryText.replace(/ObjectId[^,}]*/g, '"000000000000000000000000"');
      queryText = queryText.replace(/NumberLong[^,}]*/g, '0');
      queryText = queryText.replace(/NumberInt[^,}]*/g, '0');
      
      // Remove any remaining $ operators that aren't valid for find
      const invalidOps = ['$match', '$group', '$sort', '$limit', '$skip', '$project', '$avg', '$sum', '$max', '$min', '$add', '$multiply'];
      for (const op of invalidOps) {
        queryText = queryText.replace(new RegExp(`"${op.replace('$', '\\$')}"[^,}]*`, 'g'), '');
        queryText = queryText.replace(new RegExp(`${op.replace('$', '\\$')}[^,}]*`, 'g'), '');
      }
      
      // Clean up malformed JSON
      queryText = queryText.replace(/,\s*}/g, '}');
      queryText = queryText.replace(/{\s*,/g, '{');
      queryText = queryText.replace(/,\s*,/g, ',');
      queryText = queryText.replace(/:\s*,/g, ': ""');
      
      // If it's still not valid JSON structure, return safe fallback
      if (!queryText.includes('{') || !queryText.includes('}')) {
        queryText = '{"timestamp": {"$gte": "HOUR_AGO"}}';
      }
      
      logger.debug('Emergency cleaning output:', queryText);
      return queryText;
    } catch (error) {
      logger.error('Emergency cleaning failed:', error);
      return '{"timestamp": {"$gte": "HOUR_AGO"}}';
    }
  }

  /**
   * Aggressive cleaning for common AI mistakes
   */
  private aggressiveQueryCleaning(queryText: string): string {
    try {
      logger.debug('Query before aggressive cleaning:', queryText);
      
      // Remove common aggregation pipeline patterns - more comprehensive
      queryText = queryText.replace(/\{\s*"\$match"\s*:\s*(\{[^}]+\})\s*\}/g, '$1');
      queryText = queryText.replace(/\[\s*\{\s*"\$match"\s*:\s*(\{[^}]+\})\s*\}\s*\]/g, '$1');
      
      // Handle nested $match patterns
      queryText = queryText.replace(/"\$match"\s*:\s*(\{[^}]+\})/g, '$1');
      
      // Remove $group, $sort, $limit wrappers - more aggressive
      queryText = queryText.replace(/\{\s*"\$group"\s*:\s*\{[^}]+\}\s*\}/g, '{}');
      queryText = queryText.replace(/\{\s*"\$sort"\s*:\s*\{[^}]+\}\s*\}/g, '{}');
      queryText = queryText.replace(/\{\s*"\$limit"\s*:\s*\d+\s*\}/g, '{}');
      queryText = queryText.replace(/\{\s*"\$skip"\s*:\s*\d+\s*\}/g, '{}');
      queryText = queryText.replace(/\{\s*"\$project"\s*:\s*\{[^}]+\}\s*\}/g, '{}');
      
      // Remove aggregation pipeline array syntax
      queryText = queryText.replace(/^\s*\[\s*/, '').replace(/\s*\]\s*$/, '');
      
      // Fix common date operator mistakes
      queryText = queryText.replace(/"\$dateSubtract"\s*:\s*\{[^}]+\}/g, '"' + new Date(Date.now() - 24*60*60*1000).toISOString() + '"');
      queryText = queryText.replace(/"\$dateAdd"\s*:\s*\{[^}]+\}/g, '"' + new Date().toISOString() + '"');
      
      // Fix MongoDB aggregation variables that don't work in find queries
      queryText = queryText.replace(/"\$\$NOW"/g, '"' + new Date().toISOString() + '"');
      queryText = queryText.replace(/\$\$NOW/g, '"' + new Date().toISOString() + '"');
      queryText = queryText.replace(/"\$\$ROOT"/g, '{}');
      queryText = queryText.replace(/\$\$ROOT/g, '{}');
      
      // Fix complex aggregation operators that don't work in find queries
      queryText = queryText.replace(/"\$avg"\s*:\s*"[^"]+"/g, '0');
      queryText = queryText.replace(/"\$stdDevPop"\s*:\s*"[^"]+"/g, '0');
      queryText = queryText.replace(/"\$add"\s*:\s*\{[^}]+\}/g, '0');
      queryText = queryText.replace(/"\$multiply"\s*:\s*\{[^}]+\}/g, '0');
      queryText = queryText.replace(/"\$sum"\s*:\s*"[^"]+"/g, '0');
      queryText = queryText.replace(/"\$max"\s*:\s*"[^"]+"/g, '0');
      queryText = queryText.replace(/"\$min"\s*:\s*"[^"]+"/g, '0');
      
      // Remove any remaining aggregation operators - more comprehensive
      const aggOperators = [
        '$match', '$group', '$sort', '$limit', '$skip', '$project', '$lookup', '$unwind', '$facet', '$bucket', '$addFields', '$replaceRoot', '$merge', '$out', '$count', '$sample',
        '$avg', '$sum', '$max', '$min', '$stdDevPop', '$stdDevSamp', '$add', '$subtract', '$multiply', '$divide', '$mod', '$abs', '$ceil', '$floor', '$round', '$sqrt', '$pow', '$log', '$log10', '$ln', '$exp',
        '$dateToString', '$dateFromString', '$dateToParts', '$dateFromParts', '$isoDayOfWeek', '$isoWeek', '$isoWeekYear'
      ];
      for (const op of aggOperators) {
        // Remove the operator and its value entirely
        const regex1 = new RegExp(`"${op.replace('$', '\\$')}"\\s*:\\s*\\{[^}]*\\}`, 'g');
        const regex2 = new RegExp(`"${op.replace('$', '\\$')}"\\s*:\\s*[^,}]+`, 'g');
        const regex3 = new RegExp(`${op.replace('$', '\\$')}\\s*:\\s*\\{[^}]*\\}`, 'g');
        const regex4 = new RegExp(`"${op.replace('$', '\\$')}"\\s*:\\s*"[^"]*"`, 'g');
        queryText = queryText.replace(regex1, '');
        queryText = queryText.replace(regex2, '');
        queryText = queryText.replace(regex3, '');
        queryText = queryText.replace(regex4, '');
      }
      
      // Clean up empty objects and trailing commas - more thorough
      queryText = queryText.replace(/,\s*}/g, '}');
      queryText = queryText.replace(/{\s*,/g, '{');
      queryText = queryText.replace(/,\s*,/g, ',');
      queryText = queryText.replace(/\{\s*\}/g, '{}');
      
      // If we end up with just empty objects, return a safe default
      if (queryText.trim() === '{}' || queryText.trim() === '') {
        queryText = '{"timestamp": {"$gte": "HOUR_AGO"}}';
      }
      
      logger.debug('Query after aggressive cleaning:', queryText);
      return queryText;
    } catch (error) {
      logger.warn('Failed to perform aggressive query cleaning:', error);
      return '{"timestamp": {"$gte": "HOUR_AGO"}}'; // Safe fallback
    }
  }

  /**
   * Final safety check to ensure query is safe for MongoDB find()
   */
  /**
   * Fix data type casting issues
   */
  private fixDataTypes(query: any): any {
    if (typeof query !== 'object' || query === null) {
      return query;
    }

    const fixed: any = {};
    const stringFields = ['operation_name', 'service_name', 'http_method', 'http_route', 'gen_ai_model', 'error_message', 'tenant_id', 'workspace_id'];
    const numberFields = ['duration_ms', 'cost_usd', 'status_code', 'gen_ai_input_tokens', 'gen_ai_output_tokens'];

    for (const key in query) {
      const value = query[key];
      
      if (stringFields.includes(key)) {
        // Ensure string fields are strings or valid operators
        if (typeof value === 'object' && value !== null) {
          // Handle operators like $in, $regex, etc.
          const fixedOperators: any = {};
          for (const opKey in value) {
            if (opKey === '$in' && Array.isArray(value[opKey])) {
              // Ensure all values in $in array are strings
              fixedOperators[opKey] = value[opKey].map((v: any) => 
                typeof v === 'string' ? v : String(v)
              ).filter((v: string) => v && v !== 'null' && v !== 'undefined');
            } else if (typeof value[opKey] === 'object') {
              // Skip complex objects that can't be cast to string
              continue;
            } else {
              fixedOperators[opKey] = typeof value[opKey] === 'string' ? value[opKey] : String(value[opKey]);
            }
          }
          if (Object.keys(fixedOperators).length > 0) {
            fixed[key] = fixedOperators;
          }
        } else if (value !== null && value !== undefined) {
          fixed[key] = typeof value === 'string' ? value : String(value);
        }
      } else if (numberFields.includes(key)) {
        // Ensure number fields are numbers or valid operators
        if (typeof value === 'object' && value !== null) {
          const fixedOperators: any = {};
          for (const opKey in value) {
            if (typeof value[opKey] === 'number') {
              fixedOperators[opKey] = value[opKey];
            } else if (typeof value[opKey] === 'string' && !isNaN(Number(value[opKey]))) {
              fixedOperators[opKey] = Number(value[opKey]);
            }
          }
          if (Object.keys(fixedOperators).length > 0) {
            fixed[key] = fixedOperators;
          }
        } else if (typeof value === 'number') {
          fixed[key] = value;
        } else if (typeof value === 'string' && !isNaN(Number(value))) {
          fixed[key] = Number(value);
        }
      } else if (typeof value === 'object' && value !== null) {
        // Recursively fix nested objects
        const fixedValue = this.fixDataTypes(value);
        if (fixedValue && Object.keys(fixedValue).length > 0) {
          fixed[key] = fixedValue;
        }
      } else {
        fixed[key] = value;
      }
    }

    return fixed;
  }

  private ensureSafeFindQuery(query: any): any {
    if (!query || typeof query !== 'object') {
      logger.debug('Query is null or not object, using default safe query');
      return { timestamp: { $gte: new Date(Date.now() - 3600000) } };
    }

    logger.debug('Original query before safety check:', JSON.stringify(query));
    
    // Create a clean copy
    const safeQuery = JSON.parse(JSON.stringify(query));
    
    // Remove any aggregation operators that might have slipped through
    const dangerousOperators = ['$match', '$group', '$sort', '$limit', '$skip', '$project', '$lookup', '$unwind', '$facet', '$bucket', '$addFields', '$replaceRoot', '$merge', '$out'];
    
    const cleanObject = (obj: any): any => {
      if (typeof obj !== 'object' || obj === null) {
        return obj;
      }
      
      if (Array.isArray(obj)) {
        return obj.map(cleanObject);
      }
      
      const cleaned: any = {};
      for (const key in obj) {
        if (dangerousOperators.includes(key)) {
          logger.warn(`Removing dangerous operator ${key} from find query`);
          continue;
        }
        cleaned[key] = cleanObject(obj[key]);
      }
      return cleaned;
    };
    
    const cleanedQuery = cleanObject(safeQuery);
    
    // If query becomes empty after cleaning, provide a safe default
    if (Object.keys(cleanedQuery).length === 0) {
      logger.debug('Query became empty after cleaning, using default safe query');
      return { timestamp: { $gte: new Date(Date.now() - 3600000) } };
    }
    
    logger.debug('Final safe query:', JSON.stringify(cleanedQuery));
    return cleanedQuery;
  }

  /**
   * Remove problematic operators that might cause MongoDB errors
   */
  private removeProblematicOperators(obj: any, problematicOperators: string[]): void {
    if (typeof obj !== 'object' || obj === null) {
      return;
    }

    for (const key in obj) {
      if (problematicOperators.includes(key)) {
        delete obj[key];
      } else if (typeof obj[key] === 'object') {
        this.removeProblematicOperators(obj[key], problematicOperators);
      }
    }
  }

  /**
   * Recursively clean query object
   */
  private cleanQueryObject(obj: any, validOperators: string[], validFields: string[]): any {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    const cleaned: any = {};
    for (const key in obj) {
      if (key.startsWith('$')) {
        // It's an operator
        if (validOperators.includes(key)) {
          cleaned[key] = this.cleanQueryObject(obj[key], validOperators, validFields);
        }
      } else {
        // It's a field
        if (validFields.includes(key)) {
          // Special handling for timestamp field with complex date objects
          if (key === 'timestamp' && typeof obj[key] === 'object') {
            cleaned[key] = this.simplifyDateQuery(obj[key]);
          } else {
            cleaned[key] = this.cleanQueryObject(obj[key], validOperators, validFields);
          }
        }
      }
    }
    return cleaned;
  }

  /**
   * Simplify complex date queries to basic date objects
   */
  private simplifyDateQuery(dateQuery: any): any {
    if (typeof dateQuery !== 'object' || dateQuery === null) {
      return dateQuery;
    }

    const simplified: any = {};
    for (const operator in dateQuery) {
      if (operator === '$gte' || operator === '$gt' || operator === '$lte' || operator === '$lt') {
        const value = dateQuery[operator];
        
        // Handle complex date expressions
        if (typeof value === 'object' && value !== null) {
          if (value.$dateSubtract) {
            // Convert $dateSubtract to simple date
            const now = new Date();
            const amount = value.$dateSubtract.amount || 1;
            const unit = value.$dateSubtract.unit || 'day';
            
            switch (unit) {
              case 'day':
                simplified[operator] = new Date(now.getTime() - (amount * 24 * 60 * 60 * 1000));
                break;
              case 'hour':
                simplified[operator] = new Date(now.getTime() - (amount * 60 * 60 * 1000));
                break;
              case 'week':
                simplified[operator] = new Date(now.getTime() - (amount * 7 * 24 * 60 * 60 * 1000));
                break;
              case 'month':
                const monthAgo = new Date(now);
                monthAgo.setMonth(monthAgo.getMonth() - amount);
                simplified[operator] = monthAgo;
                break;
              default:
                simplified[operator] = new Date(now.getTime() - (24 * 60 * 60 * 1000)); // Default to 1 day ago
            }
          } else if (value.$dateAdd) {
            // Convert $dateAdd to simple date
            const now = new Date();
            const amount = value.$dateAdd.amount || 1;
            const unit = value.$dateAdd.unit || 'day';
            
            switch (unit) {
              case 'day':
                simplified[operator] = new Date(now.getTime() + (amount * 24 * 60 * 60 * 1000));
                break;
              case 'hour':
                simplified[operator] = new Date(now.getTime() + (amount * 60 * 60 * 1000));
                break;
              default:
                simplified[operator] = new Date(now.getTime() + (24 * 60 * 60 * 1000));
            }
          } else {
            // Unknown complex date object, use fallback
            simplified[operator] = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
          }
        } else {
          // Simple value, keep as is
          simplified[operator] = value;
        }
      } else {
        // Other operators, keep as is
        simplified[operator] = dateQuery[operator];
      }
    }
    
    return simplified;
  }

  /**
   * Execute Bedrock command with exponential backoff retry
   */
  private async executeWithRetry(command: any, maxRetries: number = 3): Promise<any> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.bedrockClient.send(command);
      } catch (error: any) {
        if (error.name === 'ThrottlingException' && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s
          logger.warn(`Bedrock throttling, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * Process time-based filters in MongoDB query
   */
  private processTimeFilters(query: any): any {
    const now = new Date();
    const replacements: Record<string, Date> = {
      'TODAY_START': new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      'HOUR_AGO': new Date(now.getTime() - 3600000),
      'DAY_AGO': new Date(now.getTime() - 86400000),
      'WEEK_AGO': new Date(now.getTime() - 604800000)
    };

    const processValue = (value: any): any => {
      if (typeof value === 'string' && replacements[value]) {
        return replacements[value];
      }
      if (typeof value === 'object' && value !== null) {
        const processed: any = {};
        for (const [k, v] of Object.entries(value)) {
          processed[k] = processValue(v);
        }
        return processed;
      }
      return value;
    };

    return processValue(query);
  }

  /**
   * Determine if query needs semantic search
   */
  private needsSemanticSearch(naturalLanguage: string): boolean {
    const semanticKeywords = [
      'similar', 'like', 'related', 'pattern', 'behavior',
      'why', 'what caused', 'explain', 'understand',
      'anomaly', 'unusual', 'different', 'compare'
    ];

    return semanticKeywords.some(keyword => 
      naturalLanguage.toLowerCase().includes(keyword)
    );
  }

  /**
   * Extract suggested filters from natural language
   */
  private extractSuggestedFilters(naturalLanguage: string): string[] {
    const filters: string[] = [];
    const lower = naturalLanguage.toLowerCase();

    if (lower.includes('error') || lower.includes('fail')) {
      filters.push('status:error');
    }
    if (lower.includes('slow') || lower.includes('latency')) {
      filters.push('duration_ms:>2000');
    }
    if (lower.includes('expensive') || lower.includes('cost')) {
      filters.push('cost_usd:>0.01');
    }
    if (lower.includes('ai') || lower.includes('model')) {
      filters.push('gen_ai_model:exists');
    }

    return filters;
  }
}

export const ckqlService = CKQLService.getInstance();


