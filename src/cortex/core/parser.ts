/**
 * Cortex Parser
 * Converts natural language into Cortex expressions
 */

import { 
  CortexExpression, 
  FrameType, 
  CortexQuery,
  ValidationResult,
  isValidFrameType 
} from '../types';
import { trueCortexParser } from './semanticParser';
import { loggingService } from '../../services/logging.service';

export class CortexParser {
  constructor() {
  }
  
  /**
   * Parse natural language input into a TRUE Cortex expression (LISP format)
   */
  public parseNaturalLanguage(input: string): CortexExpression {
    // Use the true semantic parser for proper Cortex format
    const trueCortexLisp = trueCortexParser.parseToTrueCortex(input);
    
    // Convert LISP format to CortexExpression interface for compatibility
    const expression = this.lispToCortexExpression(trueCortexLisp);
    
    loggingService.info('True Cortex parsing completed', {
      input: input.substring(0, 50),
      cortexFormat: trueCortexLisp.substring(0, 100),
      primitiveCount: this.countPrimitives(trueCortexLisp)
    });
    
    return expression;
  }
  
  /**
   * Parse classic examples with guaranteed format
   */
  public parseClassicExample(input: string): string {
    if (input.toLowerCase().includes('fox') && input.toLowerCase().includes('dog')) {
      return trueCortexParser.parseClassicExample(input);
    }
    if (input.toLowerCase().includes('star wars')) {
      return trueCortexParser.parseStarWarsExample(input);
    }
    return trueCortexParser.parseToTrueCortex(input);
  }
  
  /**
   * Convert a simple query into optimized TRUE Cortex format
   */
  public parseQuery(query: string): CortexQuery {
    // Generate true Cortex LISP format
    const trueCortexLisp = trueCortexParser.parseToTrueCortex(query);
    
    // Store both formats for compatibility
    const expression = this.lispToCortexExpression(trueCortexLisp);
    
    return {
      ...expression,
      metadata: {
        ...expression.metadata,
        trueCortexFormat: trueCortexLisp, // Store the true LISP format
        primitiveCount: this.countPrimitives(trueCortexLisp),
        semanticDensity: this.calculateSemanticDensity(query, trueCortexLisp)
      },
      optimizationHints: {
        targetTokenReduction: 0.6, // Higher reduction with true Cortex
        prioritize: 'cost',
        enableCaching: true,
        enableCompression: true
      },
      routingPreferences: {
        allowFallback: true
      }
    } as CortexQuery;
  }
  
