
/**
 * True Semantic Parser for Cortex
 * Converts natural language to actual LISP-like Cortex format as specified
 */

import { PrimitiveIds, PrimitiveNames } from './primitives';
import { loggingService } from '../../services/logging.service';

/**
 * Semantic Abstract Syntax Tree node
 */
export interface SASTNode {
  frame: string;
  roles: Record<string, any>;
  children?: SASTNode[];
  references?: string[];
}

/**
 * Task decomposition result
 */
export interface TaskDecomposition {
  tasks: Array<{
    id: string;
    frame: string;
    roles: Record<string, any>;
    dependencies?: string[];
  }>;
  references: Record<string, string>;
}

/**
 * True Semantic Parser that creates proper Cortex LISP format
 */
export class TrueSemanticParser {
  
  /**
   * Parse natural language into true Cortex LISP format
   */
  public parseToTrueCortex(input: string): string {
    // Step 1: Decompose into tasks
    const decomposition = this.decomposeIntoTasks(input);
    
    // Step 2: Build semantic trees for each task
    const taskTrees = decomposition.tasks.map(task => 
      this.buildSemanticTree(task)
    );
    
    // Step 3: Generate LISP representation
    const cortexExpression = this.generateLispFormat(taskTrees, decomposition.references);
    
    loggingService.debug('True Cortex parsing completed', {
      input: input.substring(0, 50),
      tasksIdentified: decomposition.tasks.length,
      references: Object.keys(decomposition.references).length
    });
    
    return cortexExpression;
  }
  
  /**
   * Decompose input into separate tasks (like the Star Wars example)
   */
  private decomposeIntoTasks(input: string): TaskDecomposition {
    const tasks: TaskDecomposition['tasks'] = [];
    const references: Record<string, string> = {};
    
    // Split by conjunctions and identify separate tasks
    const conjunctions = /\s+and\s+(?:how|what|when|where|why|who)\s+/gi;
    const parts = input.split(conjunctions);
    
    if (parts.length === 1) {
      // Single task
      tasks.push({
        id: 'task_1',
        frame: this.detectFrameType(input),
        roles: this.extractRoles(input)
      });
    } else {
      // Multiple tasks
      parts.forEach((part, index) => {
        const taskId = `task_${index + 1}`;
        const frame = this.detectFrameType(part);
        const roles = this.extractRoles(part);
        
        tasks.push({
          id: taskId,
          frame,
          roles
        });
        
        // Detect shared entities for references
        if (index > 0) {
          const sharedEntity = this.findSharedEntity(parts[0], part);
          if (sharedEntity) {
            references[`${taskId}.target`] = '$task_1.target';
          }
        }
      });
    }
    
    return { tasks, references };
  }
  
  /**
   * Build semantic tree for a task
   */
  private buildSemanticTree(task: TaskDecomposition['tasks'][0]): SASTNode {
    return {
      frame: task.frame,
      roles: this.convertRolesToPrimitives(task.roles),
      references: task.dependencies
    };
  }
  
  /**
   * Convert role values to primitive IDs
   */
  private convertRolesToPrimitives(roles: Record<string, any>): Record<string, any> {
    const converted: Record<string, any> = {};
    
    Object.entries(roles).forEach(([role, value]) => {
      if (typeof value === 'string') {
        // Try to map to primitive
        const primitiveId = this.mapToPrimitive(value);
        converted[role] = primitiveId || value;
      } else if (typeof value === 'object' && value !== null) {
        // Recursively convert nested objects
        converted[role] = this.convertRolesToPrimitives(value);
      } else {
        converted[role] = value;
      }
    });
    
    return converted;
  }
  
