/**
 * Hybrid Execution Engine for Cortex
 * Offloads deterministic tasks to tools/APIs, reserving LLMs for reasoning
 */

import { CortexQuery, CortexResponse, CortexExpression } from '../types';
import { loggingService } from '../../services/logging.service';
import axios from 'axios';
import * as math from 'mathjs';

/**
 * Tool types that can be executed without LLM
 */
export enum ToolType {
  CALCULATOR = 'calculator',
  DATABASE = 'database',
  API_CALL = 'api_call',
  FILE_SYSTEM = 'file_system',
  CODE_EXECUTION = 'code_execution',
  DATA_TRANSFORM = 'data_transform',
  CACHE_LOOKUP = 'cache_lookup',
  REGEX_MATCH = 'regex_match',
  DATE_TIME = 'date_time',
  CRYPTO = 'crypto',
  SQL_TO_CORTEX = 'sql_to_cortex',
  JSON_TO_CORTEX = 'json_to_cortex',
  API_TO_CORTEX = 'api_to_cortex'
}

/**
 * Tool execution request
 */
export interface ToolRequest {
  type: ToolType;
  action: string;
  parameters: Record<string, any>;
  timeout?: number;
  retries?: number;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  executionTime: number;
  costSaved: number; // Cost saved by not using LLM
}

/**
 * Hybrid Execution Engine
 */
export class HybridExecutionEngine {
  private toolRegistry = new Map<ToolType, ToolExecutor>();
  private executionStats = new Map<ToolType, { count: number; totalSaved: number }>();
  
  constructor() {
    this.registerDefaultTools();
  }
  
  /**
   * Register default tool executors
   */
  private registerDefaultTools(): void {
    // Calculator tool
    this.registerTool(ToolType.CALCULATOR, new CalculatorTool());
    
    // API call tool
    this.registerTool(ToolType.API_CALL, new ApiCallTool());
    
    // Database tool
    this.registerTool(ToolType.DATABASE, new DatabaseTool());
    
    // File system tool
    this.registerTool(ToolType.FILE_SYSTEM, new FileSystemTool());
    
    // Data transform tool
    this.registerTool(ToolType.DATA_TRANSFORM, new DataTransformTool());
    
    // Regex tool
    this.registerTool(ToolType.REGEX_MATCH, new RegexTool());
    
    // Date/time tool
    this.registerTool(ToolType.DATE_TIME, new DateTimeTool());
    
    // Data converters
    this.registerTool(ToolType.SQL_TO_CORTEX, new SqlToCortexConverter());
    this.registerTool(ToolType.JSON_TO_CORTEX, new JsonToCortexConverter());
    this.registerTool(ToolType.API_TO_CORTEX, new ApiToCortexConverter());
  }
  
  /**
   * Register a tool executor
   */
  public registerTool(type: ToolType, executor: ToolExecutor): void {
    this.toolRegistry.set(type, executor);
    this.executionStats.set(type, { count: 0, totalSaved: 0 });
  }
  
  /**
   * Analyze query to determine if it can be handled by tools
   */
  public async analyzeForToolUse(query: CortexQuery): Promise<{
    canUseTools: boolean;
    toolRequests: ToolRequest[];
    estimatedSavings: number;
  }> {
    const toolRequests: ToolRequest[] = [];
    let estimatedSavings = 0;
    
    // Check for mathematical operations
    if (this.containsMathOperation(query)) {
      toolRequests.push({
        type: ToolType.CALCULATOR,
        action: 'evaluate',
        parameters: { expression: this.extractMathExpression(query) }
      });
      estimatedSavings += 0.001; // Save ~$0.001 per math operation
    }
    
    // Check for API calls
    if (this.containsApiCall(query)) {
      const apiInfo = this.extractApiInfo(query);
      toolRequests.push({
        type: ToolType.API_CALL,
        action: apiInfo.method,
        parameters: apiInfo
      });
      estimatedSavings += 0.002; // Save ~$0.002 per API call
    }
    
    // Check for data transformations
    if (this.containsDataTransform(query)) {
      toolRequests.push({
        type: ToolType.DATA_TRANSFORM,
        action: 'transform',
        parameters: this.extractTransformParams(query)
      });
      estimatedSavings += 0.0015; // Save ~$0.0015 per transformation
    }
    
    // Check for regex operations
    if (this.containsRegexOperation(query)) {
      toolRequests.push({
        type: ToolType.REGEX_MATCH,
        action: 'match',
        parameters: this.extractRegexParams(query)
      });
      estimatedSavings += 0.001; // Save ~$0.001 per regex
    }
    
    // Check for date/time operations
    if (this.containsDateTimeOperation(query)) {
      toolRequests.push({
        type: ToolType.DATE_TIME,
        action: 'process',
        parameters: this.extractDateTimeParams(query)
      });
      estimatedSavings += 0.001; // Save ~$0.001 per date operation
    }
    
    return {
      canUseTools: toolRequests.length > 0,
      toolRequests,
      estimatedSavings
    };
  }
  
