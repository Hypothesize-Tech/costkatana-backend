/**
 * Prompt AST Types
 *
 * Defines the Abstract Syntax Tree (AST) structures for prompt compilation
 * and optimization in the Cost Katana compiler system.
 */

export type ASTNodeType =
  | 'program'
  | 'block'
  | 'statement'
  | 'expression'
  | 'literal'
  | 'identifier'
  | 'assignment'
  | 'function_call'
  | 'binary_operation'
  | 'unary_operation'
  | 'conditional'
  | 'loop'
  | 'function_definition'
  | 'return_statement'
  | 'import_statement'
  | 'export_statement'
  | 'binary_expression'
  | 'unary_expression'
  | 'string_literal'
  | 'number_literal'
  | 'boolean_literal'
  | 'variable_declaration'
  | 'function_declaration'
  | 'array_expression'
  | 'object_expression';

export type ASTDataType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'function'
  | 'null'
  | 'undefined'
  | 'any';

export interface ASTLocation {
  line: number;
  column: number;
  offset?: number;
}

export interface ASTSourceLocation {
  start: ASTLocation;
  end: ASTLocation;
  source?: string;
}

export interface ASTBaseNode {
  type: ASTNodeType;
  location?: ASTSourceLocation;
  metadata?: Record<string, any>;
}

export interface ASTProgram extends ASTBaseNode {
  type: 'program';
  body: ASTStatement[];
  dependencies: string[];
  metadata: {
    language: string;
    version: string;
    optimized: boolean;
    tokenCount: number;
    complexity: number;
    statements?: number;
    functions?: number;
    tokens?: number;
    [key: string]: unknown;
  };
}

export interface ASTBlock extends ASTBaseNode {
  type: 'block';
  statements: ASTStatement[];
  scope: ASTScope;
}

export type ASTStatementType =
  | 'statement'
  | 'assignment'
  | 'loop'
  | 'function_definition'
  | 'return_statement'
  | 'import_statement'
  | 'export_statement'
  | 'variable_declaration'
  | 'function_declaration';

export interface ASTStatement extends ASTBaseNode {
  type: ASTStatementType;
}

export type ASTExpressionType =
  | 'expression'
  | 'literal'
  | 'identifier'
  | 'function_call'
  | 'binary_operation'
  | 'unary_operation'
  | 'conditional'
  | 'binary_expression'
  | 'unary_expression'
  | 'string_literal'
  | 'number_literal'
  | 'boolean_literal'
  | 'array_expression'
  | 'object_expression';

export interface ASTExpression extends ASTBaseNode {
  type: ASTExpressionType;
  dataType?: ASTDataType;
  constant?: boolean;
  dependencies?: string[];
  value?: unknown;
  left?: ASTExpression;
  right?: ASTExpression;
  operator?: string;
  argument?: ASTExpression;
  name?: string;
  arguments?: ASTExpression[];
}

export interface ASTLiteral extends ASTExpression {
  type: 'literal';
  value: any;
  raw: string;
}

export interface ASTIdentifier extends ASTExpression {
  type: 'identifier';
  name: string;
  scope: ASTScope;
  definition?: ASTNode;
}

export interface ASTAssignment extends ASTStatement {
  type: 'assignment';
  left: ASTIdentifier;
  right: ASTExpression;
  operator: '=' | '+=' | '-=' | '*=' | '/=';
}

export interface ASTFunctionCall extends ASTExpression {
  type: 'function_call';
  name?: string;
  callee?: ASTExpression;
  arguments: ASTExpression[];
  isAsync?: boolean;
  estimatedExecutionTime?: number;
  body?: ASTNode[];
}

export interface ASTBinaryOperation extends ASTExpression {
  type: 'binary_operation';
  left: ASTExpression;
  right: ASTExpression;
  operator:
    | '+'
    | '-'
    | '*'
    | '/'
    | '%'
    | '=='
    | '!='
    | '<'
    | '>'
    | '<='
    | '>='
    | '&&'
    | '||';
}

export interface ASTUnaryOperation extends ASTExpression {
  type: 'unary_operation';
  argument: ASTExpression;
  operator: '!' | '-' | '+' | 'typeof' | 'void';
}

export interface ASTConditional extends ASTExpression {
  type: 'conditional';
  test: ASTExpression;
  consequent: ASTBlock;
  alternate?: ASTBlock;
  estimatedBranchProbability: number;
}

export interface ASTLoop extends ASTStatement {
  type: 'loop';
  loopType: 'for' | 'while' | 'do_while' | 'for_of' | 'for_in';
  test?: ASTExpression;
  init?: ASTStatement;
  update?: ASTExpression;
  body: ASTBlock;
  estimatedIterations: number;
}

export interface ASTFunctionDefinition extends ASTStatement {
  type: 'function_definition';
  name: ASTIdentifier;
  parameters: ASTParameter[];
  body: ASTBlock;
  returnType: ASTDataType;
  isAsync: boolean;
  isGenerator: boolean;
  complexity: number;
  dependencies: string[];
}

export interface ASTParameter {
  name: ASTIdentifier;
  type: ASTDataType;
  defaultValue?: ASTExpression;
  isRest: boolean;
}

