/**
 * Cortex Control Flow Service
 * 
 * Implements control flow primitives and logic constructs for Cortex,
 * enabling if/then/else conditions, loops, and multi-step logic execution.
 * Reduces LLM round-trips by executing complex logic in single calls.
 */

import { 
    CortexFrame, 
    CortexPrimitive, 
    CortexValue,
    CortexControlFrame,
    CortexConditionalFrame,
    CortexLoopFrame,
    CortexSequenceFrame
} from '../types/cortex.types';
import { loggingService } from './logging.service';

// ============================================================================
// CONTROL FLOW TYPES
// ============================================================================

// Control flow frame interfaces are imported from types file

export interface CortexControlStep {
    id: string;
    type: 'action' | 'condition' | 'loop' | 'assignment' | 'call';
    frame?: CortexFrame;
    condition?: CortexCondition;
    assignment?: {
        variable: string;
        value: CortexValue | string; // Can reference other variables
    };
    nextSteps?: string[]; // Step IDs to execute next
    errorHandling?: {
        onError: 'stop' | 'continue' | 'retry' | 'goto';
        retryCount?: number;
        gotoStep?: string;
    };
}

export interface CortexCondition {
    type: 'comparison' | 'logical' | 'existence' | 'pattern' | 'custom';
    left: CortexValue | string; // Can reference variables
    operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'matches' | 'and' | 'or' | 'not' | 'exists';
    right?: CortexValue | string;
    conditions?: CortexCondition[]; // For logical operators (and, or)
    customEvaluator?: string; // Name of custom evaluation function
}

export interface ControlFlowExecutionResult {
    success: boolean;
    result: CortexValue | CortexFrame[];
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

// ============================================================================
// CONTROL FLOW PRIMITIVES
// ============================================================================

export const CONTROL_PRIMITIVES: Record<string, CortexPrimitive> = {
    // Conditional primitives
    'if': 'control_if',
    'then': 'control_then',
    'else': 'control_else',
    'elif': 'control_elif',
    'endif': 'control_endif',
    
    // Loop primitives
    'for': 'control_for',
    'while': 'control_while',
    'foreach': 'control_foreach',
    'repeat': 'control_repeat',
    'break': 'control_break',
    'continue': 'control_continue',
    'endloop': 'control_endloop',
    
    // Sequence primitives
    'sequence': 'control_sequence',
    'parallel': 'control_parallel',
    'step': 'control_step',
    'next': 'control_next',
    
    // Variable primitives
    'set': 'control_set',
    'get': 'control_get',
    'increment': 'control_increment',
    'append': 'control_append',
    
    // Comparison primitives
    'equals': 'comparison_equals',
    'greater_than': 'comparison_gt',
    'less_than': 'comparison_lt',
    'contains': 'comparison_contains',
    'exists': 'comparison_exists',
    
    // Logical primitives
    'and': 'logical_and',
    'or': 'logical_or',
    'not': 'logical_not',
    
    // Error handling primitives
    'try': 'control_try',
    'catch': 'control_catch',
    'finally': 'control_finally',
    'throw': 'control_throw'
};

// ============================================================================
// CORTEX CONTROL FLOW SERVICE
// ============================================================================

export class CortexControlFlowService {
    private static instance: CortexControlFlowService;
    private variables: Map<string, CortexValue> = new Map();
    private customEvaluators: Map<string, (left: any, right: any, condition: CortexCondition) => boolean> = new Map();

    private constructor() {
        this.initializeCustomEvaluators();
    }

    public static getInstance(): CortexControlFlowService {
        if (!CortexControlFlowService.instance) {
            CortexControlFlowService.instance = new CortexControlFlowService();
        }
        return CortexControlFlowService.instance;
    }