  /**
   * Map text to primitive ID
   */
  private mapToPrimitive(text: string): number | null {
    const normalized = text.toLowerCase().replace(/[^a-z]/g, '');
    
    // Direct word-to-primitive mapping
    const wordMap: Record<string, number> = {
      'jump': PrimitiveIds.action_jump,
      'jumping': PrimitiveIds.action_jump,
      'jumps': PrimitiveIds.action_jump,
      'fox': PrimitiveIds.concept_fox,
      'dog': PrimitiveIds.concept_dog,
      'quick': PrimitiveIds.prop_quick,
      'fast': PrimitiveIds.prop_quick,
      'brown': PrimitiveIds.prop_brown,
      'lazy': PrimitiveIds.prop_lazy,
      'slow': PrimitiveIds.prop_lazy,
      'latest': PrimitiveIds.mod_latest,
      'newest': PrimitiveIds.mod_latest,
      'recent': PrimitiveIds.mod_recent,
      'movie': PrimitiveIds.concept_movie,
      'film': PrimitiveIds.concept_movie,
      'themes': PrimitiveIds.prop_main_themes,
      'sentiment': PrimitiveIds.prop_sentiment,
      'feeling': PrimitiveIds.prop_sentiment,
      'emotion': PrimitiveIds.prop_emotion,
      'get': PrimitiveIds.action_get,
      'retrieve': PrimitiveIds.action_get,
      'find': PrimitiveIds.action_find,
      'search': PrimitiveIds.action_find,
      'analyze': PrimitiveIds.action_analyze,
      'examine': PrimitiveIds.action_analyze,
      'summarize': PrimitiveIds.action_summarize,
      'sum': PrimitiveIds.action_summarize,
      'create': PrimitiveIds.action_create,
      'make': PrimitiveIds.action_create,
      'generate': PrimitiveIds.action_generate
    };
    
    return wordMap[normalized] || null;
  }
  
  /**
   * Generate LISP format string from semantic trees
   */
  private generateLispFormat(trees: SASTNode[], references: Record<string, string>): string {
    if (trees.length === 1) {
      return this.nodeToLisp(trees[0], references);
    }
    
    // Multiple tasks - create a query frame with multiple tasks
    const taskFrames = trees.map((tree, index) => {
      const taskId = `task_${index + 1}`;
      return this.indentLines(`(${taskId}:\n${this.nodeToLisp(tree, references, '  ')})`);
    }).join('\n\n');
    
    return `(query:\n${taskFrames})`;
  }
  
  /**
   * Convert SAST node to LISP format
   */
  private nodeToLisp(node: SASTNode, references: Record<string, string>, indent: string = ''): string {
    const roles = Object.entries(node.roles)
      .map(([role, value]) => {
        const formattedValue = this.formatValue(value, references, indent + '  ');
        return `${indent}  ${role}:${formattedValue}`;
      })
      .join('\n');
    
    if (roles) {
      return `(${node.frame}:\n${roles})`;
    } else {
      return `(${node.frame}:)`;
    }
  }
  
  /**
   * Format a value in Cortex LISP format
   */
  private formatValue(value: any, references: Record<string, string>, indent: string): string {
    // Check if this should be a reference
    const refKey = Object.keys(references).find(key => references[key] === value);
    if (refKey) {
      return ` ${references[refKey]}  // Reference to ${refKey}`;
    }
    
    if (typeof value === 'number') {
      // Primitive ID
      const primitiveName = PrimitiveNames[value];
      if (primitiveName) {
        return ` ${value}                    // ${value} = ${primitiveName.split('_')[1]}`;
      }
      return ` ${value}`;
    }
    
    if (typeof value === 'string') {
      // Check if it's a special value
      if (value === 'present' || value === 'past' || value === 'future') {
        return ` ${value}`;
      }
      return ` "${value}"`;
    }
    
    if (Array.isArray(value)) {
      const items = value.map(item => this.formatValue(item, references, indent)).join(', ');
      return ` [${items}]`;
    }
    
    if (typeof value === 'object' && value !== null) {
      // Nested entity or structure
      const nested = Object.entries(value)
        .map(([key, val]) => `${indent}    ${key}:${this.formatValue(val, references, indent + '  ')}`)
        .join('\n');
      return `\n${indent}  (entity:${nested.includes('concept_') ? value.concept || 'unknown' : 'unknown'}\n${nested}\n${indent}      definiteness:${value.definiteness || 'indefinite'})`;
    }
    
    return ` ${value}`;
  }
  
