/**
 * Control Flow Primitives for Cortex
 * Adds conditional logic, loops, and branching to Cortex expressions
 */

import { CortexExpression, CortexFrame } from '../types';
import { loggingService } from '../../common/services/logging.service';

/**
 * Control flow frame types
 */
export enum ControlFlowType {
  IF_THEN_ELSE = 'if_then_else',
  SWITCH_CASE = 'switch_case',
  FOR_EACH = 'for_each',
  WHILE = 'while',
  TRY_CATCH = 'try_catch',
  PARALLEL = 'parallel',
  SEQUENTIAL = 'sequential',
}

/**
 * Control flow operators
 */
export enum LogicalOperator {
  AND = 'and',
  OR = 'or',
  NOT = 'not',
  XOR = 'xor',
  EQUALS = 'equals',
  NOT_EQUALS = 'not_equals',
  GREATER_THAN = 'greater_than',
  LESS_THAN = 'less_than',
  CONTAINS = 'contains',
  MATCHES = 'matches',
}

/**
 * Condition interface for control flow
 */
export interface Condition {
  operator: LogicalOperator;
  left: any;
  right?: any;
  nested?: Condition[];
}

/**
 * Control flow frames
 */
export interface IfThenElseFrame extends CortexFrame {
  type: 'control_if';
  condition: Condition;
  then: CortexExpression;
  else?: CortexExpression;
}

export interface SwitchCaseFrame extends CortexFrame {
  type: 'control_switch';
  value: any;
  cases: Array<{
    match: any;
    expression: CortexExpression;
  }>;
  default?: CortexExpression;
}

export interface ForEachFrame extends CortexFrame {
  type: 'control_foreach';
  collection: any[];
  variable: string;
  expression: CortexExpression;
}

export interface WhileFrame extends CortexFrame {
  type: 'control_while';
  condition: Condition;
  expression: CortexExpression;
  maxIterations?: number;
}

export interface TryCatchFrame extends CortexFrame {
  type: 'control_try';
  try: CortexExpression;
  catch?: CortexExpression;
  finally?: CortexExpression;
}

export interface ParallelFrame extends CortexFrame {
  type: 'control_parallel';
  expressions: CortexExpression[];
  waitAll?: boolean;
}

/** Executor for non-control-flow expressions (e.g. LLM calls, context lookups) */
export type ExpressionExecutor = (
  expression: CortexExpression,
  context: Map<string, any>,
) => Promise<any>;

/** Control flow frame types that this processor handles */
const CONTROL_FLOW_TYPES = [
  'control_if',
  'control_switch',
  'control_foreach',
  'control_while',
  'control_try',
  'control_parallel',
] as const;

/**
 * Control Flow Processor
 * Executes control flow logic within Cortex expressions
 */
export class ControlFlowProcessor {
  constructor(
    private readonly expressionExecutor?: ExpressionExecutor,
  ) {}

  /**
   * Process a control flow frame
   */
  public async processControlFlow(
    frame: CortexFrame,
    context: Map<string, any>,
  ): Promise<any> {
    switch (frame.type) {
      case 'control_if':
        return this.processIfThenElse(frame as IfThenElseFrame, context);
      case 'control_switch':
        return this.processSwitchCase(frame as SwitchCaseFrame, context);
      case 'control_foreach':
        return this.processForEach(frame as ForEachFrame, context);
      case 'control_while':
        return this.processWhile(frame as WhileFrame, context);
      case 'control_try':
        return this.processTryCatch(frame as TryCatchFrame, context);
      case 'control_parallel':
        return this.processParallel(frame as ParallelFrame, context);
      default:
        throw new Error(`Unknown control flow type: ${frame.type}`);
    }
  }

  /**
   * Process if-then-else logic
   */
  private async processIfThenElse(
    frame: IfThenElseFrame,
    context: Map<string, any>,
  ): Promise<any> {
    const conditionResult = await this.evaluateCondition(
      frame.condition,
      context,
    );

    if (conditionResult) {
      return this.evaluateExpression(frame.then, context);
    } else if (frame.else) {
      return this.evaluateExpression(frame.else, context);
    }

    return null;
  }

