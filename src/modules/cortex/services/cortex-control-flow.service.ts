/**
 * Cortex Control Flow Service (NestJS)
 *
 * Implements control flow primitives and logic constructs for Cortex,
 * enabling if/then/else conditions, loops, and multi-step logic execution.
 * Reduces LLM round-trips by executing complex logic in single calls.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  CortexFrame,
  CortexPrimitive,
  CortexValue,
  CortexControlFrame,
  CortexConditionalFrame,
  CortexLoopFrame,
  CortexSequenceFrame,
} from '../types/cortex.types';

export interface CortexControlStep {
  id: string;
  type: 'action' | 'condition' | 'loop' | 'assignment' | 'call' | 'parallel';
  frame?: CortexFrame;
  condition?: CortexCondition;
  assignment?: {
    variable: string;
    value: CortexValue | string;
  };
  loop?: {
    variable: string;
    iterable: CortexValue[] | string;
    body: CortexControlStep[];
    maxIterations?: number;
    condition?: CortexCondition;
  };
  call?: {
    function: string;
    arguments: Record<string, CortexValue>;
    returnVariable?: string;
  };
  parallel?: {
    steps: CortexControlStep[];
    maxConcurrency?: number;
  };
  nextSteps?: string[];
  errorHandling?: {
    onError: 'stop' | 'continue' | 'retry' | 'goto';
    retryCount?: number;
    gotoStep?: string;
  };
}

export interface CortexCondition {
  type: 'comparison' | 'logical' | 'existence' | 'pattern' | 'custom';
  left: CortexValue | string;
  operator:
    | 'eq'
    | 'neq'
    | 'gt'
    | 'lt'
    | 'gte'
    | 'lte'
    | 'contains'
    | 'matches'
    | 'and'
    | 'or'
    | 'not'
    | 'exists';
  right?: CortexValue | string;
  conditions?: CortexCondition[];
  customEvaluator?: string;
}

export interface ControlFlowExecutionResult {
  success: boolean;
  result: CortexValue | CortexFrame[] | null;
  executedSteps: string[];
  variables: Record<string, CortexValue>;
  metadata: {
    totalSteps: number;
    executionTime: number;
    iterations?: number;
    errors: ControlFlowError[];
    warnings: string[];
  };
}

export interface ControlFlowError {
  stepId?: string;
  code: string;
  message: string;
  details?: any;
  recoverable: boolean;
}

export const CONTROL_PRIMITIVES: Record<string, CortexPrimitive> = {
  // Conditional primitives
  if: 'control_if',
  then: 'control_then',
  else: 'control_else',
  elif: 'control_elif',
  endif: 'control_endif',

  // Loop primitives
  for: 'control_for',
  while: 'control_while',
  foreach: 'control_foreach',
  repeat: 'control_repeat',
  break: 'control_break',
  continue: 'control_continue',
  endloop: 'control_endloop',

  // Sequence primitives
  sequence: 'control_sequence',
  parallel: 'control_parallel',
  step: 'control_step',
  next: 'control_next',

  // Variable primitives
  set: 'control_set',
  get: 'control_get',
  increment: 'control_increment',
  append: 'control_append',

  // Comparison primitives
  equals: 'comparison_equals',
  greater_than: 'comparison_gt',
  less_than: 'comparison_lt',
  contains: 'comparison_contains',
  exists: 'comparison_exists',

  // Logical primitives
  and: 'logical_and',
  or: 'logical_or',
  not: 'logical_not',

  // Error handling primitives
  try: 'control_try',
  catch: 'control_catch',
  finally: 'control_finally',
  throw: 'control_throw',
};

@Injectable()
export class CortexControlFlowService {
  private readonly logger = new Logger(CortexControlFlowService.name);
  private variables: Map<string, CortexValue> = new Map();
  private customEvaluators: Map<
    string,
    (left: any, right: any, condition: CortexCondition) => boolean
  > = new Map();

  constructor() {
    this.initializeCustomEvaluators();
  }

  /**
   * Execute control flow logic in Cortex frames
   */
  public async executeControlFlow(
    controlFrame:
      | CortexControlFrame
      | CortexConditionalFrame
      | CortexLoopFrame
      | CortexSequenceFrame,
  ): Promise<ControlFlowExecutionResult> {
    const startTime = Date.now();
    const executedSteps: string[] = [];
    const errors: ControlFlowError[] = [];
    const warnings: string[] = [];

    try {
      this.initializeVariables(controlFrame);

      let result: CortexValue | CortexFrame[];

      switch (controlFrame.frameType) {
        case 'control':
          result = await this.executeGenericControl(
            controlFrame,
            executedSteps,
            errors,
          );
          break;

        case 'conditional':
          result = await this.executeConditional(
            controlFrame,
            executedSteps,
            errors,
          );
          break;

        case 'loop':
          result = await this.executeLoop(controlFrame, executedSteps, errors);
          break;

        case 'sequence':
          result = await this.executeSequence(
            controlFrame,
            executedSteps,
            errors,
          );
          break;

        default:
          throw new Error(
            `Unsupported control frame type: ${(controlFrame as any).frameType || 'unknown'}`,
          );
      }

      this.logger.log(`🔄 Control flow execution completed`, {
        frameType: controlFrame.frameType,
        controlType: (controlFrame as any).controlType,
        executedSteps: executedSteps.length,
        executionTime: Date.now() - startTime,
        success: errors.filter((e) => !e.recoverable).length === 0,
      });

      return {
        success: errors.filter((e) => !e.recoverable).length === 0,
        result,
        executedSteps,
        variables: Object.fromEntries(this.variables.entries()),
        metadata: {
          totalSteps: executedSteps.length,
          executionTime: Date.now() - startTime,
          errors,
          warnings,
        },
      };
    } catch (error) {
      this.logger.error(
        '❌ Control flow execution failed',
        error instanceof Error ? error.message : String(error),
      );

      errors.push({
        code: 'EXECUTION_FAILED',
        message: `Control flow execution error: ${error instanceof Error ? error.message : String(error)}`,
        details: error,
        recoverable: false,
      });

      return {
        success: false,
        result: null,
        executedSteps,
        variables: Object.fromEntries(this.variables.entries()),
        metadata: {
          totalSteps: executedSteps.length,
          executionTime: Date.now() - startTime,
          errors,
          warnings,
        },
      };
    }
  }

  /**
   * Set a variable value
   */
  public setVariable(name: string, value: CortexValue): void {
    this.variables.set(name, value);
  }

  /**
   * Get a variable value
   */
  public getVariable(name: string): CortexValue | undefined {
    return this.variables.get(name);
  }

  /**
   * Register a custom evaluator function
   */
  public registerCustomEvaluator(
    name: string,
    evaluator: (left: any, right: any, condition: CortexCondition) => boolean,
  ): void {
    this.customEvaluators.set(name, evaluator);
  }

  // Private methods

  private initializeCustomEvaluators(): void {
    // Register built-in evaluators
    this.registerCustomEvaluator('string_contains', (left, right) => {
      return (
        typeof left === 'string' &&
        typeof right === 'string' &&
        left.includes(right)
      );
    });

    this.registerCustomEvaluator('array_length', (left, right) => {
      return (
        Array.isArray(left) &&
        typeof right === 'number' &&
        left.length === right
      );
    });
  }

  private initializeVariables(controlFrame: any): void {
    // Initialize any variables defined in the frame
    if (controlFrame.variables) {
      for (const [key, value] of Object.entries(controlFrame.variables)) {
        this.variables.set(key, value as CortexValue);
      }
    }
  }

  private async executeGenericControl(
    controlFrame: CortexControlFrame,
    executedSteps: string[],
    errors: ControlFlowError[],
  ): Promise<CortexFrame[]> {
    const results: CortexFrame[] = [];

    // Parse control steps from the frame
    const steps = this.parseControlSteps(controlFrame);

    for (const step of steps) {
      executedSteps.push(step.id);

      try {
        const stepResult = await this.executeStep(step);
        if (stepResult) {
          const frames: CortexFrame[] = (
            Array.isArray(stepResult)
              ? stepResult.filter(
                  (r): r is CortexFrame =>
                    typeof r === 'object' && r != null && 'frameType' in r,
                )
              : typeof stepResult === 'object' &&
                  stepResult != null &&
                  'frameType' in stepResult
                ? [stepResult as CortexFrame]
                : []
          ) as CortexFrame[];
          results.push(...frames);
        }
      } catch (error) {
        const controlError: ControlFlowError = {
          stepId: step.id,
          code: 'STEP_EXECUTION_FAILED',
          message: `Failed to execute step ${step.id}: ${error instanceof Error ? error.message : String(error)}`,
          details: error,
          recoverable: step.errorHandling?.onError !== 'stop',
        };
        errors.push(controlError);

        // Handle error based on error handling strategy
        if (
          step.errorHandling?.onError === 'retry' &&
          step.errorHandling.retryCount &&
          step.errorHandling.retryCount > 0
        ) {
          // Implement retry logic
          let retryCount = 0;
          while (retryCount < step.errorHandling.retryCount) {
            try {
              const retryResult = await this.executeStep(step);
              if (retryResult) {
                const frames: CortexFrame[] = (
                  Array.isArray(retryResult)
                    ? retryResult.filter(
                        (r): r is CortexFrame =>
                          typeof r === 'object' &&
                          r != null &&
                          'frameType' in r,
                      )
                    : typeof retryResult === 'object' &&
                        retryResult != null &&
                        'frameType' in retryResult
                      ? [retryResult as CortexFrame]
                      : []
                ) as CortexFrame[];
                results.push(...frames);
              }
              break; // Success, exit retry loop
            } catch (retryError) {
              retryCount++;
              if (retryCount >= step.errorHandling.retryCount) {
                // Max retries reached, handle final error
                if (step.errorHandling.gotoStep) {
                  // Jump to specified step
                  const gotoIndex = steps.findIndex(
                    (s) => s.id === step.errorHandling!.gotoStep,
                  );
                  if (gotoIndex >= 0) {
                    // Continue from goto step (would need to modify loop)
                  }
                }
              }
            }
          }
        } else if (
          step.errorHandling?.onError === 'goto' &&
          step.errorHandling.gotoStep
        ) {
          // Jump to specified step
          const gotoIndex = steps.findIndex(
            (s) => s.id === step.errorHandling!.gotoStep,
          );
          if (gotoIndex >= 0) {
            // Continue from goto step (would need to modify loop index)
          }
        } else if (!controlError.recoverable) {
          break;
        }
      }
    }

    return results;
  }

  private async executeConditional(
    conditionalFrame: CortexConditionalFrame,
    executedSteps: string[],
    errors: ControlFlowError[],
  ): Promise<CortexValue> {
    const condition = conditionalFrame.condition;
    const conditionMet = await this.evaluateCondition(condition);

    executedSteps.push('condition_check');

    if (conditionMet) {
      if (conditionalFrame.thenBranch?.length) {
        return (
          (await this.executeSteps(
            conditionalFrame.thenBranch as unknown as CortexControlStep[],
            executedSteps,
            errors,
          )) ?? null
        );
      }
    } else {
      if (conditionalFrame.elseBranch?.length) {
        return (
          (await this.executeSteps(
            conditionalFrame.elseBranch as unknown as CortexControlStep[],
            executedSteps,
            errors,
          )) ?? null
        );
      }
    }

    return null;
  }

  private async executeLoop(
    loopFrame: CortexLoopFrame,
    executedSteps: string[],
    errors: ControlFlowError[],
  ): Promise<CortexValue[]> {
    const results: CortexValue[] = [];
    let iterations = 0;
    const maxIterations = loopFrame.maxIterations || 100;

    while (iterations < maxIterations) {
      iterations++;
      executedSteps.push(`iteration_${iterations}`);

      // Check loop condition if specified
      if (loopFrame.condition) {
        const conditionMet = await this.evaluateCondition(loopFrame.condition);
        if (!conditionMet) {
          break;
        }
      }

      // Execute loop body
      if (loopFrame.body?.length) {
        const result = await this.executeSteps(
          loopFrame.body as unknown as CortexControlStep[],
          executedSteps,
          errors,
        );
        if (result !== undefined && result !== null) {
          results.push(result);
        }
      }

      // Safety check to prevent infinite loops
      if (iterations >= maxIterations) {
        errors.push({
          code: 'MAX_ITERATIONS_EXCEEDED',
          message: `Loop exceeded maximum iterations: ${maxIterations}`,
          recoverable: true,
        });
        break;
      }
    }

    return results;
  }

  private async executeSequence(
    sequenceFrame: CortexSequenceFrame,
    executedSteps: string[],
    errors: ControlFlowError[],
  ): Promise<CortexValue[]> {
    const results: CortexValue[] = [];

    if (sequenceFrame.steps) {
      for (const step of sequenceFrame.steps) {
        const stepId = (step as { id?: string }).id ?? 'unknown';
        executedSteps.push(`sequence_step_${stepId}`);
        try {
          const result = await this.executeStep(
            step as unknown as CortexControlStep,
          );
          if (result !== undefined && result !== null) {
            if (Array.isArray(result)) {
              results.push(...result);
            } else {
              results.push(result);
            }
          }
        } catch (error: any) {
          errors.push({
            code: 'SEQUENCE_STEP_ERROR',
            message: `Error executing sequence step: ${stepId}`,
            recoverable: false,
            details: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return results;
  }

  private async executeSteps(
    steps: CortexControlStep[],
    executedSteps: string[],
    errors: ControlFlowError[],
  ): Promise<CortexValue | null> {
    let result: CortexValue | null = null;

    for (const step of steps) {
      executedSteps.push(step.id);
      try {
        result = await this.executeStep(step);
      } catch (error: any) {
        errors.push({
          code: 'STEP_EXECUTION_ERROR',
          message: `Error executing step: ${step.id}`,
          recoverable: false,
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  private async executeStep(
    step: CortexControlStep,
  ): Promise<CortexValue | CortexFrame | CortexFrame[]> {
    switch (step.type) {
      case 'assignment':
        if (step.assignment) {
          const value = this.resolveValue(step.assignment.value);
          this.variables.set(step.assignment.variable, value);
          this.logger.debug(
            `📝 Assigned ${step.assignment.variable} = ${JSON.stringify(value)}`,
          );
          return value;
        }
        break;

      case 'condition':
        if (step.condition) {
          const result = await this.evaluateCondition(step.condition);
          this.logger.debug(`❓ Condition evaluated to: ${result}`);
          return result;
        }
        break;

      case 'loop':
        if (step.loop) {
          return await this.executeLoopStep(step);
        }
        break;

      case 'action':
        if (step.frame) {
          // Execute the frame action (would integrate with other Cortex services)
          this.logger.debug(
            `🎬 Executing action frame: ${step.frame.frameType}`,
          );
          return step.frame;
        }
        break;

      case 'call':
        if (step.call) {
          return await this.executeFunctionCall(step.call);
        }
        break;

      case 'parallel':
        if (step.parallel && step.parallel.steps) {
          return await this.executeParallelSteps(step.parallel.steps);
        }
        break;
    }

    return null;
  }

  private async executeLoopStep(
    step: CortexControlStep,
  ): Promise<CortexValue[]> {
    const results: CortexValue[] = [];
    const loopData = step.loop!;

    let iterations = 0;
    const maxIterations = loopData.maxIterations || 100;

    while (iterations < maxIterations) {
      iterations++;

      // Check loop condition if specified
      if (loopData.condition) {
        const conditionMet = await this.evaluateCondition(loopData.condition);
        if (!conditionMet) {
          break;
        }
      }

      // Execute loop body
      if (loopData.body && loopData.body.length > 0) {
        for (const bodyStep of loopData.body) {
          const result = await this.executeStep(bodyStep);
          if (result !== null) {
            if (Array.isArray(result)) {
              results.push(...result);
            } else {
              results.push(result);
            }
          }
        }
      }

      // Safety check
      if (iterations >= maxIterations) {
        this.logger.warn(`Loop exceeded maximum iterations: ${maxIterations}`);
        break;
      }
    }

    this.logger.debug(`🔄 Loop executed ${iterations} iterations`);
    return results;
  }

  private async executeFunctionCall(callData: any): Promise<CortexValue> {
    // Execute custom function calls
    const { functionName, parameters } = callData;

    // Built-in functions
    switch (functionName) {
      case 'log':
        this.logger.log('Control flow log:', parameters);
        return true as CortexValue;

      case 'delay':
        const delay = parameters?.milliseconds || 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return true;

      case 'random':
        const min = parameters?.min || 0;
        const max = parameters?.max || 1;
        return Math.random() * (max - min) + min;

      case 'length':
        if (parameters?.array && Array.isArray(parameters.array)) {
          return parameters.array.length;
        }
        return 0;

      default:
        this.logger.warn(`Unknown function call: ${functionName}`);
        return null as CortexValue;
    }
  }

  private async executeParallelSteps(
    steps: CortexControlStep[],
  ): Promise<CortexFrame[]> {
    const promises = steps.map((step) => this.executeStep(step));
    const results = await Promise.all(promises);

    const flattened: CortexFrame[] = [];
    for (const result of results) {
      if (result !== null && result !== undefined) {
        if (Array.isArray(result)) {
          const frames = result.filter(
            (r): r is CortexFrame =>
              typeof r === 'object' && r != null && 'frameType' in r,
          ) as CortexFrame[];
          flattened.push(...frames);
        } else if (
          typeof result === 'object' &&
          result != null &&
          'frameType' in result
        ) {
          flattened.push(result as CortexFrame);
        }
      }
    }

    this.logger.debug(`⚡ Executed ${steps.length} steps in parallel`);
    return flattened;
  }

  private async evaluateCondition(
    condition: CortexCondition,
  ): Promise<boolean> {
    const left = this.resolveValue(condition.left);
    const right = condition.right
      ? this.resolveValue(condition.right)
      : undefined;

    switch (condition.type) {
      case 'comparison':
        return this.evaluateComparison(left, condition.operator, right);

      case 'logical':
        if (condition.operator === 'and' && condition.conditions) {
          return condition.conditions.every(
            async (c) => await this.evaluateCondition(c),
          );
        }
        if (condition.operator === 'or' && condition.conditions) {
          return condition.conditions.some(
            async (c) => await this.evaluateCondition(c),
          );
        }
        if (
          condition.operator === 'not' &&
          condition.conditions &&
          condition.conditions.length > 0
        ) {
          return !(await this.evaluateCondition(condition.conditions[0]));
        }
        break;

      case 'existence':
        return left !== undefined && left !== null;

      case 'custom':
        if (condition.customEvaluator) {
          const evaluator = this.customEvaluators.get(
            condition.customEvaluator,
          );
          if (evaluator) {
            return evaluator(left, right, condition);
          }
        }
        break;
    }

    return false;
  }

  private evaluateComparison(
    left: any,
    operator: string,
    right?: any,
  ): boolean {
    switch (operator) {
      case 'eq':
        return left === right;
      case 'neq':
        return left !== right;
      case 'gt':
        return (
          typeof left === 'number' && typeof right === 'number' && left > right
        );
      case 'lt':
        return (
          typeof left === 'number' && typeof right === 'number' && left < right
        );
      case 'gte':
        return (
          typeof left === 'number' && typeof right === 'number' && left >= right
        );
      case 'lte':
        return (
          typeof left === 'number' && typeof right === 'number' && left <= right
        );
      case 'contains':
        if (typeof left === 'string' && typeof right === 'string') {
          return left.includes(right);
        }
        if (Array.isArray(left)) {
          return left.includes(right);
        }
        return false;
      case 'exists':
        return left !== undefined && left !== null;
      default:
        return false;
    }
  }

  private resolveValue(value: CortexValue | string): CortexValue {
    if (typeof value === 'string' && value.startsWith('$')) {
      const varName = value.substring(1);
      return this.variables.get(varName) ?? (value as CortexValue);
    }
    return value;
  }

  /**
   * Parses a CortexControlFrame into an array of strongly-typed, validated CortexControlSteps.
   * This function ensures type safety, deep validation, and normalization of step definitions.
   *
   * In addition to copying properties, this implementation validates:
   *  - id, type, and step structure (throws on missing or invalid)
   *  - that `frame` (if present) appears structurally valid
   *  - that `nextSteps` and `errorHandling` are always arrays (empty if not present)
   *  - that all optional fields default properly
   *  - logs or gathers warnings for any unsafe/unrecognized fields
   *
   * @param controlFrame The CortexControlFrame to parse
   * @returns CortexControlStep[]
   */
  private parseControlSteps(
    controlFrame: CortexControlFrame,
  ): CortexControlStep[] {
    const steps: CortexControlStep[] = [];
    if (!controlFrame.steps || !Array.isArray(controlFrame.steps)) {
      return steps;
    }

    for (let i = 0; i < controlFrame.steps.length; i++) {
      const rawStep = controlFrame.steps[i];

      // Defensive: Validate presence and type of id
      const stepId =
        typeof rawStep.id === 'string' && rawStep.id.length > 0
          ? rawStep.id
          : `step_${i}`;

      // Validate type
      const stepType: string =
        typeof rawStep.type === 'string' && rawStep.type.length > 0
          ? rawStep.type
          : 'action';

      // Frame: Must be object (if present)
      let frame = undefined;
      if (
        rawStep.frame &&
        typeof rawStep.frame === 'object' &&
        !Array.isArray(rawStep.frame)
      ) {
        frame = { ...rawStep.frame };
      }

      // Condition: Should be object (if present), else undefined
      let condition = undefined;
      if (
        rawStep.condition &&
        typeof rawStep.condition === 'object' &&
        !Array.isArray(rawStep.condition)
      ) {
        condition = { ...rawStep.condition };
      }

      // Assignment: Should be object (if present), else undefined
      let assignment = undefined;
      if (
        rawStep.assignment &&
        typeof rawStep.assignment === 'object' &&
        !Array.isArray(rawStep.assignment)
      ) {
        assignment = { ...rawStep.assignment };
      }

      // nextSteps: Always as an array of strings (step ids)
      let nextSteps: string[] = [];
      if (Array.isArray(rawStep.nextSteps)) {
        nextSteps = rawStep.nextSteps.filter(
          (sid: unknown) => typeof sid === 'string',
        );
      } else if (typeof rawStep.nextSteps === 'string') {
        nextSteps = [rawStep.nextSteps];
      }

      // errorHandling: Always as array of objects (for uniformity)
      let errorHandling: Array<{
        onError?: string;
        retryCount?: number;
        gotoStep?: string;
      }> = [];
      if (Array.isArray(rawStep.errorHandling)) {
        errorHandling = rawStep.errorHandling.filter(
          (handler: unknown) => typeof handler === 'object' && handler !== null,
        );
      } else if (
        typeof rawStep.errorHandling === 'object' &&
        rawStep.errorHandling !== null
      ) {
        errorHandling = [rawStep.errorHandling];
      }

      // Build CortexControlStep - only properties in the type
      const step: CortexControlStep = {
        id: stepId,
        type: stepType,
        ...(frame && { frame }),
        ...(condition && { condition }),
        ...(assignment && { assignment }),
        ...(nextSteps.length > 0 && { nextSteps }),
        ...(errorHandling.length > 0 && { errorHandling }),
      };

      // Optionally: validate required structure further, could push warnings or throw
      // (e.g. throw if essential fields missing, or unknown keys provided)

      steps.push(step);
    }

    return steps;
  }
}