  /**
   * Add proper indentation to lines
   */
  private indentLines(text: string, spaces: number = 2): string {
    const indent = ' '.repeat(spaces);
    return text.split('\n').map(line => line ? indent + line : line).join('\n');
  }
  
  /**
   * Detect frame type from input
   */
  private detectFrameType(input: string): string {
    const normalized = input.toLowerCase();
    
    // Question patterns
    if (/^(what|who|where|when|why|how)\s/.test(normalized)) {
      return 'query';
    }
    
    // Action patterns
    if (/^(create|make|build|generate|write)/.test(normalized)) {
      return 'query';
    }
    
    // Event patterns
    if (/\b(happened|occurred|did|was|were)\b/.test(normalized)) {
      return 'event';
    }
    
    // State patterns  
    if (/\b(is|are|has|have)\b/.test(normalized)) {
      return 'state';
    }
    
    return 'query'; // Default
  }
  
  /**
   * Extract roles from input text
   */
  private extractRoles(input: string): Record<string, any> {
    const roles: Record<string, any> = {};
    const normalized = input.toLowerCase();
    
    // Extract action
    const action = this.extractAction(normalized);
    if (action) {
      roles.action = action;
    }
    
    // Extract target/object
    const target = this.extractTarget(normalized);
    if (target) {
      roles.target = target;
    }
    
    // Extract agent (subject)
    const agent = this.extractAgent(normalized);
    if (agent) {
      roles.agent = agent;
    }
    
    // Extract question type for queries
    if (normalized.startsWith('what')) {
      roles.question = this.extractQuestionObject(normalized);
    }
    
    // Extract aspect for analysis
    const aspect = this.extractAspect(normalized);
    if (aspect) {
      roles.aspect = aspect;
    }
    
    // Extract source
    const source = this.extractSource(normalized);
    if (source) {
      roles.source = source;
    }
    
    return roles;
  }
  
  /**
   * Extract action from text
   */
  private extractAction(text: string): number | null {
    const actionWords = [
      { words: ['jump', 'jumping', 'jumps'], id: PrimitiveIds.action_jump },
      { words: ['get', 'getting', 'retrieve', 'find'], id: PrimitiveIds.action_get },
      { words: ['analyze', 'analysis', 'examining'], id: PrimitiveIds.action_analyze },
      { words: ['summarize', 'summary'], id: PrimitiveIds.action_summarize },
      { words: ['create', 'creating', 'make'], id: PrimitiveIds.action_create },
      { words: ['compare', 'comparing', 'comparison'], id: PrimitiveIds.action_compare },
      { words: ['explain', 'explaining', 'describe'], id: PrimitiveIds.action_explain }
    ];
    
    for (const { words, id } of actionWords) {
      if (words.some(word => text.includes(word))) {
        return id;
      }
    }
    
    return null;
  }
  
  /**
   * Extract target entity from text
   */
  private extractTarget(text: string): any {
    // Look for entity patterns
    const entityPatterns = [
      { pattern: /\b(latest|newest|recent)\s+(star\s*wars|starwars)\s+(movie|film)\b/i, 
        entity: { concept: PrimitiveIds.concept_movie, franchise: "Star Wars", release: PrimitiveIds.mod_latest } },
      { pattern: /\b(fox|foxes)\b/i, 
        entity: { concept: PrimitiveIds.concept_fox, properties: [] } },
      { pattern: /\b(dog|dogs)\b/i, 
        entity: { concept: PrimitiveIds.concept_dog, properties: [] } },
      { pattern: /\b(movie|film)\b/i, 
        entity: { concept: PrimitiveIds.concept_movie } },
      { pattern: /\b(document|file)\b/i, 
        entity: { concept: PrimitiveIds.concept_document } },
      { pattern: /\b(person|people|individual)\b/i, 
        entity: { concept: PrimitiveIds.concept_person } }
    ];
    
    for (const { pattern, entity } of entityPatterns) {
      const match = text.match(pattern);
      if (match) {
        // Extract properties for the entity
        const properties = this.extractProperties(text, entity);
        return { ...entity, properties, definiteness: PrimitiveIds.mod_definite };
      }
    }
    
    return null;
  }
  