  /**
   * Process switch-case logic
   */
  private async processSwitchCase(
    frame: SwitchCaseFrame,
    context: Map<string, any>,
  ): Promise<any> {
    const value = await this.evaluateValue(frame.value, context);

    for (const caseItem of frame.cases) {
      const matchValue = await this.evaluateValue(caseItem.match, context);
      if (value === matchValue) {
        return this.evaluateExpression(caseItem.expression, context);
      }
    }

    if (frame.default) {
      return this.evaluateExpression(frame.default, context);
    }

    return null;
  }

  /**
   * Process for-each loop
   */
  private async processForEach(
    frame: ForEachFrame,
    context: Map<string, any>,
  ): Promise<any[]> {
    const results: any[] = [];
    const collection = await this.evaluateValue(frame.collection, context);

    if (!Array.isArray(collection)) {
      throw new Error('ForEach requires an array collection');
    }

    for (const item of collection) {
      // Create new context with loop variable
      const loopContext = new Map(context);
      loopContext.set(frame.variable, item);

      const result = await this.evaluateExpression(
        frame.expression,
        loopContext,
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Process while loop
   */
  private async processWhile(
    frame: WhileFrame,
    context: Map<string, any>,
  ): Promise<any[]> {
    const results: any[] = [];
    const maxIterations = frame.maxIterations || 1000;
    let iterations = 0;

    while (await this.evaluateCondition(frame.condition, context)) {
      if (iterations >= maxIterations) {
        throw new Error(
          `While loop exceeded maximum iterations: ${maxIterations}`,
        );
      }

      const result = await this.evaluateExpression(frame.expression, context);
      results.push(result);
      iterations++;
    }

    return results;
  }

  /**
   * Process try-catch logic
   */
  private async processTryCatch(
    frame: TryCatchFrame,
    context: Map<string, any>,
  ): Promise<any> {
    try {
      return await this.evaluateExpression(frame.try, context);
    } catch (error) {
      if (frame.catch) {
        // Add error to context
        const errorContext = new Map(context);
        errorContext.set('_error', error);
        return await this.evaluateExpression(frame.catch, errorContext);
      }
      throw error;
    } finally {
      if (frame.finally) {
        await this.evaluateExpression(frame.finally, context);
      }
    }
  }

  /**
   * Process parallel execution
   */
  private async processParallel(
    frame: ParallelFrame,
    context: Map<string, any>,
  ): Promise<any[]> {
    const promises = frame.expressions.map((expr) =>
      this.evaluateExpression(expr, context),
    );

    if (frame.waitAll) {
      return Promise.all(promises);
    } else {
      return Promise.race(promises).then((result) => [result]);
    }
  }

  /**
   * Evaluate a condition
   */
  private async evaluateCondition(
    condition: Condition,
    context: Map<string, any>,
  ): Promise<boolean> {
    const left = await this.evaluateValue(condition.left, context);
    const right =
      condition.right !== undefined
        ? await this.evaluateValue(condition.right, context)
        : undefined;

    switch (condition.operator) {
      case LogicalOperator.AND:
        return condition.nested
          ? (
              await Promise.all(
                condition.nested.map((c) => this.evaluateCondition(c, context)),
              )
            ).every(Boolean)
          : Boolean(left && right);

      case LogicalOperator.OR:
        return condition.nested
          ? (
              await Promise.all(
                condition.nested.map((c) => this.evaluateCondition(c, context)),
              )
            ).some(Boolean)
          : Boolean(left || right);

      case LogicalOperator.NOT:
        return !left;

      case LogicalOperator.EQUALS:
        return left === right;

      case LogicalOperator.NOT_EQUALS:
        return left !== right;

      case LogicalOperator.GREATER_THAN:
        return left > right;

      case LogicalOperator.LESS_THAN:
        return left < right;

      case LogicalOperator.CONTAINS:
        return String(left).includes(String(right));

      case LogicalOperator.MATCHES:
        return new RegExp(String(right)).test(String(left));

      default:
        throw new Error(`Unknown operator: ${condition.operator}`);
    }
  }

  /**
   * Evaluate a value (resolve references, etc.)
   */
  private async evaluateValue(
    value: any,
    context: Map<string, any>,
  ): Promise<any> {
    // Handle context references
    if (typeof value === 'string' && value.startsWith('$')) {
      const key = value.substring(1);
      return context.get(key);
    }

    // Handle nested expressions
    if (typeof value === 'object' && value !== null && 'type' in value) {
      return this.evaluateExpression(value, context);
    }

    return value;
  }

  /**
   * Evaluate an expression - recursively processes control flow and delegates
   * non-control-flow expressions to the optional expressionExecutor.
   */
  private async evaluateExpression(
    expression: CortexExpression,
    context: Map<string, any>,
  ): Promise<any> {
    if (expression == null) return null;

    // Primitives pass through
    if (
      typeof expression === 'string' ||
      typeof expression === 'number' ||
      typeof expression === 'boolean'
    ) {
      return expression;
    }

    // Must be object for frame handling
    if (typeof expression !== 'object') return expression;

    const frameType =
      (expression as CortexFrame).type ??
      (expression as { frame?: string }).frame;

    // Recursively process nested control flow frames
    if (frameType && CONTROL_FLOW_TYPES.includes(frameType as any)) {
      return this.processControlFlow(expression as CortexFrame, context);
    }

    // Expression with simple value - resolve via context
    if (
      'value' in expression &&
      expression.value !== undefined
    ) {
      return this.evaluateValue(expression.value, context);
    }

    // Frames array - evaluate first frame if it's control flow
    if (
      expression.frames &&
      Array.isArray(expression.frames) &&
      expression.frames.length > 0
    ) {
      const firstFrame = expression.frames[0];
      if (
        firstFrame &&
        firstFrame.type &&
        CONTROL_FLOW_TYPES.includes(firstFrame.type as any)
      ) {
        return this.processControlFlow(firstFrame, context);
      }
    }

    // Non-control-flow expression (LLM call, context, etc.) - delegate to executor
    if (this.expressionExecutor) {
      loggingService.debug('Delegating expression to executor', {
        type: frameType,
        contextSize: context.size,
      });
      return this.expressionExecutor(expression, context);
    }

    // No executor - fail loudly instead of returning raw expression
    loggingService.warn('Cortex control flow: expression requires executor', {
      type: frameType,
    });
    throw new Error(
      'Cortex control flow: non-control-flow expressions (e.g. LLM calls, context lookups) require an ExpressionExecutor. ' +
        'Wire ControlFlowProcessor with an executor for full support.',
    );
  }
}

/**
 * Control Flow Builder
 * Helper class to build control flow expressions
 */
export class ControlFlowBuilder {
  /**
   * Build an if-then-else expression
   */
  public static ifThenElse(
    condition: Condition,
    thenExpr: CortexExpression,
    elseExpr?: CortexExpression,
  ): IfThenElseFrame {
    return {
      type: 'control_if',
      condition,
      then: thenExpr,
      else: elseExpr,
    };
  }

  /**
   * Build a switch-case expression
   */
  public static switchCase(
    value: any,
    cases: Array<{ match: any; expression: CortexExpression }>,
    defaultExpr?: CortexExpression,
  ): SwitchCaseFrame {
    return {
      type: 'control_switch',
      value,
      cases,
      default: defaultExpr,
    };
  }

  /**
   * Build a for-each loop
   */
  public static forEach(
    collection: any[],
    variable: string,
    expression: CortexExpression,
  ): ForEachFrame {
    return {
      type: 'control_foreach',
      collection,
      variable,
      expression,
    };
  }

  /**
   * Build a while loop
   */
  public static while(
    condition: Condition,
    expression: CortexExpression,
    maxIterations?: number,
  ): WhileFrame {
    return {
      type: 'control_while',
      condition,
      expression,
      maxIterations,
    };
  }

  /**
   * Build a try-catch block
   */
  public static tryCatch(
    tryExpr: CortexExpression,
    catchExpr?: CortexExpression,
    finallyExpr?: CortexExpression,
  ): TryCatchFrame {
    return {
      type: 'control_try',
      try: tryExpr,
      catch: catchExpr,
      finally: finallyExpr,
    };
  }

  /**
   * Build a parallel execution block
   */
  public static parallel(
    expressions: CortexExpression[],
    waitAll: boolean = true,
  ): ParallelFrame {
    return {
      type: 'control_parallel',
      expressions,
      waitAll,
    };
  }
}