    /**
     * Execute control flow logic in Cortex frames
     */
    public async executeControlFlow(
        controlFrame: CortexControlFrame | CortexConditionalFrame | CortexLoopFrame | CortexSequenceFrame
    ): Promise<ControlFlowExecutionResult> {
        const startTime = Date.now();
        const executedSteps: string[] = [];
        const errors: ControlFlowError[] = [];
        const warnings: string[] = [];

        try {
            // Initialize execution context
            this.initializeVariables(controlFrame);

            let result: CortexValue | CortexFrame[];

            // Execute based on frame type
            switch (controlFrame.frameType) {
                case 'control':
                    result = await this.executeGenericControl(controlFrame, executedSteps, errors);
                    break;
                
                case 'conditional':
                    result = await this.executeConditional(controlFrame, executedSteps, errors);
                    break;
                
                case 'loop':
                    result = await this.executeLoop(controlFrame, executedSteps, errors);
                    break;
                
                case 'sequence':
                    result = await this.executeSequence(controlFrame, executedSteps, errors);
                    break;
                
                default:
                    throw new Error(`Unsupported control frame type: ${(controlFrame as any).frameType || 'unknown'}`);
            }

            loggingService.info('🔄 Control flow execution completed', {
                frameType: controlFrame.frameType,
                controlType: (controlFrame as any).controlType,
                executedSteps: executedSteps.length,
                executionTime: Date.now() - startTime,
                success: errors.filter(e => !e.recoverable).length === 0
            });

            return {
                success: errors.filter(e => !e.recoverable).length === 0,
                result,
                executedSteps,
                variables: Object.fromEntries(this.variables.entries()),
                metadata: {
                    totalSteps: executedSteps.length,
                    executionTime: Date.now() - startTime,
                    errors,
                    warnings
                }
            };

        } catch (error) {
            loggingService.error('❌ Control flow execution failed', {
                frameType: controlFrame.frameType,
                error: error instanceof Error ? error.message : String(error)
            });

            errors.push({
                code: 'EXECUTION_FAILED',
                message: error instanceof Error ? error.message : String(error),
                recoverable: false
            });

            return {
                success: false,
                result: 'Control flow execution failed',
                executedSteps,
                variables: Object.fromEntries(this.variables.entries()),
                metadata: {
                    totalSteps: executedSteps.length,
                    executionTime: Date.now() - startTime,
                    errors,
                    warnings
                }
            };
        }
    }

    /**
     * Create conditional frame
     */
    public createConditionalFrame(
        condition: CortexCondition,
        thenBranch: CortexFrame[],
        elseBranch?: CortexFrame[]
    ): CortexConditionalFrame {
        return {
            frameType: 'conditional',
            condition,
            thenBranch,
            elseBranch
        };
    }

    /**
     * Create loop frame
     */
    public createLoopFrame(
        loopType: 'for' | 'while' | 'foreach' | 'repeat',
        body: CortexFrame[],
        options: {
            condition?: CortexCondition;
            iterationVariable?: string;
            iterationSource?: CortexValue | string;
            maxIterations?: number;
            counter?: { start: number; end: number; step: number; };
        } = {}
    ): CortexLoopFrame {
        return {
            frameType: 'loop',
            loopType,
            body,
            maxIterations: options.maxIterations ?? 100,
            condition: options.condition,
            iterationVariable: options.iterationVariable,
            iterationSource: options.iterationSource,
            counter: options.counter
        };
    }

    /**
     * Create sequence frame
     */
    public createSequenceFrame(
        steps: CortexFrame[],
        options: {
            stopOnError?: boolean;
            collectResults?: boolean;
            variables?: Record<string, CortexValue>;
        } = {}
    ): CortexSequenceFrame {
        return {
            frameType: 'sequence',
            steps,
            stopOnError: options.stopOnError !== false,
            collectResults: options.collectResults !== false,
            variables: options.variables
        };
    }

    /**
     * Create condition
     */
    public createCondition(
        left: CortexValue | string,
        operator: string,
        right?: CortexValue | string
    ): CortexCondition {
        return {
            type: this.getConditionType(operator),
            left,
            operator: operator as 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'matches' | 'and' | 'or' | 'not' | 'exists',
            right
        };
    }

    // ========================================================================
    // PRIVATE EXECUTION METHODS
    // ========================================================================

    private async executeGenericControl(
        controlFrame: CortexControlFrame,
        executedSteps: string[],
        errors: ControlFlowError[]
    ): Promise<CortexValue | CortexFrame[]> {
        const results: any[] = [];

        for (const step of controlFrame.steps) {
            try {
                executedSteps.push(step.id as string);
                
                switch (step.type) {
                    case 'action':
                        if (step.frame) {
                            const result = await this.executeFrame();
                            results.push(result);
                        }
                        break;
                    
                    case 'condition':
                        if (step.condition) {
                            const conditionResult = this.evaluateCondition(step.condition);
                            results.push(conditionResult);
                        }
                        break;
                    
                    case 'assignment':
                        if (step.assignment) {
                            const value = this.resolveValue(step.assignment.value);
                            this.setVariable(step.assignment.variable, value);
                            results.push(value);
                        }
                        break;
                }

                // Handle control flow (next steps)
                if (step.nextSteps && step.nextSteps.length > 0) {
                    // This would require more sophisticated control flow logic
                    // For now, we execute steps sequentially
                }

            } catch (error) {
                const controlError: ControlFlowError = {
                    stepId: step.id,
                    code: 'STEP_EXECUTION_FAILED',
                    message: error instanceof Error ? error.message : String(error),
                    recoverable: step.errorHandling?.onError !== 'stop'
                };

                errors.push(controlError);

                if (step.errorHandling?.onError === 'stop') {
                    break;
                }
            }
        }

        return results.length === 1 ? results[0] : results;
    }