  /**
   * Execute tool requests
   */
  public async executeTools(requests: ToolRequest[]): Promise<ToolResult[]> {
    const results = await Promise.all(
      requests.map(request => this.executeTool(request))
    );
    
    // Update statistics
    results.forEach((result, index) => {
      if (result.success) {
        const type = requests[index].type;
        const stats = this.executionStats.get(type);
        if (stats) {
          stats.count++;
          stats.totalSaved += result.costSaved;
        }
      }
    });
    
    return results;
  }
  
  /**
   * Execute a single tool
   */
  private async executeTool(request: ToolRequest): Promise<ToolResult> {
    const startTime = Date.now();
    
    try {
      const executor = this.toolRegistry.get(request.type);
      if (!executor) {
        throw new Error(`No executor for tool type: ${request.type}`);
      }
      
      const data = await executor.execute(request.action, request.parameters);
      
      return {
        success: true,
        data,
        executionTime: Date.now() - startTime,
        costSaved: this.calculateCostSaved(request.type)
      };
    } catch (error) {
      loggingService.error('Tool execution failed', { request, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
        costSaved: 0
      };
    }
  }
  
  /**
   * Merge tool results with LLM processing
   */
  public mergeResults(
    toolResults: ToolResult[],
    llmResponse: CortexResponse
  ): CortexResponse {
    // Inject tool results into response
    const enhancedResponse = { ...llmResponse };
    
    if (!enhancedResponse.metadata) {
      enhancedResponse.metadata = {};
    }
    
    enhancedResponse.metadata.toolResults = toolResults.map(result => ({
      success: result.success,
      data: result.data,
      executionTime: result.executionTime,
      costSaved: result.costSaved
    }));
    
    enhancedResponse.metadata.hybridExecution = true;
    enhancedResponse.metadata.totalToolSavings = toolResults.reduce(
      (sum, r) => sum + r.costSaved, 0
    );
    
    return enhancedResponse;
  }
  
  /**
   * Get execution statistics
   */
  public getStatistics(): Record<string, any> {
    const stats: Record<string, any> = {};
    
    this.executionStats.forEach((value, key) => {
      stats[key] = value;
    });
    
    const totalSaved = Array.from(this.executionStats.values())
      .reduce((sum, stat) => sum + stat.totalSaved, 0);
    
    stats.totalSaved = totalSaved;
    
    return stats;
  }
  
  // Helper methods for detecting tool opportunities
  private containsMathOperation(query: CortexQuery): boolean {
    const expr = JSON.stringify(query.expression);
    return /action_calculate|compute|measure|sum|multiply|divide/.test(expr);
  }
  
  private extractMathExpression(query: CortexQuery): string {
    // Extract mathematical expression from query
    const expr = JSON.stringify(query.expression || query);
    
    // Look for mathematical patterns in the expression
    const mathPatterns = [
      /calculate\s*\((.*?)\)/i,
      /compute\s*\((.*?)\)/i,
      /eval\s*\((.*?)\)/i,
      /(\d+\s*[\+\-\*\/\^\%]\s*\d+)/,
      /sum\s*\((.*?)\)/i,
      /multiply\s*\((.*?)\)/i
    ];
    
    for (const pattern of mathPatterns) {
      const match = expr.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    
    // Extract numbers and operators from the expression
    const numbers = expr.match(/\d+(\.\d+)?/g) || [];
    const operators = expr.match(/[\+\-\*\/\^\%]/g) || [];
    
    if (numbers.length >= 2 && operators.length >= 1) {
      // Build a simple expression
      return `${numbers[0]} ${operators[0]} ${numbers[1]}`;
    }
    
    return '0'; // Default if no expression found
  }
  
  private containsApiCall(query: CortexQuery): boolean {
    const expr = JSON.stringify(query.expression);
    return /action_fetch|api_call|http_request/.test(expr);
  }
  
  private extractApiInfo(query: CortexQuery): any {
    // Extract API call information from query
    const expr = JSON.stringify(query.expression || query);
    
    // Default values
    let method = 'GET';
    let url = '';
    const headers: Record<string, string> = {};
    let data = undefined;
    
    // Extract URL patterns
    const urlMatch = expr.match(/url['":\s]+(['"](https?:\/\/[^'"]+)['"])/i);
    if (urlMatch && urlMatch[2]) {
      url = urlMatch[2];
    }
    
    // Extract method
    const methodMatch = expr.match(/method['":\s]+['"]?(GET|POST|PUT|DELETE|PATCH)['"]?/i);
    if (methodMatch && methodMatch[1]) {
      method = methodMatch[1].toUpperCase();
    }
    
    // Extract headers
    const headerMatch = expr.match(/headers['":\s]+(\{[^}]+\})/i);
    if (headerMatch && headerMatch[1]) {
      try {
        const parsedHeaders = JSON.parse(headerMatch[1]);
        Object.assign(headers, parsedHeaders);
      } catch (e) {
        // Default headers
        headers['Content-Type'] = 'application/json';
      }
    }
    
    // Extract data/body for POST/PUT requests
    if (method === 'POST' || method === 'PUT') {
      const dataMatch = expr.match(/data['":\s]+(\{[^}]+\})/i);
      if (dataMatch && dataMatch[1]) {
        try {
          data = JSON.parse(dataMatch[1]);
        } catch (e) {
          data = {};
        }
      }
    }
    
    // If no URL found, check for endpoint references
    if (!url && query.metadata?.apiEndpoint) {
      url = query.metadata.apiEndpoint as string;
    }
    
    return {
      method,
      url: url || 'https://api.example.com/data',
      headers,
      data
    };
  }
  
  private containsDataTransform(query: CortexQuery): boolean {
    const expr = JSON.stringify(query.expression);
    return /action_transform|convert|map|filter|reduce/.test(expr);
  }
  
  private extractTransformParams(query: CortexQuery): any {
    const expr = JSON.stringify(query.expression || query);
    
    // Determine operation type
    let operation = 'map';
    if (/filter/.test(expr)) operation = 'filter';
    else if (/reduce/.test(expr)) operation = 'reduce';
    else if (/sort/.test(expr)) operation = 'sort';
    else if (/transform/.test(expr)) operation = 'map';
    
    // Extract data array
    let data: any[] = [];
    const dataMatch = expr.match(/data['":\s]+(\[[^\]]+\])/i);
    if (dataMatch && dataMatch[1]) {
      try {
        data = JSON.parse(dataMatch[1]);
      } catch (e) {
        // Try to extract from metadata
        if (query.metadata?.data && Array.isArray(query.metadata.data)) {
          data = query.metadata.data;
        }
      }
    }
    
    // Extract transform function or criteria
    let transform = 'identity';
    const transformMatch = expr.match(/transform['":\s]+['"]([^'"]+)['"]/i);
    if (transformMatch && transformMatch[1]) {
      transform = transformMatch[1];
    } else {
      // Look for specific transform patterns
      if (/uppercase/i.test(expr)) transform = 'uppercase';
      else if (/lowercase/i.test(expr)) transform = 'lowercase';
      else if (/increment/i.test(expr)) transform = 'increment';
      else if (/double/i.test(expr)) transform = 'double';
    }
    
    return {
      operation,
      data,
      transform
    };
  }
  
  private containsRegexOperation(query: CortexQuery): boolean {
    const expr = JSON.stringify(query.expression);
    return /action_match|regex|pattern/.test(expr);
  }
  
  private extractRegexParams(query: CortexQuery): any {
    const expr = JSON.stringify(query.expression || query);
    
    // Extract pattern
    let pattern = '.*';
    const patternMatch = expr.match(/pattern['":\s]+['"]([^'"]+)['"]/i);
    if (patternMatch && patternMatch[1]) {
      pattern = patternMatch[1];
    } else {
      // Look for regex literals
      const regexMatch = expr.match(/\/([^\/]+)\/([gimuy]*)/);
      if (regexMatch && regexMatch[1]) {
        pattern = regexMatch[1];
      }
    }
    
    // Extract text to match against
    let text = '';
    const textMatch = expr.match(/text['":\s]+['"]([^'"]+)['"]/i);
    if (textMatch && textMatch[1]) {
      text = textMatch[1];
    } else if (query.metadata?.text) {
      text = query.metadata.text as string;
    }
    
    // Extract flags
    let flags = 'g';
    const flagsMatch = expr.match(/flags['":\s]+['"]([gimuy]+)['"]/i);
    if (flagsMatch && flagsMatch[1]) {
      flags = flagsMatch[1];
    }
    
    // Extract replacement if it's a replace operation
    let replacement = undefined;
    if (/replace/i.test(expr)) {
      const replaceMatch = expr.match(/replacement['":\s]+['"]([^'"]*)['"]/i);
      if (replaceMatch) {
        replacement = replaceMatch[1];
      }
    }
    
    return {
      pattern,
      text,
      flags,
      replacement
    };
  }
  
  private containsDateTimeOperation(query: CortexQuery): boolean {
    const expr = JSON.stringify(query.expression);
    return /concept_time|date|timestamp|duration/.test(expr);
  }
  
  private extractDateTimeParams(query: CortexQuery): any {
    const expr = JSON.stringify(query.expression || query);
    
    // Determine operation
    let operation = 'now';
    if (/parse/i.test(expr)) operation = 'parse';
    else if (/format/i.test(expr)) operation = 'format';
    else if (/add/i.test(expr)) operation = 'add';
    else if (/subtract/i.test(expr)) operation = 'subtract';
    else if (/diff/i.test(expr)) operation = 'diff';
    else if (/now|current/i.test(expr)) operation = 'now';
    
    // Extract date values
    const dateMatch = expr.match(/date['":\s]+['"]([^'"]+)['"]/i);
    const date = dateMatch ? dateMatch[1] : undefined;
    
    // Extract format
    let format = 'ISO';
    const formatMatch = expr.match(/format['":\s]+['"]([^'"]+)['"]/i);
    if (formatMatch && formatMatch[1]) {
      format = formatMatch[1];
    }
    
    // Extract amount and unit for add/subtract operations
    let amount = 0;
    let unit = 'days';
    if (operation === 'add' || operation === 'subtract') {
      const amountMatch = expr.match(/amount['":\s]+(\d+)/i);
      if (amountMatch && amountMatch[1]) {
        amount = parseInt(amountMatch[1]);
      }
      
      const unitMatch = expr.match(/unit['":\s]+['"]?(days?|hours?|minutes?|seconds?|months?|years?)['"]?/i);
      if (unitMatch && unitMatch[1]) {
        unit = unitMatch[1];
      }
    }
    
    // Extract second date for diff operation
    let date2 = undefined;
    if (operation === 'diff') {
      const date2Match = expr.match(/date2['":\s]+['"]([^'"]+)['"]/i);
      if (date2Match && date2Match[1]) {
        date2 = date2Match[1];
      }
    }
    
    return {
      operation,
      date,
      date2,
      format,
      amount,
      unit
    };
  }
  
  private calculateCostSaved(type: ToolType): number {
    // Estimate cost saved based on tool type
    const savings: Record<ToolType, number> = {
      [ToolType.CALCULATOR]: 0.001,
      [ToolType.API_CALL]: 0.002,
      [ToolType.DATABASE]: 0.0025,
      [ToolType.FILE_SYSTEM]: 0.0015,
      [ToolType.CODE_EXECUTION]: 0.003,
      [ToolType.DATA_TRANSFORM]: 0.0015,
      [ToolType.CACHE_LOOKUP]: 0.0005,
      [ToolType.REGEX_MATCH]: 0.001,
      [ToolType.DATE_TIME]: 0.001,
      [ToolType.CRYPTO]: 0.0015,
      [ToolType.SQL_TO_CORTEX]: 0.002,
      [ToolType.JSON_TO_CORTEX]: 0.0015,
      [ToolType.API_TO_CORTEX]: 0.0018
    };
    
    return savings[type] || 0.001;
  }
}

/**
 * Base tool executor interface
 */
export interface ToolExecutor {
  execute(action: string, parameters: Record<string, any>): Promise<any>;
}

/**
 * Calculator tool executor
 */
class CalculatorTool implements ToolExecutor {
  async execute(_action: string, parameters: Record<string, any>): Promise<any> {
    const { expression } = parameters;
    try {
      return math.evaluate(expression);
    } catch (error) {
      throw new Error(`Math evaluation failed: ${error}`);
    }
  }
}

/**
 * API call tool executor
 */
class ApiCallTool implements ToolExecutor {
  async execute(_action: string, parameters: Record<string, any>): Promise<any> {
    const { url, method = 'GET', headers = {}, data } = parameters;
    
    try {
      const response = await axios({
        method,
        url,
        headers,
        data,
        timeout: 5000
      });
      
      return response.data;
    } catch (error) {
      throw new Error(`API call failed: ${error}`);
    }
  }
}

/**
 * Database tool executor
 */
class DatabaseTool implements ToolExecutor {
  async execute(action: string, parameters: Record<string, any>): Promise<any> {
    try {
      // Try to import MongoDB if available
      const mongodb = await import('mongodb').catch(() => null);
      
      if (!mongodb) {
        // MongoDB not available, use in-memory fallback
        return this.executeInMemory(action, parameters);
      }
      
      const { MongoClient } = mongodb;
      
      // Get database connection details from environment or parameters
      const connectionString = parameters.connectionString || 
                             process.env.DATABASE_URL || process.env.MONGO_URI ||
                             'mongodb://localhost:27017/cortex';
      
      const dbName = parameters.database || 'cortex';
      const collectionName = parameters.collection || 'data';
      
      const client = new MongoClient(connectionString);
      
      try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);
        
        switch (parameters.action || action) {
          case 'find':
            const query = parameters.query || {};
            const options = parameters.options || {};
            return await collection.find(query, options).toArray();
            
          case 'findOne':
            return await collection.findOne(parameters.query || {});
            
          case 'insert':
            const docs = parameters.documents || parameters.document;
            if (Array.isArray(docs)) {
              return await collection.insertMany(docs);
            } else {
              return await collection.insertOne(docs);
            }
            
          case 'update':
            return await collection.updateMany(
              parameters.filter || {},
              parameters.update || {},
              parameters.options || {}
            );
            
          case 'delete':
            return await collection.deleteMany(parameters.filter || {});
            
          case 'aggregate':
            return await collection.aggregate(parameters.pipeline || []).toArray();
            
          case 'count':
            return await collection.countDocuments(parameters.query || {});
            
          default:
            throw new Error(`Unknown database action: ${parameters.action || action}`);
        }
      } finally {
        await client.close();
      }
    } catch (error: any) {
      // If any database error occurs, log and throw
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }
  
  // In-memory database fallback
  private memoryDb: Map<string, any[]> = new Map();
  
  private executeInMemory(action: string, parameters: Record<string, any>): any {
    const collection = parameters.collection || 'data';
    
    if (!this.memoryDb.has(collection)) {
      this.memoryDb.set(collection, []);
    }
    
    const data = this.memoryDb.get(collection)!;
    
    switch (parameters.action || action) {
      case 'find':
        const query = parameters.query || {};
        return data.filter(item => this.matchesQuery(item, query));
        
      case 'findOne':
        return data.find(item => this.matchesQuery(item, parameters.query || {}));
        
      case 'insert':
        const docs = parameters.documents || parameters.document;
        if (Array.isArray(docs)) {
          data.push(...docs);
          return { insertedCount: docs.length };
        } else {
          data.push(docs);
          return { insertedCount: 1 };
        }
        
      case 'update':
        let updateCount = 0;
        data.forEach(item => {
          if (this.matchesQuery(item, parameters.filter || {})) {
            Object.assign(item, parameters.update || {});
            updateCount++;
          }
        });
        return { modifiedCount: updateCount };
        
      case 'delete':
        const toDelete = data.filter(item => this.matchesQuery(item, parameters.filter || {}));
        toDelete.forEach(item => {
          const index = data.indexOf(item);
          if (index > -1) data.splice(index, 1);
        });
        return { deletedCount: toDelete.length };
        
      case 'count':
        return data.filter(item => this.matchesQuery(item, parameters.query || {})).length;
        
      default:
        throw new Error(`Unknown database action: ${parameters.action || action}`);
    }
  }
  
  private matchesQuery(item: any, query: any): boolean {
    for (const [key, value] of Object.entries(query)) {
      if (item[key] !== value) return false;
    }
    return true;
  }
}

/**
 * File system tool executor
 */
class FileSystemTool implements ToolExecutor {
  async execute(action: string, parameters: Record<string, any>): Promise<any> {
    const fs = await import('fs/promises');
    
    switch (parameters.action || action) {
      case 'read':
        return fs.readFile(parameters.path, 'utf-8');
      case 'write':
        await fs.writeFile(parameters.path, parameters.content);
        return { success: true };
      case 'list':
        return fs.readdir(parameters.path);
      default:
        throw new Error(`Unknown file system action: ${parameters.action || action}`);
    }
  }
}

/**
 * Data transform tool executor
 */
class DataTransformTool implements ToolExecutor {
  async execute(_action: string, parameters: Record<string, any>): Promise<any> {
    const { operation, data, transform } = parameters;
    
    switch (operation) {
      case 'map':
        return data.map((item: any) => this.applyTransform(item, transform));
      case 'filter':
        return data.filter((item: any) => this.evaluateCondition(item, transform));
      case 'reduce':
        return data.reduce((acc: any, item: any) => this.applyReduce(acc, item, transform), {});
      case 'sort':
        return [...data].sort((a, b) => this.compareItems(a, b, transform));
      default:
        throw new Error(`Unknown transform operation: ${operation}`);
    }
  }
  
  private applyTransform(item: any, transform: any): any {
    // Apply transformation based on transform type
    if (typeof transform === 'function') {
      return transform(item);
    }
    
    switch (transform) {
      case 'uppercase':
        return typeof item === 'string' ? item.toUpperCase() : item;
      case 'lowercase':
        return typeof item === 'string' ? item.toLowerCase() : item;
      case 'increment':
        return typeof item === 'number' ? item + 1 : item;
      case 'double':
        return typeof item === 'number' ? item * 2 : item;
      case 'square':
        return typeof item === 'number' ? item * item : item;
      case 'stringify':
        return JSON.stringify(item);
      case 'parse':
        try {
          return typeof item === 'string' ? JSON.parse(item) : item;
        } catch {
          return item;
        }
      case 'identity':
      default:
        return item;
    }
  }
  
  private evaluateCondition(item: any, condition: any): boolean {
    // Evaluate condition for filtering
    if (typeof condition === 'function') {
      return condition(item);
    }
    
    if (typeof condition === 'object' && condition !== null) {
      // Check if item matches all conditions
      for (const [key, value] of Object.entries(condition)) {
        if (item[key] !== value) {
          return false;
        }
      }
      return true;
    }
    
    // Simple truthiness check
    return Boolean(condition);
  }
  
  private applyReduce(acc: any, item: any, reducer: any): any {
    // Apply reducer function or operation
    if (typeof reducer === 'function') {
      return reducer(acc, item);
    }
    
    if (typeof reducer === 'string') {
      switch (reducer) {
        case 'sum':
          return acc + (typeof item === 'number' ? item : 0);
        case 'concat':
          return Array.isArray(acc) ? [...acc, item] : acc + item;
        case 'count':
          return (acc || 0) + 1;
        case 'min':
          return acc === undefined ? item : Math.min(acc, item);
        case 'max':
          return acc === undefined ? item : Math.max(acc, item);
        default:
          return acc;
      }
    }
    
    return acc;
  }
  
  private compareItems(a: any, b: any, comparator: any): number {
    // Compare items for sorting
    if (typeof comparator === 'function') {
      return comparator(a, b);
    }
    
    if (typeof comparator === 'string') {
      // Sort by property name
      const aVal = a[comparator];
      const bVal = b[comparator];
      
      if (aVal < bVal) return -1;
      if (aVal > bVal) return 1;
      return 0;
    }
    
    // Default comparison
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
}

/**
 * Regex tool executor
 */
class RegexTool implements ToolExecutor {
  async execute(action: string, parameters: Record<string, any>): Promise<any> {
    const { pattern, text, flags = 'g' } = parameters;
    
    try {
      const regex = new RegExp(pattern, flags);
      
      switch (parameters.action || action) {
        case 'match':
          return text.match(regex);
        case 'test':
          return regex.test(text);
        case 'replace':
          return text.replace(regex, parameters.replacement || '');
        default:
          throw new Error(`Unknown regex action: ${parameters.action}`);
      }
    } catch (error) {
      throw new Error(`Regex operation failed: ${error}`);
    }
  }
}

/**
 * Universal Data Converter - SQL Results to Cortex Format
 */
class SqlToCortexConverter implements ToolExecutor {
  async execute(_action: string, parameters: Record<string, any>): Promise<any> {
    const { data, query, metadata } = parameters;
    
    if (!data || !Array.isArray(data)) {
      return this.createErrorFrame('Invalid SQL result data');
    }
    
    // Convert SQL results to Cortex list format
    const cortexExpression: CortexExpression = {
      type: 'frame',
      name: 'sql_result',
      frame: 'list' as any,
      roles: {
        query: query || 'unknown',
        count: data.length,
        columns: metadata?.columns || Object.keys(data[0] || {}),
        data: this.convertSqlRows(data),
        metadata: {
          source: 'sql',
          timestamp: new Date().toISOString(),
          database: metadata?.database || 'unknown'
        }
      },
      metadata: {
        semanticDensity: this.calculateDensity(data),
        primitiveCount: data.length * (metadata?.columns?.length || Object.keys(data[0] || {}).length)
      }
    };
    
    return cortexExpression;
  }
  
  private convertSqlRows(rows: any[]): any {
    return {
      type: 'list',
      items: rows.map((row, index) => ({
        type: 'entity',
        name: `row_${index}`,
        properties: Object.entries(row).map(([key, value]) => ({
          role: key,
          value: this.convertValue(value)
        }))
      }))
    };
  }
  
  private convertValue(value: any): any {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return value;
    if (value instanceof Date) return value.toISOString();
    return String(value);
  }
  
  private calculateDensity(data: any[]): number {
    if (!data.length) return 0;
    const totalCells = data.length * Object.keys(data[0] || {}).length;
    const nonNullCells = data.reduce((sum, row) => 
      sum + Object.values(row).filter(v => v !== null && v !== undefined).length, 0
    );
    return nonNullCells / totalCells;
  }
  
  private createErrorFrame(message: string): CortexExpression {
    return {
      type: 'frame',
      name: 'error',
      frame: 'error' as any,
      roles: {
        message,
        timestamp: new Date().toISOString()
      },
      metadata: {}
    };
  }
}

/**
 * Universal Data Converter - JSON to Cortex Format
 */
class JsonToCortexConverter implements ToolExecutor {
  async execute(_action: string, parameters: Record<string, any>): Promise<any> {
    const { data, schema, context } = parameters;
    
    if (!data) {
      return this.createErrorFrame('No JSON data provided');
    }
    
    try {
      const jsonData = typeof data === 'string' ? JSON.parse(data) : data;
      return this.convertToCortex(jsonData, schema, context);
    } catch (error) {
      return this.createErrorFrame(`JSON parsing error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private convertToCortex(data: any, _schema?: any, context?: string): CortexExpression {
    const dataType = Array.isArray(data) ? 'array' : typeof data;
    
    switch (dataType) {
      case 'array':
        return this.convertArray(data, context);
      case 'object':
        return this.convertObject(data, context);
      default:
        return this.convertPrimitive(data, context);
    }
  }
  
  private convertArray(data: any[], context?: string): CortexExpression {
    return {
      type: 'frame',
      name: 'list',
      frame: 'list' as any,
      roles: {
        context: context || 'json_array',
        count: data.length,
        items: data.map((item, index) => 
          this.convertToCortex(item, null, `item_${index}`)
        )
      },
      metadata: {
        semanticDensity: 0.8,
        primitiveCount: this.countPrimitives(data)
      }
    };
  }
  
  private convertObject(data: Record<string, any>, context?: string): CortexExpression {
    const roles: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(data)) {
      // Convert camelCase to snake_case for Cortex
      const cortexKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      roles[cortexKey] = this.convertValue(value);
    }
    
    return {
      type: 'frame',
      name: context || 'entity',
      frame: 'entity' as any,
      roles,
      metadata: {
        semanticDensity: 0.9,
        primitiveCount: Object.keys(data).length
      }
    };
  }
  
  private convertPrimitive(data: any, context?: string): CortexExpression {
    return {
      type: 'primitive',
      name: context || 'value',
      frame: 'primitive' as any,
      value: this.convertValue(data),
      roles: {},
      metadata: {
        semanticDensity: 1.0,
        primitiveCount: 1
      }
    };
  }
  
  private convertValue(value: any): any {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return value;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') return this.convertToCortex(value);
    return String(value);
  }
  
  private countPrimitives(data: any): number {
    if (Array.isArray(data)) {
      return data.reduce((sum: number, item) => sum + this.countPrimitives(item), 0);
    }
    if (typeof data === 'object' && data !== null) {
      return Object.values(data).reduce((sum: number, value: any) => {
        const primitiveCount = this.countPrimitives(value as any);
        return sum + (typeof primitiveCount === 'number' ? primitiveCount : 0);
      }, 0);
    }
    return 1;
  }
  
  private createErrorFrame(message: string): CortexExpression {
    return {
      type: 'frame',
      name: 'error',
      frame: 'error' as any,
      roles: {
        message,
        timestamp: new Date().toISOString()
      },
      metadata: {}
    };
  }
}

/**
 * Universal Data Converter - API Response to Cortex Format
 */
class ApiToCortexConverter implements ToolExecutor {
  async execute(_action: string, parameters: Record<string, any>): Promise<any> {
    const { response, endpoint, method, headers } = parameters;
    
    if (!response) {
      return this.createErrorFrame('No API response provided');
    }
    
    // Extract response data
    const statusCode = response.status || response.statusCode || 200;
    const responseData = response.data || response.body || response;
    const responseHeaders = response.headers || headers || {};
    
    // Convert to Cortex format
    const cortexExpression: CortexExpression = {
      type: 'frame',
      name: 'api_response',
      frame: 'answer' as any,
      roles: {
        endpoint: endpoint || 'unknown',
        method: method || 'GET',
        status: this.mapStatusToSemantic(statusCode),
        status_code: statusCode,
        headers: this.convertHeaders(responseHeaders),
        data: this.convertResponseData(responseData),
        metadata: {
          timestamp: new Date().toISOString(),
          latency: response.latency || null,
          cache_hit: response.cacheHit || false
        }
      },
      metadata: {
        semanticDensity: 0.85,
        primitiveCount: this.countPrimitives(responseData)
      }
    };
    
    return cortexExpression;
  }
  
  private mapStatusToSemantic(statusCode: number): string {
    if (statusCode >= 200 && statusCode < 300) return 'success';
    if (statusCode >= 300 && statusCode < 400) return 'redirect';
    if (statusCode >= 400 && statusCode < 500) return 'client_error';
    if (statusCode >= 500) return 'server_error';
    return 'unknown';
  }
  
  private convertHeaders(headers: Record<string, any>): Record<string, any> {
    const converted: Record<string, any> = {};
    for (const [key, value] of Object.entries(headers)) {
      // Convert header names to snake_case
      const cortexKey = key.toLowerCase().replace(/-/g, '_');
      converted[cortexKey] = value;
    }
    return converted;
  }
  
  private convertResponseData(data: any): any {
    // Use JSON converter for complex data
    const jsonConverter = new JsonToCortexConverter();
    return jsonConverter.execute('convert', { data });
  }
  
  private countPrimitives(data: any): number {
    if (Array.isArray(data)) {
      return data.reduce((sum: number, item) => sum + this.countPrimitives(item), 0);
    }
    if (typeof data === 'object' && data !== null) {
      return Object.values(data).reduce((sum: number, value: any) => {
        const primitiveCount = this.countPrimitives(value as any);
        return sum + (typeof primitiveCount === 'number' ? primitiveCount : 0);
      }, 0);
    }
    return 1;
  }
  
  private createErrorFrame(message: string): CortexExpression {
    return {
      type: 'frame',
      name: 'error',
      frame: 'error' as any,
      roles: {
        message,
        timestamp: new Date().toISOString()
      },
      metadata: {}
    };
  }
}

/**
 * Date/time tool executor
 */
class DateTimeTool implements ToolExecutor {
  async execute(action: string, parameters: Record<string, any>): Promise<any> {
    switch (parameters.action || action) {
      case 'now':
        return new Date().toISOString();
      case 'parse':
        return new Date(parameters.date).toISOString();
      case 'format':
        return this.formatDate(parameters.date, parameters.format);
      case 'add':
        return this.addToDate(parameters.date, parameters.amount, parameters.unit);
      case 'diff':
        return this.dateDifference(parameters.date1, parameters.date2, parameters.unit);
      default:
        throw new Error(`Unknown date/time action: ${parameters.action || action}`);
    }
  }
  
  private formatDate(date: string | Date, format: string): string {
    const d = new Date(date);
    
    // Handle various format strings
    switch (format.toUpperCase()) {
      case 'ISO':
      case 'ISO8601':
        return d.toISOString();
      
      case 'UTC':
        return d.toUTCString();
      
      case 'DATE':
        return d.toDateString();
      
      case 'TIME':
        return d.toTimeString();
      
      case 'LOCALE':
        return d.toLocaleString();
      
      case 'YYYY-MM-DD':
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      
      case 'DD/MM/YYYY':
        return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      
      case 'MM/DD/YYYY':
        return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
      
      case 'TIMESTAMP':
        return String(d.getTime());
      
      case 'UNIX':
        return String(Math.floor(d.getTime() / 1000));
      
      default:
        // Custom format - replace tokens
        let formatted = format;
        formatted = formatted.replace('YYYY', String(d.getFullYear()));
        formatted = formatted.replace('YY', String(d.getFullYear()).slice(-2));
        formatted = formatted.replace('MM', String(d.getMonth() + 1).padStart(2, '0'));
        formatted = formatted.replace('DD', String(d.getDate()).padStart(2, '0'));
        formatted = formatted.replace('HH', String(d.getHours()).padStart(2, '0'));
        formatted = formatted.replace('mm', String(d.getMinutes()).padStart(2, '0'));
        formatted = formatted.replace('ss', String(d.getSeconds()).padStart(2, '0'));
        return formatted;
    }
  }
  
  private addToDate(date: string | Date, amount: number, unit: string): string {
    const d = new Date(date);
    
    switch (unit) {
      case 'days':
        d.setDate(d.getDate() + amount);
        break;
      case 'hours':
        d.setHours(d.getHours() + amount);
        break;
      case 'minutes':
        d.setMinutes(d.getMinutes() + amount);
        break;
    }
    
    return d.toISOString();
  }
  
  private dateDifference(date1: string | Date, date2: string | Date, unit: string): number {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    const diff = d2.getTime() - d1.getTime();
    
    switch (unit) {
      case 'days':
        return diff / (1000 * 60 * 60 * 24);
      case 'hours':
        return diff / (1000 * 60 * 60);
      case 'minutes':
        return diff / (1000 * 60);
      default:
        return diff;
    }
  }
}