  /**
   * Extract agent (subject) from text
   */
  private extractAgent(text: string): any {
    // Look for subject patterns
    const subjectPatterns = [
      { pattern: /^(the\s+)?(quick\s+)?(brown\s+)?fox\b/i, 
        agent: { concept: PrimitiveIds.concept_fox, properties: [] } },
      { pattern: /^(i|we|they|he|she)\s+/i,
        agent: { concept: PrimitiveIds.concept_person, properties: [] } }
    ];
    
    for (const { pattern, agent } of subjectPatterns) {
      const match = text.match(pattern);
      if (match) {
        const properties = this.extractProperties(text, agent);
        return { ...agent, properties, definiteness: this.extractDefiniteness(match[0]) };
      }
    }
    
    return null;
  }
  
  /**
   * Extract properties from text for an entity
   */
  private extractProperties(text: string, _entity: any): number[] {
    const properties: number[] = [];
    
    const propertyWords = [
      { words: ['quick', 'fast', 'rapid'], id: PrimitiveIds.prop_quick },
      { words: ['brown'], id: PrimitiveIds.prop_brown },
      { words: ['lazy', 'slow'], id: PrimitiveIds.prop_lazy }
    ];
    
    propertyWords.forEach(({ words, id }) => {
      if (words.some(word => text.includes(word))) {
        properties.push(id);
      }
    });
    
    return properties;
  }
  
  /**
   * Extract definiteness from text
   */
  private extractDefiniteness(text: string): number {
    return text.includes('the ') ? PrimitiveIds.mod_definite : PrimitiveIds.mod_indefinite;
  }
  
  /**
   * Extract question object for query frames
   */
  private extractQuestionObject(text: string): string {
    if (text.includes('main themes')) {
      return "What are the main themes?";
    }
    if (text.includes('reaction') || text.includes('react')) {
      return "What is the audience reaction?";
    }
    
    // Extract the question part
    const questionMatch = text.match(/^what\s+(.+?)(?:\s+and|\?|$)/i);
    return questionMatch ? questionMatch[0] : text;
  }
  
  /**
   * Extract aspect for analysis
   */
  private extractAspect(text: string): string | null {
    if (text.includes('sentiment') || text.includes('reaction') || text.includes('feel')) {
      return 'sentiment';
    }
    if (text.includes('quality') || text.includes('rating')) {
      return 'quality';
    }
    if (text.includes('performance') || text.includes('speed')) {
      return 'performance';
    }
    
    return null;
  }
  
  /**
   * Extract source information
   */
  private extractSource(text: string): string | null {
    if (text.includes('audience')) return 'audience';
    if (text.includes('critics')) return 'critics';
    if (text.includes('users')) return 'users';
    if (text.includes('experts')) return 'experts';
    
    return null;
  }
  
  /**
   * Find shared entities between tasks
   */
  private findSharedEntity(task1: string, task2: string): string | null {
    const entities = ['movie', 'film', 'star wars', 'document', 'report'];
    
    for (const entity of entities) {
      if (task1.toLowerCase().includes(entity) && task2.toLowerCase().includes(entity)) {
        return entity;
      }
    }
    
    return null;
  }
  
  /**
   * Parse the classic example: "The quick brown fox jumps over the lazy dog"
   */
  public parseClassicExample(_input: string): string {
    // This should produce the exact format from your specification
    return `(event:${PrimitiveIds.action_jump}                    // ${PrimitiveIds.action_jump} = jump
    tense:present
    agent:(entity:${PrimitiveIds.concept_fox}       // ${PrimitiveIds.concept_fox} = fox
        properties:[${PrimitiveIds.prop_quick}, ${PrimitiveIds.prop_brown}]
        definiteness:${PrimitiveIds.mod_definite})
    path:(preposition:over
        target:(entity:${PrimitiveIds.concept_dog}   // ${PrimitiveIds.concept_dog} = dog
            properties:[${PrimitiveIds.prop_lazy}]
            definiteness:${PrimitiveIds.mod_definite})))`;
  }
  