    private async executeConditional(
        conditionalFrame: CortexConditionalFrame,
        executedSteps: string[],
        errors: ControlFlowError[]
    ): Promise<CortexValue | CortexFrame[]> {
        try {
            // Evaluate main condition
            const conditionResult = this.evaluateCondition(conditionalFrame.condition);
            executedSteps.push(`condition_${conditionalFrame.condition.type}`);

            if (conditionResult) {
                // Execute then branch
                executedSteps.push('then_branch');
                return await this.executeFrameSequence(conditionalFrame.thenBranch);
            } else {
                // Check else-if conditions
                if (conditionalFrame.elseIfBranches) {
                    for (let i = 0; i < conditionalFrame.elseIfBranches.length; i++) {
                        const elseIf = conditionalFrame.elseIfBranches[i];
                        const elseIfResult = this.evaluateCondition(elseIf.condition);
                        executedSteps.push(`elseif_${i}_condition`);

                        if (elseIfResult) {
                            executedSteps.push(`elseif_${i}_branch`);
                            return await this.executeFrameSequence(elseIf.branch);
                        }
                    }
                }

                // Execute else branch if present
                if (conditionalFrame.elseBranch) {
                    executedSteps.push('else_branch');
                    return await this.executeFrameSequence(conditionalFrame.elseBranch);
                }
            }

            return 'No condition met';

        } catch (error) {
            errors.push({
                code: 'CONDITIONAL_EXECUTION_FAILED',
                message: error instanceof Error ? error.message : String(error),
                recoverable: false
            });
            return 'Conditional execution failed';
        }
    }

    private async executeLoop(
        loopFrame: CortexLoopFrame,
        executedSteps: string[],
        errors: ControlFlowError[]
    ): Promise<CortexValue | CortexFrame[]> {
        const results: any[] = [];
        let iteration = 0;
        
        try {
            switch (loopFrame.loopType) {
                case 'for':
                    if (loopFrame.counter) {
                        for (let i = loopFrame.counter.start; i <= loopFrame.counter.end; i += loopFrame.counter.step) {
                            if (iteration >= loopFrame.maxIterations) break;
                            
                            if (loopFrame.iterationVariable) {
                                this.setVariable(loopFrame.iterationVariable, i);
                            }
                            
                            executedSteps.push(`loop_iteration_${iteration}`);
                            const iterationResult = await this.executeFrameSequence(loopFrame.body);
                            results.push(iterationResult);
                            iteration++;
                        }
                    }
                    break;
                
                case 'while':
                    while (iteration < loopFrame.maxIterations) {
                        if (loopFrame.condition && !this.evaluateCondition(loopFrame.condition)) {
                            break;
                        }
                        
                        executedSteps.push(`loop_iteration_${iteration}`);
                        const iterationResult = await this.executeFrameSequence(loopFrame.body);
                        results.push(iterationResult);
                        iteration++;
                    }
                    break;
                
                case 'foreach':
                    if (loopFrame.iterationSource) {
                        const source = this.resolveValue(loopFrame.iterationSource);
                        if (Array.isArray(source)) {
                            for (const item of source) {
                                if (iteration >= loopFrame.maxIterations) break;
                                
                                if (loopFrame.iterationVariable) {
                                    this.setVariable(loopFrame.iterationVariable, item);
                                }
                                
                                executedSteps.push(`loop_iteration_${iteration}`);
                                const iterationResult = await this.executeFrameSequence(loopFrame.body);
                                results.push(iterationResult);
                                iteration++;
                            }
                        }
                    }
                    break;
                
                case 'repeat':
                    const repeatCount = loopFrame.counter?.end || loopFrame.maxIterations;
                    for (let i = 0; i < repeatCount && i < loopFrame.maxIterations; i++) {
                        executedSteps.push(`loop_iteration_${iteration}`);
                        const iterationResult = await this.executeFrameSequence(loopFrame.body);
                        results.push(iterationResult);
                        iteration++;
                    }
                    break;
            }

            return results;

        } catch (error) {
            errors.push({
                code: 'LOOP_EXECUTION_FAILED',
                message: error instanceof Error ? error.message : String(error),
                details: { iteration, loopType: loopFrame.loopType },
                recoverable: false
            });
            return results;
        }
    }

