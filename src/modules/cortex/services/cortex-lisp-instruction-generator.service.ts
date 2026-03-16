/**
 * Cortex LISP Instruction Generator Service
 *
 * Generates LISP-style instructions for Cortex processing operations.
 * Translates semantic frames into executable LISP code for the Cortex engine.
 */

import { Injectable, Logger } from '@nestjs/common';
import { CortexFrame } from '../types/cortex.types';

export interface LispInstruction {
  instruction: string;
  parameters: Record<string, any>;
  metadata: {
    complexity: number;
    estimatedTokens: number;
    executionOrder: number;
    combined?: boolean;
    originalOps?: number;
    folded?: boolean;
    originalInstruction?: LispInstruction;
    [key: string]: unknown;
  };
  type?: string;
  variable?: string;
  value?: unknown;
  operation?: string;
  operand1?: unknown;
  operand2?: unknown;
  result?: unknown;
  name?: string;
  body?: unknown[];
  functionName?: string;
}

export interface LispProgram {
  instructions: LispInstruction[];
  metadata: {
    totalComplexity: number;
    estimatedTokens: number;
    executionTime: number;
    dependencies: string[];
  };
}

@Injectable()
export class CortexLispInstructionGeneratorService {
  private readonly logger = new Logger(
    CortexLispInstructionGeneratorService.name,
  );