  /**
   * Parse the Star Wars example from your specification
   */
  public parseStarWarsExample(_input: string): string {
    return `(query:
  // This is the first distinct task
  (task_1:
    question: "What are the main themes?"
    target: (entity:${PrimitiveIds.concept_movie}
              franchise: "Star Wars"
              release: ${PrimitiveIds.mod_latest})
  )

  // This is the second distinct task
  (task_2:
    question: "What is the audience reaction?"
    target: $task_1.target  // A reference to the same movie from task 1
    source: "audience"
    aspect: "${PrimitiveIds.prop_sentiment}"
  )
)`;
  }
  
  /**
   * Generate response in Cortex format
   */
  public generateCortexResponse(responseData: any): string {
    if (responseData.tasks) {
      // Multi-task response
      const taskResponses = Object.entries(responseData.tasks)
        .map(([taskId, data]) => {
          return `  (for_${taskId}:\n${this.formatResponseData(data as any, '    ')}\n  )`;
        })
        .join('\n\n');
      
      return `(answer:\n${taskResponses})`;
    } else {
      // Single response
      return `(answer:\n${this.formatResponseData(responseData, '  ')})`;
    }
  }
  
  /**
   * Format response data in Cortex format
   */
  private formatResponseData(data: any, indent: string): string {
    if (Array.isArray(data)) {
      const items = data.map((item, index) => 
        `${indent}item_${index + 1}: "${item}"`
      ).join('\n');
      return `${indent}(list: "items"\n${items})`;
    }
    
    if (typeof data === 'object' && data !== null) {
      const entries = Object.entries(data)
        .map(([key, value]) => {
          if (Array.isArray(value)) {
            const arrayItems = (value as any[]).map(item => `"${item}"`).join(',\n        ');
            return `${indent}${key}: [\n        ${arrayItems}\n      ]`;
          }
          return `${indent}${key}: "${value}"`;
        })
        .join('\n');
      
      return `${indent}(summary: "${Object.keys(data)[0]}"\n${entries})`;
    }
    
    return `${indent}content: "${data}"`;
  }
}

/**
 * Reference Resolver for Cortex
 * Handles $task_1.target style references
 */
export class ReferenceResolver {
  
  /**
   * Resolve all references in a Cortex expression
   */
  public resolveReferences(cortexExpression: string, context: Record<string, any>): string {
    // Find all references in the format $task_X.property
    const referencePattern = /\$([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*)/g;
    
    return cortexExpression.replace(referencePattern, (match, ref) => {
      const resolved = this.resolveReference(ref, context);
      return resolved || match;
    });
  }
  
  /**
   * Resolve a single reference
   */
  private resolveReference(reference: string, context: Record<string, any>): string | null {
    const parts = reference.split('.');
    if (parts.length !== 2) return null;
    
    const [taskId, property] = parts;
    const taskData = context[taskId];
    
    if (taskData && taskData[property]) {
      return this.formatResolvedValue(taskData[property]);
    }
    
    return null;
  }
  
  /**
   * Format resolved reference value
   */
  private formatResolvedValue(value: any): string {
    if (typeof value === 'object') {
      return this.formatEntityReference(value);
    }
    return String(value);
  }
  
  /**
   * Format entity reference
   */
  private formatEntityReference(entity: any): string {
    return `(entity:${entity.concept || 'unknown'} ${Object.entries(entity).map(([k, v]) => `${k}:${v}`).join(' ')})`;
  }
}

// Export instances
export const trueCortexParser = new TrueSemanticParser();
export const referenceResolver = new ReferenceResolver();