    private async executeSequence(
        sequenceFrame: CortexSequenceFrame,
        executedSteps: string[],
        errors: ControlFlowError[]
    ): Promise<CortexValue | CortexFrame[]> {
        const results: any[] = [];

        // Initialize sequence variables
        if (sequenceFrame.variables) {
            for (const [key, value] of Object.entries(sequenceFrame.variables)) {
                this.setVariable(key, value);
            }
        }

        for (let i = 0; i < sequenceFrame.steps.length; i++) {
            try {
                executedSteps.push(`sequence_step_${i}`);
                const stepResult = await this.executeFrame();
                
                if (sequenceFrame.collectResults) {
                    results.push(stepResult);
                }

            } catch (error) {
                const stepError: ControlFlowError = {
                    code: 'SEQUENCE_STEP_FAILED',
                    message: error instanceof Error ? error.message : String(error),
                    details: { stepIndex: i },
                    recoverable: !sequenceFrame.stopOnError
                };

                errors.push(stepError);

                if (sequenceFrame.stopOnError) {
                    break;
                }
            }
        }

        return sequenceFrame.collectResults ? results : results[results.length - 1];
    }

    // ========================================================================
    // HELPER METHODS
    // ========================================================================

    private evaluateCondition(condition: CortexCondition): boolean {
        const leftValue = this.resolveValue(condition.left);
        const rightValue = condition.right ? this.resolveValue(condition.right) : null;

        switch (condition.operator) {
            case 'eq':
                return leftValue === rightValue;
            case 'neq':
                return leftValue !== rightValue;
            case 'gt':
                return Number(leftValue) > Number(rightValue);
            case 'lt':
                return Number(leftValue) < Number(rightValue);
            case 'gte':
                return Number(leftValue) >= Number(rightValue);
            case 'lte':
                return Number(leftValue) <= Number(rightValue);
            case 'contains':
                return String(leftValue).includes(String(rightValue));
            case 'exists':
                return leftValue != null;
            case 'and':
                return condition.conditions ? 
                    condition.conditions.every(c => this.evaluateCondition(c)) : false;
            case 'or':
                return condition.conditions ? 
                    condition.conditions.some(c => this.evaluateCondition(c)) : false;
            case 'not':
                return !leftValue;
            default:
                if (condition.customEvaluator && this.customEvaluators.has(condition.customEvaluator)) {
                    const evaluator = this.customEvaluators.get(condition.customEvaluator)!;
                    return evaluator(leftValue, rightValue, condition);
                }
                return false;
        }
    }

    private resolveValue(value: CortexValue | string): any {
        if (typeof value === 'string' && value.startsWith('$')) {
            // Variable reference
            const variableName = value.substring(1);
            return this.variables.get(variableName) || null;
        }
        return value;
    }

    private setVariable(name: string, value: CortexValue): void {
        this.variables.set(name, value);
    }

    private async executeFrame(): Promise<any> {
        // This would delegate to appropriate frame processors
        throw new Error('Frame execution not implemented - requires integration with actual frame processors');
    }

    private async executeFrameSequence(frames: CortexFrame[]): Promise<any[]> {
        const results = [];
        for (const frame of frames) {
            const result = await this.executeFrame();
            results.push(result);
        }
        return results;
    }

    private initializeVariables(frame: any): void {
        this.variables.clear();
        
        // Initialize from frame metadata
        if (frame.metadata?.variables) {
            for (const [key, value] of Object.entries(frame.metadata.variables)) {
                this.variables.set(key, value as CortexValue);
            }
        }
    }

    private initializeCustomEvaluators(): void {
        // Add custom condition evaluators
        this.customEvaluators.set('string_length', (left: any, right: any) => {
            return String(left).length === Number(right);
        });

        this.customEvaluators.set('array_contains', (left: any, right: any) => {
            return Array.isArray(left) && left.includes(right);
        });

        this.customEvaluators.set('regex_match', (left: any, right: any) => {
            const regex = new RegExp(String(right));
            return regex.test(String(left));
        });
    }

    private getConditionType(operator: string): 'comparison' | 'logical' | 'existence' | 'pattern' | 'custom' {
        const comparisonOps = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains'];
        const logicalOps = ['and', 'or', 'not'];
        const existenceOps = ['exists'];
        const patternOps = ['matches'];

        if (comparisonOps.includes(operator)) return 'comparison';
        if (logicalOps.includes(operator)) return 'logical';
        if (existenceOps.includes(operator)) return 'existence';
        if (patternOps.includes(operator)) return 'pattern';
        return 'custom';
    }
}