export interface ASTReturnStatement extends ASTStatement {
  type: 'return_statement';
  argument?: ASTExpression;
}

export interface ASTImportStatement extends ASTStatement {
  type: 'import_statement';
  specifiers: ASTImportSpecifier[];
  source: ASTLiteral;
}

export interface ASTImportSpecifier {
  type: 'import' | 'default' | 'namespace';
  local: ASTIdentifier;
  imported?: ASTIdentifier;
}

export interface ASTExportStatement extends ASTStatement {
  type: 'export_statement';
  declaration?: ASTStatement;
  specifiers?: ASTExportSpecifier[];
  source?: ASTLiteral;
}

/** Variable declaration (const/let) - used by compiler analysis */
export interface ASTVariableDeclaration extends ASTStatement {
  type: 'variable_declaration';
  kind: 'const' | 'let' | 'var';
  name: string;
  value: ASTExpression;
  expression?: ASTExpression;
  metadata?: { lineNumber?: number };
}

/** Function declaration - used by compiler analysis */
export interface ASTFunctionDeclaration extends ASTStatement {
  type: 'function_declaration';
  name: string;
  body?: ASTNode[];
  metadata?: { lineNumber?: number };
}

export interface ASTExportSpecifier {
  local: ASTIdentifier;
  exported: ASTIdentifier;
}

export type ASTNode =
  | ASTProgram
  | ASTBlock
  | ASTStatement
  | ASTExpression
  | ASTLiteral
  | ASTIdentifier
  | ASTAssignment
  | ASTFunctionCall
  | ASTBinaryOperation
  | ASTUnaryOperation
  | ASTConditional
  | ASTLoop
  | ASTFunctionDefinition
  | ASTReturnStatement
  | ASTImportStatement
  | ASTExportStatement
  | ASTVariableDeclaration
  | ASTFunctionDeclaration;

export interface ASTScope {
  id: string;
  parent?: ASTScope;
  variables: Map<string, ASTVariable>;
  functions: Map<string, ASTFunctionDefinition>;
  types: Map<string, ASTDataType>;
  isGlobal: boolean;
  depth: number;
}

export interface ASTVariable {
  name: string;
  type: ASTDataType;
  constant: boolean;
  initialized: boolean;
  used: boolean;
  definition: ASTNode;
  references: ASTNode[];
}

export interface ASTCompilationOptions {
  target: 'optimization' | 'execution' | 'analysis';
  optimizationLevel: 'none' | 'basic' | 'advanced';
  preserveFormatting: boolean;
  enableInlining: boolean;
  enableConstantFolding: boolean;
  enableDeadCodeElimination: boolean;
  maxIterations: number;
  timeout: number;
}

export interface ASTCompilationResult {
  ast: ASTProgram;
  optimized: boolean;
  optimizations: ASTOptimization[];
  warnings: string[];
  errors: string[];
  metadata: {
    compilationTime: number;
    originalTokens: number;
    optimizedTokens: number;
    compressionRatio: number;
    complexity: number;
  };
}

export interface ASTOptimization {
  type:
    | 'constant_folding'
    | 'dead_code_elimination'
    | 'function_inlining'
    | 'loop_unrolling'
    | 'variable_renaming'
    | 'loop_optimization';
  description: string;
  location: ASTSourceLocation | ASTLocation;
  savings: {
    tokens: number;
    complexity?: number;
  };
  confidence: number;
}

export interface ASTAnalysisResult {
  complexity: number;
  cyclomaticComplexity: number;
  tokenCount: number;
  dependencies: string[];
  unusedVariables: string[];
  potentialOptimizations: ASTOptimization[];
  performance: {
    estimatedExecutionTime: number;
    memoryUsage: number;
    ioOperations: number;
  };
}

export interface ASTDependencyGraph {
  nodes: Map<string, ASTNode>;
  edges: Array<{
    from: string;
    to: string;
    type: 'depends_on' | 'calls' | 'references' | 'modifies';
    weight: number;
  }>;
  cycles: string[][];
  entryPoints: string[];
}

export interface ASTExecutionPlan {
  steps: ASTExecutionStep[];
  parallelGroups: ASTExecutionStep[][];
  estimatedTime: number;
  resourceRequirements: {
    memory: number;
    cpu: number;
    io: number;
  };
  dependencies: ASTDependencyGraph;
}

export interface ASTExecutionStep {
  id: string;
  node: ASTNode;
  dependencies: string[];
  estimatedTime: number;
  resourceUsage: {
    memory: number;
    cpu: number;
  };
  canParallelize: boolean;
  priority: number;
}

export class ASTError extends Error {
  constructor(
    public code: string,
    public message: string,
    public location?: ASTSourceLocation,
    public node?: ASTNode,
  ) {
    super(message);
    this.name = 'ASTError';
  }
}

export class ASTCompilationError extends ASTError {
  constructor(message: string, location?: ASTSourceLocation, node?: ASTNode) {
    super('COMPILATION_ERROR', message, location, node);
  }
}

export class ASTOptimizationError extends ASTError {
  constructor(message: string, location?: ASTSourceLocation, node?: ASTNode) {
    super('OPTIMIZATION_ERROR', message, location, node);
  }
}