  /**
   * Generate LISP instructions from a Cortex frame
   */
  generateInstructions(frame: CortexFrame): LispProgram {
    const instructions: LispInstruction[] = [];

    try {
      switch (frame.frameType) {
        case 'query':
          instructions.push(...this.generateQueryInstructions(frame));
          break;
        case 'answer':
          instructions.push(...this.generateAnswerInstructions(frame));
          break;
        case 'event':
          instructions.push(...this.generateEventInstructions(frame));
          break;
        case 'state':
          instructions.push(...this.generateStateInstructions(frame));
          break;
        case 'entity':
          instructions.push(...this.generateEntityInstructions(frame));
          break;
        case 'list':
          instructions.push(...this.generateListInstructions(frame));
          break;
        case 'conditional':
          instructions.push(...this.generateConditionalInstructions(frame));
          break;
        case 'loop':
          instructions.push(...this.generateLoopInstructions(frame));
          break;
        case 'sequence':
          instructions.push(...this.generateSequenceInstructions(frame));
          break;
        default:
          instructions.push(this.generateDefaultInstructions(frame));
      }

      // Assign execution order
      instructions.forEach((instr, index) => {
        instr.metadata.executionOrder = index;
      });

      const metadata = this.calculateProgramMetadata(instructions);

      return {
        instructions,
        metadata,
      };
    } catch (error) {
      this.logger.error(
        `Failed to generate LISP instructions for frame type: ${frame.frameType}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Generate instructions for query frames
   */
  private generateQueryInstructions(frame: CortexFrame): LispInstruction[] {
    const instructions: LispInstruction[] = [];
    const f = frame as Record<string, unknown>;

    // Basic query instruction
    instructions.push({
      instruction: '(query',
      parameters: {
        target: (f.target as string) || 'unknown',
        action: (f.action as string) || 'retrieve',
        format: (f.format as string) || 'natural',
      },
      metadata: {
        complexity: 1,
        estimatedTokens: 10,
        executionOrder: 0,
      },
    });

    // Add constraints if present
    if (f.aspect) {
      instructions.push({
        instruction: '(constraint',
        parameters: {
          type: 'aspect',
          value: f.aspect,
        },
        metadata: {
          complexity: 1,
          estimatedTokens: 5,
          executionOrder: 0,
        },
      });
    }

    // Close query
    instructions.push({
      instruction: ')',
      parameters: {},
      metadata: {
        complexity: 0,
        estimatedTokens: 1,
        executionOrder: 0,
      },
    });

    return instructions;
  }

  /**
   * Generate instructions for answer frames
   */
  private generateAnswerInstructions(frame: CortexFrame): LispInstruction[] {
    const instructions: LispInstruction[] = [];
    const f = frame as Record<string, unknown>;

    instructions.push({
      instruction: '(answer',
      parameters: {
        for_task: (f.for_task as string) || 'unknown',
        status: (f.status as string) || 'complete',
        summary: (f.summary as string) || '',
      },
      metadata: {
        complexity: 1,
        estimatedTokens: 15,
        executionOrder: 0,
      },
    });

    if (f.content) {
      instructions.push({
        instruction: '(content',
        parameters: {
          value: f.content,
          type: typeof f.content,
        },
        metadata: {
          complexity: 2,
          estimatedTokens: 20,
          executionOrder: 0,
        },
      });
    }

    instructions.push({
      instruction: ')',
      parameters: {},
      metadata: {
        complexity: 0,
        estimatedTokens: 1,
        executionOrder: 0,
      },
    });

    return instructions;
  }

  /**
   * Generate instructions for event frames
   */
  private generateEventInstructions(frame: CortexFrame): LispInstruction[] {
    const instructions: LispInstruction[] = [];
    const f = frame as Record<string, unknown>;

    instructions.push({
      instruction: '(event',
      parameters: {
        action: f.action,
        agent: f.agent,
        object: f.object,
        tense: (f.tense as string) || 'present',
      },
      metadata: {
        complexity: 2,
        estimatedTokens: 25,
        executionOrder: 0,
      },
    });

    if (f.instrument) {
      instructions.push({
        instruction: '(instrument',
        parameters: { value: f.instrument },
        metadata: {
          complexity: 1,
          estimatedTokens: 5,
          executionOrder: 0,
        },
      });
    }

    if (f.location) {
      instructions.push({
        instruction: '(location',
        parameters: { value: f.location },
        metadata: {
          complexity: 1,
          estimatedTokens: 5,
          executionOrder: 0,
        },
      });
    }

    instructions.push({
      instruction: ')',
      parameters: {},
      metadata: {
        complexity: 0,
        estimatedTokens: 1,
        executionOrder: 0,
      },
    });

    return instructions;
  }

  /**
   * Generate instructions for state frames
   */
  private generateStateInstructions(frame: CortexFrame): LispInstruction[] {
    const instructions: LispInstruction[] = [];
    const f = frame as Record<string, unknown>;

    instructions.push({
      instruction: '(state',
      parameters: {
        entity: f.entity,
        condition: (f.condition as string) || 'current',
      },
      metadata: {
        complexity: 2,
        estimatedTokens: 20,
        executionOrder: 0,
      },
    });

    if (f.properties) {
      instructions.push({
        instruction: '(properties',
        parameters: { values: f.properties },
        metadata: {
          complexity: 1,
          estimatedTokens: 10,
          executionOrder: 0,
        },
      });
    }

    instructions.push({
      instruction: ')',
      parameters: {},
      metadata: {
        complexity: 0,
        estimatedTokens: 1,
        executionOrder: 0,
      },
    });

    return instructions;
  }

  /**
   * Generate instructions for entity frames
   */
  private generateEntityInstructions(frame: CortexFrame): LispInstruction[] {
    const instructions: LispInstruction[] = [];
    const f = frame as Record<string, unknown>;

    instructions.push({
      instruction: '(entity',
      parameters: {
        name: f.name,
        type: f.type,
        title: f.title,
      },
      metadata: {
        complexity: 1,
        estimatedTokens: 15,
        executionOrder: 0,
      },
    });

    if (f.properties) {
      instructions.push({
        instruction: '(attributes',
        parameters: { values: f.properties },
        metadata: {
          complexity: 1,
          estimatedTokens: 10,
          executionOrder: 0,
        },
      });
    }

    instructions.push({
      instruction: ')',
      parameters: {},
      metadata: {
        complexity: 0,
        estimatedTokens: 1,
        executionOrder: 0,
      },
    });

    return instructions;
  }

  /**
   * Generate instructions for list frames
   */
  private generateListInstructions(frame: CortexFrame): LispInstruction[] {
    const instructions: LispInstruction[] = [];
    const f = frame as Record<string, unknown>;

    instructions.push({
      instruction: '(list',
      parameters: {
        name: (f.name as string) || 'items',
      },
      metadata: {
        complexity: 1,
        estimatedTokens: 10,
        executionOrder: 0,
      },
    });

    // Generate instructions for each list item
    const roles = Object.keys(frame).filter((key) => key.startsWith('item_'));
    for (const role of roles) {
      const itemIndex = parseInt(role.replace('item_', ''));
      instructions.push({
        instruction: '(item',
        parameters: {
          index: itemIndex,
          value: (frame as any)[role],
        },
        metadata: {
          complexity: 1,
          estimatedTokens: 8,
          executionOrder: 0,
        },
      });
    }

    instructions.push({
      instruction: ')',
      parameters: {},
      metadata: {
        complexity: 0,
        estimatedTokens: 1,
        executionOrder: 0,
      },
    });

    return instructions;
  }

  /**
   * Generate instructions for conditional frames
   */
  private generateConditionalInstructions(frame: any): LispInstruction[] {
    const instructions: LispInstruction[] = [];

    instructions.push({
      instruction: '(if',
      parameters: {
        condition: frame.condition,
      },
      metadata: {
        complexity: 3,
        estimatedTokens: 30,
        executionOrder: 0,
      },
    });

    // Then branch
    if (frame.thenBranch) {
      instructions.push({
        instruction: '(then',
        parameters: {},
        metadata: {
          complexity: 2,
          estimatedTokens: 15,
          executionOrder: 0,
        },
      });

      for (const subFrame of frame.thenBranch) {
        const subInstructions = this.generateInstructions(subFrame);
        instructions.push(...subInstructions.instructions);
      }

      instructions.push({
        instruction: ')',
        parameters: {},
        metadata: {
          complexity: 0,
          estimatedTokens: 1,
          executionOrder: 0,
        },
      });
    }

    // Else branch
    if (frame.elseBranch) {
      instructions.push({
        instruction: '(else',
        parameters: {},
        metadata: {
          complexity: 2,
          estimatedTokens: 15,
          executionOrder: 0,
        },
      });

      for (const subFrame of frame.elseBranch) {
        const subInstructions = this.generateInstructions(subFrame);
        instructions.push(...subInstructions.instructions);
      }

      instructions.push({
        instruction: ')',
        parameters: {},
        metadata: {
          complexity: 0,
          estimatedTokens: 1,
          executionOrder: 0,
        },
      });
    }

    instructions.push({
      instruction: ')',
      parameters: {},
      metadata: {
        complexity: 0,
        estimatedTokens: 1,
        executionOrder: 0,
      },
    });

    return instructions;
  }

  /**
   * Generate instructions for loop frames
   */
  private generateLoopInstructions(frame: any): LispInstruction[] {
    const instructions: LispInstruction[] = [];

    const loopTypeMap: Record<string, string> = {
      for: 'for-each',
      while: 'while',
      do_while: 'do-while',
      for_of: 'for-of',
      for_in: 'for-in',
    };

    const lispLoopType = loopTypeMap[frame.loopType] || 'loop';

    instructions.push({
      instruction: `(${lispLoopType}`,
      parameters: {
        test: frame.test,
        init: frame.init,
        update: frame.update,
        maxIterations: frame.maxIterations || 100,
      },
      metadata: {
        complexity: 4,
        estimatedTokens: 40,
        executionOrder: 0,
      },
    });

    // Body instructions
    if (frame.body) {
      instructions.push({
        instruction: '(body',
        parameters: {},
        metadata: {
          complexity: 1,
          estimatedTokens: 5,
          executionOrder: 0,
        },
      });

      for (const subFrame of frame.body) {
        const subInstructions = this.generateInstructions(subFrame);
        instructions.push(...subInstructions.instructions);
      }

      instructions.push({
        instruction: ')',
        parameters: {},
        metadata: {
          complexity: 0,
          estimatedTokens: 1,
          executionOrder: 0,
        },
      });
    }

    instructions.push({
      instruction: ')',
      parameters: {},
      metadata: {
        complexity: 0,
        estimatedTokens: 1,
        executionOrder: 0,
      },
    });

    return instructions;
  }

  /**
   * Generate instructions for sequence frames
   */
  private generateSequenceInstructions(frame: any): LispInstruction[] {
    const instructions: LispInstruction[] = [];

    instructions.push({
      instruction: '(sequence',
      parameters: {
        stopOnError: frame.stopOnError || false,
        collectResults: frame.collectResults || false,
      },
      metadata: {
        complexity: 2,
        estimatedTokens: 20,
        executionOrder: 0,
      },
    });

    // Step instructions
    if (frame.steps) {
      for (let i = 0; i < frame.steps.length; i++) {
        instructions.push({
          instruction: '(step',
          parameters: { index: i },
          metadata: {
            complexity: 1,
            estimatedTokens: 5,
            executionOrder: 0,
          },
        });

        const stepInstructions = this.generateInstructions(frame.steps[i]);
        instructions.push(...stepInstructions.instructions);

        instructions.push({
          instruction: ')',
          parameters: {},
          metadata: {
            complexity: 0,
            estimatedTokens: 1,
            executionOrder: 0,
          },
        });
      }
    }

    instructions.push({
      instruction: ')',
      parameters: {},
      metadata: {
        complexity: 0,
        estimatedTokens: 1,
        executionOrder: 0,
      },
    });

    return instructions;
  }

  /**
   * Generate default instructions for unsupported frame types
   */
  private generateDefaultInstructions(frame: CortexFrame): LispInstruction {
    return {
      instruction: `(frame-type-${frame.frameType}`,
      parameters: { frame },
      metadata: {
        complexity: 1,
        estimatedTokens: 10,
        executionOrder: 0,
      },
    };
  }

  /**
   * Calculate program metadata
   */
  private calculateProgramMetadata(
    instructions: LispInstruction[],
  ): LispProgram['metadata'] {
    const totalComplexity = instructions.reduce(
      (sum, instr) => sum + instr.metadata.complexity,
      0,
    );
    const estimatedTokens = instructions.reduce(
      (sum, instr) => sum + instr.metadata.estimatedTokens,
      0,
    );
    const executionTime = Math.max(100, totalComplexity * 50); // Rough estimate

    // Extract dependencies from parameters
    const dependencies: string[] = [];
    for (const instr of instructions) {
      for (const [key, value] of Object.entries(instr.parameters)) {
        if (typeof value === 'string' && value.startsWith('$')) {
          dependencies.push(value);
        }
      }
    }

    return {
      totalComplexity,
      estimatedTokens,
      executionTime,
      dependencies: [...new Set(dependencies)],
    };
  }

  /**
   * Validate generated LISP program
   */
  validateProgram(program: LispProgram): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Comprehensive LISP syntax validation
    const fullProgram = program.instructions
      .map((instr) => instr.instruction)
      .join(' ');

    // 1. Parentheses balancing with detailed tracking
    const parenValidation = this.validateParentheses(fullProgram);
    errors.push(...parenValidation.errors);

    // 2. Symbol and identifier validation
    const symbolValidation = this.validateSymbols(fullProgram);
    errors.push(...symbolValidation.errors);
    warnings.push(...symbolValidation.warnings);

    // 3. Function call validation
    const functionValidation = this.validateFunctionCalls(fullProgram);
    errors.push(...functionValidation.errors);
    warnings.push(...functionValidation.warnings);

    // 4. Data structure validation
    const dataValidation = this.validateDataStructures(fullProgram);
    errors.push(...dataValidation.errors);
    warnings.push(...dataValidation.warnings);

    // 5. Semantic validation
    const semanticValidation = this.validateSemantics(program);
    errors.push(...semanticValidation.errors);
    warnings.push(...semanticValidation.warnings);

    // 6. Performance checks
    const performanceChecks = this.checkPerformanceIssues(program);
    warnings.push(...performanceChecks.warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate parentheses balancing with position tracking
   */
  private validateParentheses(program: string): { errors: string[] } {
    const errors: string[] = [];
    const stack: number[] = [];
    let position = 0;

    for (let i = 0; i < program.length; i++) {
      const char = program[i];

      if (char === '(') {
        stack.push(i);
      } else if (char === ')') {
        if (stack.length === 0) {
          errors.push(`Unmatched closing parenthesis at position ${i}`);
        } else {
          stack.pop();
        }
      }

      // Track position for error reporting
      if (char === '\n') {
        position++;
      }
    }

    if (stack.length > 0) {
      const positions = stack.join(', ');
      errors.push(`Unmatched opening parentheses at positions: ${positions}`);
    }

    return { errors };
  }

  /**
   * Validate symbols and identifiers
   */
  private validateSymbols(program: string): {
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Extract all symbols (words that aren't operators)
    const symbolPattern = /\b[a-zA-Z_][a-zA-Z0-9_-]*\b/g;
    const symbols: string[] = program.match(symbolPattern) || [];

    symbols.forEach((symbol: string) => {
      // Check for reserved keywords that shouldn't be used as variables
      const reservedKeywords = [
        'defun',
        'defvar',
        'defmacro',
        'lambda',
        'let',
        'if',
        'cond',
        'progn',
      ];
      if (reservedKeywords.includes(symbol.toLowerCase())) {
        warnings.push(`Symbol '${symbol}' is a reserved keyword`);
      }

      // Check for potentially problematic symbol names
      if (symbol.length > 50) {
        warnings.push(
          `Symbol '${symbol}' is very long (${symbol.length} characters)`,
        );
      }

      // Check for symbols starting with numbers (invalid)
      if (/^\d/.test(symbol)) {
        errors.push(
          `Invalid symbol name '${symbol}': cannot start with a number`,
        );
      }

      // Check for invalid characters
      if (/[^a-zA-Z0-9_-]/.test(symbol)) {
        errors.push(
          `Invalid symbol name '${symbol}': contains invalid characters`,
        );
      }
    });

    return { errors, warnings };
  }

  /**
   * Validate function calls
   */
  private validateFunctionCalls(program: string): {
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Extract function calls (opening parens followed by symbols)
    const functionCallPattern = /\(\s*([a-zA-Z_][a-zA-Z0-9_-]*)/g;
    let match;

    while ((match = functionCallPattern.exec(program)) !== null) {
      const functionName = match[1];

      // Check for undefined functions (simplified check)
      const knownFunctions = [
        '+',
        '-',
        '*',
        '/',
        'cons',
        'car',
        'cdr',
        'list',
        'append',
        'length',
        'nth',
        'mapcar',
        'apply',
        'funcall',
      ];
      if (!knownFunctions.includes(functionName)) {
        // Could be a user-defined function, so just warn
        warnings.push(
          `Function '${functionName}' is not in the standard library`,
        );
      }

      // Check for function calls with no arguments
      const callPattern = new RegExp(`\\(\\s*${functionName}\\s*\\)`, 'g');
      if (callPattern.test(program)) {
        warnings.push(`Function '${functionName}' called with no arguments`);
      }
    }

    return { errors, warnings };
  }

  /**
   * Validate data structures
   */
  private validateDataStructures(program: string): {
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for proper list syntax
    const listPattern = /\(\s*list\s+([^)]+)\)/g;
    let match;

    while ((match = listPattern.exec(program)) !== null) {
      const listContent = match[1];
      // Check for empty lists
      if (listContent.trim() === '') {
        warnings.push('Empty list literal found');
      }
    }

    // Check for quote usage
    const quotePattern = /'[^(\s)]/g;
    if (quotePattern.test(program)) {
      warnings.push('Potential incorrect quote usage detected');
    }

    // Check for nested depth
    const maxDepth = this.calculateMaxNestingDepth(program);
    if (maxDepth > 10) {
      warnings.push(
        `Very deep nesting detected (depth: ${maxDepth}). Consider simplifying.`,
      );
    }

    return { errors, warnings };
  }

  /**
   * Validate program semantics
   */
  private validateSemantics(program: LispProgram): {
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for unreachable code
    for (let i = 0; i < program.instructions.length - 1; i++) {
      const current = program.instructions[i];
      const next = program.instructions[i + 1];

      if (
        current.instruction.includes('(return') ||
        current.instruction.includes('(throw') ||
        current.instruction.includes('(error')
      ) {
        warnings.push(
          `Code after ${current.instruction.trim()} may be unreachable`,
        );
      }
    }

    // Check for variable scoping issues (simplified)
    const definedVars = new Set<string>();
    const usedVars = new Set<string>();

    program.instructions.forEach((instr) => {
      // Extract variable definitions
      const defVarPattern = /\(\s*defvar\s+([a-zA-Z_][a-zA-Z0-9_-]*)/g;
      let match;
      while ((match = defVarPattern.exec(instr.instruction)) !== null) {
        definedVars.add(match[1]);
      }

      // Extract variable usage
      const varPattern = /\b([a-zA-Z_][a-zA-Z0-9_-]*)\b/g;
      while ((match = varPattern.exec(instr.instruction)) !== null) {
        const varName = match[1];
        if (!['defvar', 'lambda', 'let', 'if', 'cond'].includes(varName)) {
          usedVars.add(varName);
        }
      }
    });

    // Check for undefined variables
    usedVars.forEach((varName) => {
      if (!definedVars.has(varName)) {
        warnings.push(`Variable '${varName}' used but not defined`);
      }
    });

    return { errors, warnings };
  }

  /**
   * Check for performance issues
   */
  private checkPerformanceIssues(program: LispProgram): { warnings: string[] } {
    const warnings: string[] = [];

    // Check for very long programs
    if (program.instructions.length > 1000) {
      warnings.push(
        `Program is very long (${program.instructions.length} instructions). Consider optimizing.`,
      );
    }

    // Check for repeated computations
    const instructionCounts: Record<string, number> = {};
    program.instructions.forEach((instr) => {
      const normalized = instr.instruction.replace(/\s+/g, ' ').trim();
      instructionCounts[normalized] = (instructionCounts[normalized] || 0) + 1;
    });

    Object.entries(instructionCounts).forEach(([instruction, count]) => {
      if (count > 5) {
        warnings.push(
          `Instruction repeated ${count} times: ${instruction.substring(0, 50)}...`,
        );
      }
    });

    return { warnings };
  }

  /**
   * Calculate maximum nesting depth
   */
  private calculateMaxNestingDepth(program: string): number {
    let maxDepth = 0;
    let currentDepth = 0;

    for (const char of program) {
      if (char === '(') {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      } else if (char === ')') {
        currentDepth = Math.max(0, currentDepth - 1);
      }
    }

    return maxDepth;
  }

  /**
   * Optimize LISP program
   */
  optimizeProgram(program: LispProgram): LispProgram {
    let optimizedInstructions = [...program.instructions];

    // Apply various optimization passes
    optimizedInstructions = this.removeRedundantInstructions(
      optimizedInstructions,
    );
    optimizedInstructions = this.combineSimilarOperations(
      optimizedInstructions,
    );
    optimizedInstructions = this.reorderForPerformance(optimizedInstructions);
    optimizedInstructions = this.applyConstantFolding(optimizedInstructions);
    optimizedInstructions = this.inlineSimpleFunctions(optimizedInstructions);

    return {
      instructions: optimizedInstructions,
      metadata: this.calculateProgramMetadata(optimizedInstructions),
    };
  }

  private removeRedundantInstructions(
    instructions: LispInstruction[],
  ): LispInstruction[] {
    const optimized: LispInstruction[] = [];
    const definedVars = new Set<string>();

    for (const instruction of instructions) {
      if (instruction.type === 'define' && instruction.variable) {
        // Check if variable is redefined without being used
        if (definedVars.has(instruction.variable)) {
          // Remove previous definition if not used
          const prevIndex = optimized.findIndex(
            (inst) =>
              inst.type === 'define' && inst.variable === instruction.variable,
          );
          if (prevIndex >= 0) {
            optimized.splice(prevIndex, 1);
          }
        }
        definedVars.add(instruction.variable);
      }

      // Remove no-op instructions
      if (instruction.type === 'nop') {
        continue;
      }

      optimized.push(instruction);
    }

    return optimized;
  }

  private combineSimilarOperations(
    instructions: LispInstruction[],
  ): LispInstruction[] {
    const optimized: LispInstruction[] = [];

    for (let i = 0; i < instructions.length; i++) {
      const current = instructions[i];
      const next = instructions[i + 1];

      // Combine consecutive arithmetic operations
      if (this.canCombineArithmetic(current, next)) {
        const combined = this.combineArithmeticOperations(current, next);
        optimized.push(combined);
        i++; // Skip next instruction
      } else {
        optimized.push(current);
      }
    }

    return optimized;
  }

  private canCombineArithmetic(
    inst1: LispInstruction,
    inst2: LispInstruction,
  ): boolean {
    return (
      inst1.type === 'arithmetic' &&
      inst2?.type === 'arithmetic' &&
      inst1.operation === inst2.operation &&
      inst1.result === inst2.operand1
    );
  }

  private combineArithmeticOperations(
    inst1: LispInstruction,
    inst2: LispInstruction,
  ): LispInstruction {
    return {
      instruction: '(arithmetic)',
      parameters: {},
      type: 'arithmetic',
      operation: inst1.operation,
      operand1: inst1.operand1,
      operand2: inst1.operand2,
      result: inst2.result,
      metadata: {
        complexity:
          (inst1.metadata.complexity ?? 0) + (inst2.metadata.complexity ?? 0),
        estimatedTokens:
          (inst1.metadata.estimatedTokens ?? 0) +
          (inst2.metadata.estimatedTokens ?? 0),
        executionOrder: inst1.metadata.executionOrder ?? 0,
        combined: true,
        originalOps: 2,
      },
    };
  }

  private reorderForPerformance(
    instructions: LispInstruction[],
  ): LispInstruction[] {
    // Simple reordering: move defines to top, computations in dependency order
    const defines: LispInstruction[] = [];
    const others: LispInstruction[] = [];

    for (const instruction of instructions) {
      if (instruction.type === 'define') {
        defines.push(instruction);
      } else {
        others.push(instruction);
      }
    }

    return [...defines, ...others];
  }

  private applyConstantFolding(
    instructions: LispInstruction[],
  ): LispInstruction[] {
    const optimized: LispInstruction[] = [];
    const constants = new Map<string, number>();

    for (const instruction of instructions) {
      if (
        instruction.type === 'define' &&
        instruction.variable != null &&
        typeof instruction.value === 'number'
      ) {
        constants.set(instruction.variable, instruction.value);
      } else if (
        instruction.type === 'arithmetic' &&
        instruction.operation != null &&
        typeof instruction.operand1 === 'string' &&
        typeof instruction.operand2 === 'string' &&
        instruction.result != null &&
        constants.has(instruction.operand1) &&
        constants.has(instruction.operand2)
      ) {
        // Fold constant arithmetic
        const op1 = constants.get(instruction.operand1)!;
        const op2 = constants.get(instruction.operand2)!;
        const result = this.evaluateArithmetic(instruction.operation, op1, op2);

        constants.set(String(instruction.result), result);

        // Replace with constant definition
        optimized.push({
          instruction: '(define)',
          parameters: {},
          type: 'define',
          variable: String(instruction.result),
          value: result,
          metadata: {
            complexity: 0,
            estimatedTokens: 0,
            executionOrder: 0,
            folded: true,
            originalInstruction: instruction,
          },
        });
      } else {
        optimized.push(instruction);
      }
    }

    return optimized;
  }

  private evaluateArithmetic(
    operation: string,
    op1: number,
    op2: number,
  ): number {
    switch (operation) {
      case '+':
        return op1 + op2;
      case '-':
        return op1 - op2;
      case '*':
        return op1 * op2;
      case '/':
        return op1 / op2;
      default:
        return 0;
    }
  }

  private inlineSimpleFunctions(
    instructions: LispInstruction[],
  ): LispInstruction[] {
    const optimized: LispInstruction[] = [];
    const simpleFunctions = new Map<string, LispInstruction[]>();

    // Find simple functions (single instruction)
    for (const instruction of instructions) {
      if (
        instruction.type === 'function' &&
        instruction.name != null &&
        Array.isArray(instruction.body) &&
        instruction.body.length === 1
      ) {
        simpleFunctions.set(
          instruction.name,
          instruction.body as LispInstruction[],
        );
      }
    }

    // Inline function calls
    for (const instruction of instructions) {
      if (
        instruction.type === 'call' &&
        instruction.functionName != null &&
        simpleFunctions.has(instruction.functionName)
      ) {
        const functionBody = simpleFunctions.get(instruction.functionName)!;
        // Inline the function body
        const inlined = {
          ...functionBody[0],
          inlined: true,
          originalCall: instruction.functionName,
        } as LispInstruction;
        optimized.push(inlined);
      } else {
        optimized.push(instruction);
      }
    }

    return optimized;
  }
}
