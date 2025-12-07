/**
 * Prompt Compiler - AST/IR Definitions
 * 
 * Abstract Syntax Tree and Intermediate Representation for prompts
 * Enables compiler-like optimizations:
 * - Dead code elimination
 * - Constant folding
 * - Dependency analysis
 * - Parallel execution detection
 * - Token optimization passes
 */

/**
 * Base AST Node
 */
export interface ASTNode {
  type: string;
  id: string;
  metadata: {
    startPos: number;
    endPos: number;
    tokens?: number;
    cost?: number;
  };
}

/**
 * Program - Root node
 */
export interface ProgramNode extends ASTNode {
  type: 'Program';
  body: StatementNode[];
  dependencies: string[];
}

/**
 * Statement types
 */
export type StatementNode =
  | InstructionNode
  | ContextNode
  | ConstraintNode
  | OutputFormatNode
  | ConditionalNode
  | LoopNode
  | VariableNode;

/**
 * Instruction - Core prompt instruction
 */
export interface InstructionNode extends ASTNode {
  type: 'Instruction';
  directive: string; // e.g., "generate", "analyze", "translate"
  subject: ExpressionNode;
  modifiers: ModifierNode[];
  dependencies: string[];
}

/**
 * Context - Background information
 */
export interface ContextNode extends ASTNode {
  type: 'Context';
  scope: 'global' | 'local';
  content: ExpressionNode;
  priority: number; // 0-10, for elimination in optimization
  required: boolean;
}

/**
 * Constraint - Output constraint
 */
export interface ConstraintNode extends ASTNode {
  type: 'Constraint';
  constraint: 'length' | 'format' | 'style' | 'tone' | 'custom';
  value: ExpressionNode;
  strict: boolean;
}

/**
 * OutputFormat - Expected output structure
 */
export interface OutputFormatNode extends ASTNode {
  type: 'OutputFormat';
  format: 'json' | 'markdown' | 'code' | 'text' | 'list';
  schema?: Record<string, any>;
}

/**
 * Conditional - Conditional instruction
 */
export interface ConditionalNode extends ASTNode {
  type: 'Conditional';
  condition: ExpressionNode;
  then: StatementNode[];
  else?: StatementNode[];
}

/**
 * Loop - Repeated instruction
 */
export interface LoopNode extends ASTNode {
  type: 'Loop';
  iterator: string;
  collection: ExpressionNode;
  body: StatementNode[];
  parallel: boolean; // Can be executed in parallel
}

/**
 * Variable - Named reference
 */
export interface VariableNode extends ASTNode {
  type: 'Variable';
  name: string;
  value: ExpressionNode;
  constant: boolean;
}

/**
 * Expression types
 */
export type ExpressionNode =
  | LiteralNode
  | VariableRefNode
  | TemplateNode
  | FunctionCallNode
  | BinaryOpNode;

/**
 * Literal - Raw text/data
 */
export interface LiteralNode extends ASTNode {
  type: 'Literal';
  value: string | number | boolean;
  compressible: boolean;
}

/**
 * VariableRef - Reference to variable
 */
export interface VariableRefNode extends ASTNode {
  type: 'VariableRef';
  name: string;
}

/**
 * Template - String template with interpolation
 */
export interface TemplateNode extends ASTNode {
  type: 'Template';
  parts: (string | VariableRefNode)[];
}

/**
 * FunctionCall - Built-in function
 */
export interface FunctionCallNode extends ASTNode {
  type: 'FunctionCall';
  function: string; // e.g., "summarize", "extract", "format"
  arguments: ExpressionNode[];
  pure: boolean; // Can be cached/memoized
}

/**
 * BinaryOp - Binary operation
 */
export interface BinaryOpNode extends ASTNode {
  type: 'BinaryOp';
  operator: '+' | '&&' | '||' | '==';
  left: ExpressionNode;
  right: ExpressionNode;
}

/**
 * Modifier - Instruction modifier
 */
export interface ModifierNode extends ASTNode {
  type: 'Modifier';
  modifier: 'concise' | 'detailed' | 'creative' | 'factual' | 'step-by-step';
  strength: number; // 0-1
}

/**
 * Intermediate Representation (IR)
 * 
 * Lower-level representation after optimization passes
 */
export interface IRProgram {
  version: string;
  instructions: IRInstruction[];
  metadata: {
    originalTokens: number;
    optimizedTokens: number;
    optimizationPasses: string[];
    parallelGroups?: IRParallelGroup[];
  };
}

/**
 * IR Instruction
 */
export interface IRInstruction {
  id: string;
  opcode: IROpcode;
  operands: IROperand[];
  dependencies: string[];
  cost: {
    tokens: number;
    estimatedMs: number;
  };
  optimizations: string[];
}

/**
 * IR Opcodes
 */
export enum IROpcode {
  // Core operations
  PROMPT = 'PROMPT',
  CONTEXT = 'CONTEXT',
  CONSTRAINT = 'CONSTRAINT',
  OUTPUT = 'OUTPUT',
  
  // Control flow
  BRANCH = 'BRANCH',
  LOOP = 'LOOP',
  CALL = 'CALL',
  
  // Data operations
  LOAD = 'LOAD',
  STORE = 'STORE',
  CONCAT = 'CONCAT',
  
  // Optimization hints
  CACHE = 'CACHE',
  COMPRESS = 'COMPRESS',
  PARALLELIZE = 'PARALLELIZE',
}

/**
 * IR Operand
 */
export interface IROperand {
  type: 'register' | 'constant' | 'reference';
  value: any;
  metadata?: Record<string, any>;
}

/**
 * IR Parallel Group
 * 
 * Instructions that can execute in parallel
 */
export interface IRParallelGroup {
  id: string;
  instructions: string[]; // Instruction IDs
  estimatedSpeedup: number; // Expected speedup factor
}

/**
 * Optimization Pass Result
 */
export interface OptimizationPassResult {
  passName: string;
  applied: boolean;
  transformations: Array<{
    type: string;
    description: string;
    tokensSaved: number;
    costSaved: number;
  }>;
  warnings: string[];
}

/**
 * Compilation Result
 */
export interface CompilationResult {
  success: boolean;
  ast?: ProgramNode;
  ir?: IRProgram;
  optimizedPrompt: string;
  metrics: {
    originalTokens: number;
    optimizedTokens: number;
    tokenReduction: number;
    estimatedCost: number;
    optimizationPasses: OptimizationPassResult[];
  };
  errors: CompilationError[];
  warnings: string[];
}

/**
 * Compilation Error
 */
export interface CompilationError {
  type: 'syntax' | 'semantic' | 'optimization';
  message: string;
  position?: { line: number; column: number };
  severity: 'error' | 'warning';
}