  /**
   * Validate a Cortex expression
   */
  public validateExpression(expr: CortexExpression): ValidationResult {
    const errors: ValidationResult['errors'] = [];
    const warnings: ValidationResult['warnings'] = [];
    const suggestions: ValidationResult['suggestions'] = [];
    
    // Validate frame type
    if (!isValidFrameType(expr.frame)) {
      errors.push({
        path: 'frame',
        message: `Invalid frame type: ${expr.frame}`,
        code: 'INVALID_FRAME'
      });
    }
    
    // Validate required roles based on frame type
    const requiredRoles = this.getRequiredRoles(expr.frame);
    for (const role of requiredRoles) {
      if (!(role in expr.roles)) {
        errors.push({
          path: `roles.${role}`,
          message: `Missing required role: ${role}`,
          code: 'MISSING_ROLE'
        });
      }
    }
    
    // Check for optimization opportunities
    if (Object.keys(expr.roles).length > 10) {
      suggestions.push({
        type: 'simplification',
        description: 'Consider breaking this into multiple smaller expressions',
        potentialSavings: 0.2
      });
    }
    
    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
      suggestions: suggestions.length > 0 ? suggestions : undefined
    };
  }
  
  
  /**
   * Get required roles for a frame type
   */
  private getRequiredRoles(frame: FrameType): string[] {
    const requirements: Record<FrameType, string[]> = {
      'query': ['action'],
      'answer': ['content'],
      'event': ['action', 'agent'],
      'state': ['entity', 'properties'],
      'entity': ['type'],
      'list': ['items'],
      'error': ['code', 'message'],
      'context': ['session_id'],
      'temporal_query': ['predict', 'time_horizon'],
      'multimodal_query': ['analyze', 'media'],
      'meta_instruction': ['optimize_for']
    };
    
    return requirements[frame] || [];
  }
  
  /**
   * Convert LISP format to CortexExpression interface
   */
  private lispToCortexExpression(lispFormat: string): CortexExpression {
    // Extract the main frame type
    const frameMatch = lispFormat.match(/^\s*\((\w+):/);
    const frame = frameMatch ? frameMatch[1] as FrameType : 'query' as FrameType;
    
    // Parse roles from LISP format
    const roles = this.parseLispRoles(lispFormat);
    
    return {
      frame,
      roles,
      metadata: {
        timestamp: Date.now(),
        source: 'true_cortex_parser',
        version: '1.0.0',
        trueCortexFormat: lispFormat
      }
    };
  }
  
  /**
   * Parse roles from LISP format
   */
  private parseLispRoles(lispFormat: string): Record<string, any> {
    const roles: Record<string, any> = {};
    
    // Extract task patterns for multi-task queries
    const taskPattern = /\(task_(\d+):\s*([\s\S]*?)\n\s*\)/g;
    let taskMatch;
    while ((taskMatch = taskPattern.exec(lispFormat)) !== null) {
      const taskId = taskMatch[1];
      const taskContent = taskMatch[2];
      roles[`task_${taskId}`] = this.parseTaskContent(taskContent);
    }
    
    // Extract single-task roles
    if (Object.keys(roles).length === 0) {
      const rolePattern = /(\w+):\s*([^\n]+)/g;
      let roleMatch;
      while ((roleMatch = rolePattern.exec(lispFormat)) !== null) {
        const [, role, value] = roleMatch;
        roles[role] = this.parseRoleValue(value);
      }
    }
    
    return roles;
  }
  
  /**
   * Parse task content
   */
  private parseTaskContent(content: string): any {
    const task: any = {};
    const rolePattern = /(\w+):\s*([^\n]+)/g;
    let roleMatch;
    
    while ((roleMatch = rolePattern.exec(content)) !== null) {
      const [, role, value] = roleMatch;
      task[role] = this.parseRoleValue(value);
    }
    
    return task;
  }
  
  /**
   * Parse role value from LISP format
   */
  private parseRoleValue(value: string): any {
    const trimmed = value.trim();
    
    // Handle references
    if (trimmed.startsWith('$')) {
      return { _reference: trimmed };
    }
    
    // Handle primitive IDs with comments
    const primitiveMatch = trimmed.match(/^(\d+)\s*\/\/\s*\d+\s*=\s*(\w+)/);
    if (primitiveMatch) {
      return parseInt(primitiveMatch[1]);
    }
    
    // Handle quoted strings
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1);
    }
    
    // Handle numbers
    if (/^\d+$/.test(trimmed)) {
      return parseInt(trimmed);
    }
    
    // Handle nested entities
    if (trimmed.startsWith('(entity:')) {
      return this.parseNestedEntity(trimmed);
    }
    
    // Handle arrays
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const arrayContent = trimmed.slice(1, -1);
      return arrayContent.split(',').map(item => this.parseRoleValue(item.trim()));
    }
    
    return trimmed;
  }
  
  /**
   * Parse nested entity from LISP format
   */
  private parseNestedEntity(entityStr: string): any {
    const entity: any = {};
    
    // Extract entity type/concept
    const conceptMatch = entityStr.match(/entity:(\d+)/);
    if (conceptMatch) {
      entity.concept = parseInt(conceptMatch[1]);
    }
    
    // Extract properties array
    const propMatch = entityStr.match(/properties:\[([^\]]+)\]/);
    if (propMatch) {
      entity.properties = propMatch[1].split(',').map(p => parseInt(p.trim()));
    }
    
    // Extract definiteness
    const defMatch = entityStr.match(/definiteness:(\d+|definite|indefinite)/);
    if (defMatch) {
      const def = defMatch[1];
      entity.definiteness = isNaN(Number(def)) ? def : parseInt(def);
    }
    
    return entity;
  }
  
  /**
   * Count primitive usage in LISP format
   */
  private countPrimitives(lispFormat: string): number {
    // Count primitive ID references
    const primitiveMatches = lispFormat.match(/\d+\s*\/\//g);
    return primitiveMatches ? primitiveMatches.length : 0;
  }
  
  /**
   * Calculate semantic density (meaning per token)
   */
  private calculateSemanticDensity(original: string, cortex: string): number {
    const originalTokens = original.split(/\s+/).length;
    const cortexPrimitives = this.countPrimitives(cortex);
    
    // Higher density = more meaning per token
    return cortexPrimitives / originalTokens;
  }
  
  /**
   * Parse complex multi-task queries using True Cortex format
   */
  public parseMultiTaskQuery(input: string): CortexQuery {
    const tasks = this.splitIntoTasks(input);
    const subtasks = tasks.map((task, index) => ({
      [`task_${index + 1}`]: this.parseNaturalLanguage(task)
    }));
    
    return {
      frame: 'query',
      roles: Object.assign({}, ...subtasks),
      metadata: {
        timestamp: Date.now(),
        source: 'multi_task_parser',
        version: '1.0.0'
      },
      optimizationHints: {
        targetTokenReduction: 0.6,
        prioritize: 'cost',
        enableCaching: true,
        enableCompression: true
      }
    } as CortexQuery;
  }
  
  /**
   * Split input into multiple tasks
   */
  private splitIntoTasks(input: string): string[] {
    // Split by conjunctions and punctuation
    const splitPatterns = [
      /\s+and\s+/i,
      /[,;]/,
      /\s+then\s+/i,
      /\s+also\s+/i
    ];
    
    let tasks = [input];
    for (const pattern of splitPatterns) {
      const newTasks = [];
      for (const task of tasks) {
        newTasks.push(...task.split(pattern));
      }
      tasks = newTasks;
    }
    
    return tasks.filter(t => t.trim().length > 0).map(t => t.trim());
  }
}

/**
 * Singleton instance for easy access
 */
export const cortexParser = new CortexParser();
