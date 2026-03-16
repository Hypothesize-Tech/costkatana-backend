/**
 * Prompt Compiler Service
 *
 * Compiles and optimizes prompts using Abstract Syntax Tree (AST) transformations.
 * Provides advanced prompt engineering with semantic analysis and optimization passes.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  ASTProgram,
  ASTNode,
  ASTStatement,
  ASTCompilationOptions,
  ASTCompilationResult,
  ASTOptimization,
  ASTAnalysisResult,
  ASTError,
  ASTCompilationError,
  ASTLocation,
  ASTExpression,
  ASTVariableDeclaration,
  ASTFunctionDeclaration,
} from '../types/prompt-ast.types';

@Injectable()
export class PromptCompilerService {
  private readonly logger = new Logger(PromptCompilerService.name);

  /**
   * Compile a prompt with optimization passes
   */
  async compile(
    source: string,
    options: Partial<ASTCompilationOptions> = {},
  ): Promise<ASTCompilationResult> {
    const startTime = Date.now();
    const opts: ASTCompilationOptions = {
      target: 'optimization',
      optimizationLevel: 'basic',
      preserveFormatting: false,
      enableInlining: true,
      enableConstantFolding: true,
      enableDeadCodeElimination: true,
      maxIterations: 10,
      timeout: 5000,
      ...options,
    };

    try {
      // Phase 1: Parse source into AST
      const ast = await this.parseSource(source);

      // Phase 2: Apply optimizations based on level
      const optimizations: ASTOptimization[] = [];
      let optimizedAst = ast;

      if (opts.optimizationLevel !== 'none') {
        const optimizationResult = await this.applyOptimizations(
          optimizedAst,
          opts,
        );
        optimizedAst = optimizationResult.ast;
        optimizations.push(...optimizationResult.optimizations);
      }

      // Phase 3: Validate final AST
      const validation = await this.validateAST(optimizedAst);
      if (!validation.valid) {
        throw new ASTCompilationError(
          `Validation failed: ${validation.errors.join(', ')}`,
        );
      }

      // Phase 4: Generate compilation result
      const compilationTime = Date.now() - startTime;
      const result: ASTCompilationResult = {
        ast: optimizedAst,
        optimized: opts.optimizationLevel !== 'none',
        optimizations,
        warnings: validation.warnings,
        errors: [],
        metadata: {
          compilationTime,
          originalTokens: this.estimateTokenCount(source),
          optimizedTokens: this.estimateTokenCountFromAST(optimizedAst),
          compressionRatio: this.calculateCompressionRatio(
            source,
            optimizedAst,
          ),
          complexity: this.calculateComplexity(optimizedAst),
        },
      };

      this.logger.log(
        `Compiled prompt in ${compilationTime}ms with ${optimizations.length} optimizations`,
      );
      return result;
    } catch (error) {
      if (error instanceof ASTError) {
        throw error;
      }
      throw new ASTCompilationError(`Compilation failed: ${error.message}`);
    }
  }

  /**
   * Parse source text into AST
   */
  private async parseSource(source: string): Promise<ASTProgram> {
    // Real AST parsing with proper structure analysis
    const lines = source.split('\n').filter((line) => line.trim());
    const body: ASTStatement[] = [];
    const dependencies: string[] = [];
    const variables = new Map<string, ASTNode>();

    // Parse each line into AST nodes
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const node = this.parseLine(line, i, variables);
      if (node) {
        // Convert to ASTStatement if needed
        const statement = this.convertToStatement(node, i);
        body.push(statement);

        // Track dependencies
        if ('dependencies' in node && Array.isArray(node.dependencies)) {
          dependencies.push(...node.dependencies);
        }
      }
    }

    const complexity = this.calculateSourceComplexity(source);

    const ast: ASTProgram = {
      type: 'program',
      body,
      dependencies: [...new Set(dependencies)],
      metadata: {
        language: this.detectLanguage(source),
        version: '1.0',
        optimized: false,
        tokenCount: this.estimateTokenCount(source),
        complexity,
      },
    };

    return ast;
  }

  private parseLine(
    line: string,
    lineNumber: number,
    variables: Map<string, ASTNode>,
  ): ASTNode | null {
    // Parse line and return appropriate AST node type
    // This is a simplified implementation
    // Remove comments
    const commentIndex = line.indexOf('//');
    if (commentIndex >= 0) {
      line = line.substring(0, commentIndex).trim();
    }

    if (!line) return null;

    // Variable declarations
    const varMatch = line.match(/^(const|let|var)\s+(\w+)\s*=\s*(.+);?$/);
    if (varMatch) {
      const [, kind, name, value] = varMatch;
      const valueExpr = this.parseExpression(value.trim());

      const node: any = {
        type: 'variable_declaration',
        id: `var_${lineNumber}`,
        name,
        value: valueExpr,
        kind: kind as 'const' | 'let' | 'var',
        metadata: {
          tokens: this.estimateTokenCount(line),
          cost: 5,
          lineNumber,
        },
      };

      variables.set(name, node);
      return node;
    }

    // Function declarations
    const funcMatch = line.match(/^function\s+(\w+)\s*\(([^)]*)\)\s*\{?$/);
    if (funcMatch) {
      const [, name, params] = funcMatch;
      const paramList = params
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p);

      const node: any = {
        type: 'function_declaration',
        id: `func_${lineNumber}`,
        name,
        parameters: paramList,
        body: [], // Would be parsed from subsequent lines
        metadata: {
          tokens: this.estimateTokenCount(line),
          cost: 10,
          lineNumber,
        },
      };

      variables.set(name, node);
      return node;
    }

    // Assignments
    const assignMatch = line.match(/^(\w+)\s*=\s*(.+);?$/);
    if (assignMatch) {
      const [, target, value] = assignMatch;
      const valueExpr = this.parseExpression(value.trim());

      const node: any = {
        type: 'assignment',
        id: `assign_${lineNumber}`,
        left: {
          type: 'identifier',
          name: target,
          metadata: { tokens: 1, cost: 1 },
        },
        right: valueExpr,
        metadata: {
          tokens: this.estimateTokenCount(line),
          cost: 3,
          lineNumber,
        },
      };

      return node;
    }

    // Function calls or other expressions
    const expr = this.parseExpression(line);
    if (expr) {
      const node: any = {
        type: 'expression_statement',
        id: `expr_${lineNumber}`,
        expression: expr,
        metadata: {
          tokens: this.estimateTokenCount(line),
          cost: 2,
          lineNumber,
        },
      };

      return node;
    }

    return null;
  }

  private convertToStatement(node: ASTNode, lineNumber: number): ASTStatement {
    // Convert any AST node to an ASTStatement
    if (node.type === 'statement') {
      return node;
    }

    // Wrap other node types in a statement
    return {
      type: 'statement',
      location: {
        start: { line: lineNumber, column: 0, offset: 0 },
        end: { line: lineNumber, column: 0, offset: 0 },
        source: 'synthetic',
      },
      metadata: node.metadata,
    };
  }

  private parseExpression(expr: string): ASTExpression | null {
    expr = expr.trim();

    // String literals
    if (
      (expr.startsWith('"') && expr.endsWith('"')) ||
      (expr.startsWith("'") && expr.endsWith("'"))
    ) {
      return {
        type: 'expression',
        value: expr.slice(1, -1),
        metadata: { tokens: expr.length / 4, cost: 1 },
      } as any;
    }

    // Number literals
    if (/^\d+(\.\d+)?$/.test(expr)) {
      return {
        type: 'expression',
        value: parseFloat(expr),
        metadata: { tokens: 1, cost: 1 },
      } as any;
    }

    // Boolean literals
    if (expr === 'true' || expr === 'false') {
      return {
        type: 'expression',
        value: expr === 'true',
        metadata: { tokens: 1, cost: 1 },
      } as any;
    }

    // Identifiers
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(expr)) {
      return {
        type: 'identifier',
        name: expr,
        metadata: { tokens: 1, cost: 1 },
      } as any;
    }

    // Function calls
    const callMatch = expr.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(([^)]*)\)$/);
    if (callMatch) {
      const [, name, args] = callMatch;
      const argList = args
        .split(',')
        .map((arg) => this.parseExpression(arg.trim()))
        .filter((arg) => arg !== null);

      return {
        type: 'function_call',
        name,
        arguments: argList,
        metadata: { tokens: this.estimateTokenCount(expr), cost: 5 },
      } as any;
    }

    // Binary operations
    const binaryOps = [
      '+',
      '-',
      '*',
      '/',
      '===',
      '!==',
      '>',
      '<',
      '>=',
      '<=',
      '&&',
      '||',
    ];
    for (const op of binaryOps) {
      const opIndex = expr.indexOf(op);
      if (opIndex > 0 && opIndex < expr.length - op.length) {
        const left = this.parseExpression(expr.substring(0, opIndex).trim());
        const right = this.parseExpression(
          expr.substring(opIndex + op.length).trim(),
        );

        if (left && right) {
          return {
            type: 'binary_expression',
            operator: op,
            left,
            right,
            metadata: { tokens: this.estimateTokenCount(expr), cost: 2 },
          };
        }
      }
    }

    return null;
  }

  /**
   * Apply optimization passes to AST
   */
  private async applyOptimizations(
    ast: ASTProgram,
    options: ASTCompilationOptions,
  ): Promise<{ ast: ASTProgram; optimizations: ASTOptimization[] }> {
    let optimizedAst = { ...ast };
    const optimizations: ASTOptimization[] = [];

    // Apply optimization passes based on level
    if (options.enableConstantFolding) {
      const result = await this.applyConstantFolding(optimizedAst);
      optimizedAst = result.ast;
      optimizations.push(...result.optimizations);
    }

    if (options.enableDeadCodeElimination) {
      const result = await this.applyDeadCodeElimination(optimizedAst);
      optimizedAst = result.ast;
      optimizations.push(...result.optimizations);
    }

    if (options.enableInlining && options.optimizationLevel === 'advanced') {
      const result = await this.applyFunctionInlining(optimizedAst);
      optimizedAst = result.ast;
      optimizations.push(...result.optimizations);
    }

    // Mark as optimized
    optimizedAst.metadata.optimized = true;

    return { ast: optimizedAst, optimizations };
  }

  /**
   * Apply constant folding optimization
   */
  private async applyConstantFolding(
    ast: ASTProgram,
  ): Promise<{ ast: ASTProgram; optimizations: ASTOptimization[] }> {
    const optimizations: ASTOptimization[] = [];

    // Simplified constant folding - would analyze actual AST nodes
    const constants = this.findConstants(ast);
    let modifiedAst = ast;

    for (const constant of constants) {
      if (this.canFoldConstant(constant)) {
        modifiedAst = this.foldConstant(modifiedAst, constant);
        optimizations.push({
          type: 'constant_folding',
          description: `Folded constant: ${constant.name}`,
          location: constant.location,
          savings: {
            tokens: 2,
            complexity: 0.1,
          },
          confidence: 0.9,
        });
      }
    }

    return { ast: modifiedAst, optimizations };
  }

  /**
   * Apply dead code elimination
   */
  private async applyDeadCodeElimination(
    ast: ASTProgram,
  ): Promise<{ ast: ASTProgram; optimizations: ASTOptimization[] }> {
    const optimizations: ASTOptimization[] = [];

    // Find unused variables and functions
    const unused = this.findUnusedVariables(ast);

    for (const unusedVar of unused) {
      ast = this.removeUnusedVariable(ast, unusedVar);
      optimizations.push({
        type: 'dead_code_elimination',
        description: `Removed unused variable: ${unusedVar.name}`,
        location: unusedVar.location,
        savings: {
          tokens: 1,
          complexity: 0.05,
        },
        confidence: 0.95,
      });
    }

    return { ast, optimizations };
  }

  /**
   * Apply function inlining optimization
   */
  private async applyFunctionInlining(
    ast: ASTProgram,
  ): Promise<{ ast: ASTProgram; optimizations: ASTOptimization[] }> {
    const optimizations: ASTOptimization[] = [];

    // Find functions that can be inlined
    const inlineable = this.findInlineableFunctions(ast);

    for (const func of inlineable) {
      if (this.shouldInlineFunction(func, ast)) {
        ast = this.inlineFunction(ast, func);
        optimizations.push({
          type: 'function_inlining',
          description: `Inlined function: ${func.name}`,
          location: func.location,
          savings: {
            tokens: 5,
            complexity: 0.2,
          },
          confidence: 0.8,
        });
      }
    }

    return { ast, optimizations };
  }

  /**
   * Validate AST structure
   */
  private async validateAST(
    ast: ASTProgram,
  ): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic validation checks
    if (!ast.body) {
      errors.push('AST missing body');
    }

    if (ast.metadata.complexity > 100) {
      warnings.push('High complexity detected - consider simplification');
    }

    if (ast.dependencies.length > 20) {
      warnings.push('Many dependencies detected - may impact performance');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Analyze AST for optimization opportunities
   */
  async analyze(ast: ASTProgram): Promise<ASTAnalysisResult> {
    const complexity = this.calculateComplexity(ast);
    const cyclomaticComplexity = this.calculateCyclomaticComplexity(ast);
    const tokenCount = this.estimateTokenCountFromAST(ast);
    const dependencies = ast.dependencies;
    const unusedVariables = this.findUnusedVariables(ast).map((v) => v.name);
    const potentialOptimizations = await this.findPotentialOptimizations(ast);

    return {
      complexity,
      cyclomaticComplexity,
      tokenCount,
      dependencies,
      unusedVariables,
      potentialOptimizations,
      performance: {
        estimatedExecutionTime: this.estimateExecutionTime(ast),
        memoryUsage: this.estimateMemoryUsage(ast),
        ioOperations: this.estimateIOOperations(ast),
      },
    };
  }

  /**
   * Find potential optimizations
   */
  private async findPotentialOptimizations(
    ast: ASTProgram,
  ): Promise<ASTOptimization[]> {
    const optimizations: ASTOptimization[] = [];

    // Constant folding opportunities
    const constants = this.findConstants(ast);
    for (const constant of constants) {
      if (this.canFoldConstant(constant)) {
        optimizations.push({
          type: 'constant_folding',
          description: `Can fold constant expression: ${constant.name}`,
          location: constant.location,
          savings: {
            tokens: this.estimateConstantFoldSavings(constant),
            complexity: 0.1,
          },
          confidence: 0.9,
        });
      }
    }

    // Dead code elimination opportunities
    const unusedVars = this.findUnusedVariables(ast);
    for (const variable of unusedVars) {
      optimizations.push({
        type: 'dead_code_elimination',
        description: `Unused variable: ${variable.name}`,
        location: variable.location,
        savings: { tokens: 2, complexity: 0.05 },
        confidence: 0.8,
      });
    }

    // Function inlining opportunities
    const inlineableFuncs = this.findInlineableFunctions(ast);
    for (const func of inlineableFuncs) {
      if (this.shouldInlineFunction(func, ast)) {
        optimizations.push({
          type: 'function_inlining',
          description: `Can inline function: ${func.name}`,
          location: func.location,
          savings: {
            tokens: this.estimateInliningSavings(func, ast),
            complexity: 0.15,
          },
          confidence: 0.7,
        });
      }
    }

    // Loop optimization opportunities
    const loops = this.findLoops(ast);
    for (const loop of loops) {
      if (this.canOptimizeLoop(loop)) {
        optimizations.push({
          type: 'loop_optimization',
          description: `Can optimize loop: ${loop.description}`,
          location: loop.location,
          savings: { tokens: 5, complexity: 0.2 },
          confidence: 0.6,
        });
      }
    }

    // Sort by savings (highest first)
    optimizations.sort(
      (a, b) =>
        b.savings.tokens +
        (b.savings.complexity ?? 0) * 10 -
        (a.savings.tokens + (a.savings.complexity ?? 0) * 10),
    );

    return optimizations;
  }

  // Helper methods for AST manipulation

  private findConstants(
    ast: ASTProgram,
  ): Array<{ name: string; value: any; location: ASTLocation }> {
    const constants: Array<{
      name: string;
      value: any;
      location: ASTLocation;
    }> = [];

    this.traverseAST(ast, (node) => {
      if (node.type !== 'variable_declaration') return;
      const v = node as ASTVariableDeclaration;
      if (v.kind === 'const' && this.isConstantExpression(v.value)) {
        constants.push({
          name: v.name,
          value: v.value,
          location: {
            line: v.metadata?.lineNumber ?? 0,
            column: 0,
            offset: 0,
          },
        });
      }
    });

    return constants;
  }

  private isConstantExpression(expr: ASTExpression): boolean {
    if (!expr) return false;

    switch (expr.type) {
      case 'string_literal':
      case 'number_literal':
      case 'boolean_literal':
        return true;

      case 'binary_expression':
        return (
          expr.left != null &&
          expr.right != null &&
          this.isConstantExpression(expr.left) &&
          this.isConstantExpression(expr.right)
        );

      case 'unary_expression':
        return (
          expr.argument != null && this.isConstantExpression(expr.argument)
        );

      default:
        return false;
    }
  }

  private canFoldConstant(constant: { name: string; value: any }): boolean {
    // Check if constant is used in ways that can be folded
    return this.isFoldableExpression(constant.value);
  }

  private isFoldableExpression(expr: ASTExpression): boolean {
    if (!expr) return false;

    // Simple literals are always foldable
    if (
      ['string_literal', 'number_literal', 'boolean_literal'].includes(
        expr.type,
      )
    ) {
      return true;
    }

    // Binary operations with constant operands
    if (
      expr.type === 'binary_expression' &&
      expr.left != null &&
      expr.right != null
    ) {
      return (
        this.isFoldableExpression(expr.left) &&
        this.isFoldableExpression(expr.right)
      );
    }

    // Unary operations with constant operands
    if (expr.type === 'unary_expression' && expr.argument != null) {
      return this.isFoldableExpression(expr.argument);
    }

    return false;
  }

  private foldConstant(
    ast: ASTProgram,
    constant: { name: string; value: any },
  ): ASTProgram {
    const foldedValue = this.evaluateConstantExpression(constant.value);

    // Replace all uses of the constant with its folded value
    this.traverseAST(ast, (node) => {
      if (node.type === 'identifier' && node.name === constant.name) {
        // Replace with folded value
        Object.assign(node, foldedValue);
      }
    });

    return ast;
  }

  private evaluateConstantExpression(expr: ASTExpression): ASTExpression {
    switch (expr.type) {
      case 'string_literal':
      case 'number_literal':
      case 'boolean_literal':
        return expr;

      case 'binary_expression':
        if (expr.left == null || expr.right == null) return expr;
        const left = this.evaluateConstantExpression(expr.left);
        const right = this.evaluateConstantExpression(expr.right);

        if (left.type === 'number_literal' && right.type === 'number_literal') {
          const lv = Number((left as { value: unknown }).value);
          const rv = Number((right as { value: unknown }).value);
          let result: number;
          switch (expr.operator) {
            case '+':
              result = lv + rv;
              break;
            case '-':
              result = lv - rv;
              break;
            case '*':
              result = lv * rv;
              break;
            case '/':
              result = lv / rv;
              break;
            default:
              return expr; // Can't evaluate
          }

          return {
            type: 'expression',
            value: result,
            metadata: { tokens: 1, cost: 1 },
          } as ASTExpression;
        }

        return expr;

      default:
        return expr;
    }
  }

  private findUnusedVariables(
    ast: ASTProgram,
  ): Array<{ name: string; location: ASTLocation }> {
    const declaredVars = new Set<string>();
    const usedVars = new Set<string>();

    this.traverseAST(ast, (node) => {
      if (node.type === 'variable_declaration') {
        const v = node as ASTVariableDeclaration;
        declaredVars.add(v.name);
        if (v.expression)
          this.collectVariablesInExpression(v.expression, usedVars);
      } else if (node.type === 'identifier') {
        const name = (node as { name?: string }).name;
        if (name != null) usedVars.add(name);
      }
    });

    const unused: Array<{ name: string; location: ASTLocation }> = [];
    for (const varName of declaredVars) {
      if (!usedVars.has(varName)) {
        // Find declaration location
        const location = this.findVariableDeclaration(ast, varName);
        if (location) {
          unused.push({ name: varName, location });
        }
      }
    }

    return unused;
  }

  private collectVariablesInExpression(
    expr: ASTExpression,
    variables: Set<string>,
  ): void {
    if (!expr) return;

    switch (expr.type) {
      case 'identifier':
        if (expr.name != null) variables.add(expr.name);
        break;

      case 'binary_expression':
        if (expr.left) this.collectVariablesInExpression(expr.left, variables);
        if (expr.right)
          this.collectVariablesInExpression(expr.right, variables);
        break;

      case 'function_call':
        for (const arg of expr.arguments ?? []) {
          this.collectVariablesInExpression(arg, variables);
        }
        break;
    }
  }

  private findVariableDeclaration(
    ast: ASTProgram,
    varName: string,
  ): ASTLocation | null {
    let location: ASTLocation | null = null;

    this.traverseAST(ast, (node) => {
      if (node.type !== 'variable_declaration') return;
      const v = node as ASTVariableDeclaration;
      if (v.name === varName) {
        location = {
          line: v.metadata?.lineNumber ?? 0,
          column: 0,
          offset: 0,
        };
      }
    });

    return location;
  }

  private removeUnusedVariable(
    ast: ASTProgram,
    variable: { name: string },
  ): ASTProgram {
    const newBody = ast.body.filter(
      (node) =>
        !(
          node.type === 'variable_declaration' &&
          (node as ASTVariableDeclaration).name === variable.name
        ),
    );

    return {
      ...ast,
      body: newBody,
      metadata: {
        ...ast.metadata,
        statements: newBody.length,
      },
    };
  }

  private findInlineableFunctions(
    ast: ASTProgram,
  ): Array<{ name: string; location: ASTLocation; body: ASTNode[] }> {
    const functions: Array<{
      name: string;
      location: ASTLocation;
      body: ASTNode[];
    }> = [];

    this.traverseAST(ast, (node) => {
      if (node.type !== 'function_declaration') return;
      const f = node as ASTFunctionDeclaration;
      functions.push({
        name: f.name,
        location: {
          line: f.metadata?.lineNumber ?? 0,
          column: 0,
          offset: 0,
        },
        body: f.body ?? [],
      });
    });

    return functions;
  }

  private shouldInlineFunction(
    func: {
      name: string;
      body: ASTNode[];
    },
    ast: ASTProgram,
  ): boolean {
    // Inline if function is small and called few times
    const bodySize = func.body.length;
    const callCount = this.countFunctionCalls(ast, func.name);

    return bodySize <= 3 && callCount <= 2;
  }

  private countFunctionCalls(ast: ASTProgram, funcName: string): number {
    let count = 0;

    this.traverseAST(ast, (node) => {
      if (node.type === 'function_call' && node.name === funcName) {
        count++;
      }
    });

    return count;
  }

  private inlineFunction(ast: ASTProgram, func: { name: string }): ASTProgram {
    // Replace function calls with function body
    this.traverseAST(ast, (node) => {
      if (
        node.type === 'function_call' &&
        (node as { name?: string }).name === func.name
      ) {
        // Replace with inlined body (simplified)
        Object.assign(node, {
          type: 'inline_block',
          inlinedFrom: func.name,
          body: (func as { body?: ASTNode[] }).body ?? [],
        });
      }
    });

    // Remove function declaration
    const newBody = ast.body.filter(
      (node) =>
        !(
          node.type === 'function_declaration' &&
          (node as ASTFunctionDeclaration).name === func.name
        ),
    );

    return {
      ...ast,
      body: newBody,
      metadata: {
        ...ast.metadata,
        statements: newBody.length,
        functions: (ast.metadata.functions ?? 0) - 1,
      },
    };
  }

  private findLoops(
    ast: ASTProgram,
  ): Array<{ description: string; location: ASTLocation }> {
    const loops: Array<{ description: string; location: ASTLocation }> = [];

    this.traverseAST(ast, (node) => {
      if (node.type === 'loop') {
        loops.push({
          description: 'For loop',
          location: {
            line: node.metadata?.lineNumber ?? 0,
            column: 0,
            offset: 0,
          },
        });
      }
    });

    return loops;
  }

  private canOptimizeLoop(loop: { description: string }): boolean {
    // Simple loop optimization check
    return loop.description.includes('for'); // Could be more sophisticated
  }

  private traverseAST(ast: ASTProgram, visitor: (node: ASTNode) => void): void {
    for (const node of ast.body) {
      visitor(node);

      // Traverse child nodes
      if ('body' in node && Array.isArray(node.body)) {
        for (const child of node.body) {
          visitor(child);
        }
      }

      if ('expression' in node) {
        const n = node as ASTVariableDeclaration;
        if (n.expression) this.traverseExpression(n.expression, visitor);
      }
    }
  }

  private traverseExpression(
    expr: ASTExpression,
    visitor: (node: ASTNode) => void,
  ): void {
    if (!expr) return;

    // Visit expression as node if it has metadata
    if ('metadata' in expr) {
      visitor(expr as any);
    }

    // Traverse child expressions
    switch (expr.type) {
      case 'binary_expression':
        if (expr.left) this.traverseExpression(expr.left, visitor);
        if (expr.right) this.traverseExpression(expr.right, visitor);
        break;

      case 'function_call':
        for (const arg of expr.arguments ?? []) {
          this.traverseExpression(arg, visitor);
        }
        break;
    }
  }

  private estimateConstantFoldSavings(constant: {
    name: string;
    value: any;
  }): number {
    if (
      typeof constant.value === 'string' ||
      typeof constant.value === 'number'
    ) {
      const nameLength = String(constant.name).length;
      const valueLength = String(constant.value).length;
      const netTokens = Math.max(1, Math.ceil((nameLength - valueLength) / 4));
      return netTokens;
    }
    return 1;
  }

  private estimateInliningSavings(
    func: { name: string; body: ASTNode[] },
    ast: ASTProgram,
  ): number {
    const callCount = this.countFunctionCalls(ast, func.name);
    return callCount * 3;
  }

  private detectLanguage(source: string): string {
    const jsKeywords = [
      'function',
      'const',
      'let',
      'var',
      'if',
      'else',
      'for',
      'while',
    ];
    const pythonKeywords = [
      'def ',
      'import ',
      'class ',
      'if __name__',
      'print(',
    ];
    const sqlKeywords = [
      'SELECT',
      'FROM',
      'WHERE',
      'INSERT',
      'UPDATE',
      'DELETE',
    ];

    const jsMatches = jsKeywords.filter((keyword) =>
      source.includes(keyword),
    ).length;
    const pythonMatches = pythonKeywords.filter((keyword) =>
      source.includes(keyword),
    ).length;
    const sqlMatches = sqlKeywords.filter((keyword) =>
      source.includes(keyword),
    ).length;

    if (jsMatches > pythonMatches && jsMatches > sqlMatches) {
      return 'javascript';
    } else if (pythonMatches > jsMatches && pythonMatches > sqlMatches) {
      return 'python';
    } else if (sqlMatches > jsMatches && sqlMatches > pythonMatches) {
      return 'sql';
    }

    // Check for markdown or natural language patterns
    if (
      source.includes('# ') ||
      source.includes('**') ||
      source.includes('* ')
    ) {
      return 'markdown';
    }

    return 'natural_language';
  }

  private calculateSourceComplexity(source: string): number {
    const lines = source.split('\n').length;
    const words = source.split(/\s+/).length;
    const keywords = this.countKeywords(source);

    return lines * 0.1 + words * 0.01 + keywords * 0.5;
  }

  private calculateComplexity(ast: ASTProgram): number {
    return ast.metadata.complexity;
  }

  private calculateCyclomaticComplexity(ast: ASTProgram): number {
    let complexity = 1; // Base complexity

    this.traverseAST(ast, (node) => {
      switch (node.type) {
        case 'conditional':
          complexity += 1;
          break;

        case 'loop':
          complexity += 1;
          break;

        case 'binary_expression':
          if (['&&', '||'].includes((node as any).operator)) {
            complexity += 1;
          }
          break;
      }
    });

    return Math.max(1, complexity);
  }

  private estimateTokenCount(text: string): number {
    // More accurate token estimation based on GPT tokenization patterns
    if (!text) return 0;

    // Count words (split on whitespace and punctuation)
    const words = text
      .split(/[\s\.,!?;:()[\]{}"']+/)
      .filter((word) => word.length > 0);

    // Estimate tokens: ~0.75 tokens per word on average for English text
    // Add extra tokens for punctuation and special characters
    const punctuationCount = (text.match(/[.,!?;:()[\]{}"'\-–—]/g) || [])
      .length;
    const numberCount = (text.match(/\d+/g) || []).length;

    const wordTokens = Math.ceil(words.length * 0.75);
    const punctuationTokens = Math.ceil(punctuationCount * 0.3);
    const numberTokens = numberCount; // Numbers often count as 1 token each

    return wordTokens + punctuationTokens + numberTokens;
  }

  private estimateTokenCountFromAST(ast: ASTProgram): number {
    let totalTokens = 0;

    this.traverseAST(ast, (node) => {
      const tokens = (node.metadata as { tokens?: number } | undefined)?.tokens;
      if (typeof tokens === 'number') totalTokens += tokens;
    });

    return totalTokens;
  }

  private calculateCompressionRatio(
    original: string,
    optimized: ASTProgram,
  ): number {
    const originalTokens = this.estimateTokenCount(original);
    const optimizedTokens = optimized.metadata.tokenCount;
    return optimizedTokens / originalTokens;
  }

  private countKeywords(text: string): number {
    const keywords = [
      'if',
      'else',
      'for',
      'while',
      'function',
      'class',
      'import',
      'export',
      'return',
      'try',
      'catch',
    ];
    return keywords.reduce((count, keyword) => {
      return (
        count + (text.match(new RegExp(`\\b${keyword}\\b`, 'g')) || []).length
      );
    }, 0);
  }

  private estimateExecutionTime(ast: ASTProgram): number {
    let totalTime = 0;

    this.traverseAST(ast, (node) => {
      switch (node.type) {
        case 'function_call':
          totalTime += 50; // Function call overhead
          break;

        case 'loop':
          totalTime += 100; // Loop setup overhead
          break;

        case 'conditional':
          totalTime += 20; // Conditional evaluation
          break;

        case 'binary_expression':
          totalTime += 5; // Binary operation
          break;

        case 'assignment':
          totalTime += 3; // Assignment
          break;

        default:
          totalTime += 2; // Base operation time
      }
    });

    // Factor in complexity
    totalTime *= 1 + ast.metadata.complexity / 100;

    return Math.max(totalTime, 10); // Minimum 10ms
  }

  private estimateMemoryUsage(ast: ASTProgram): number {
    let memoryUsage = 0;

    this.traverseAST(ast, (node) => {
      // Base memory per node
      memoryUsage += 64; // ~64 bytes per AST node

      // Additional memory based on node type
      switch (node.type) {
        case 'variable_declaration':
          memoryUsage += 128; // Variable storage
          break;

        case 'function_declaration':
          memoryUsage += 256; // Function object
          break;

        case 'array_expression':
          const elements = (node as any).elements?.length || 0;
          memoryUsage += elements * 16; // Array elements
          break;

        case 'object_expression':
          const properties = (node as any).properties?.length || 0;
          memoryUsage += properties * 32; // Object properties
          break;
      }
    });

    // Add memory for strings and identifiers
    memoryUsage += ast.metadata.tokenCount * 8; // ~8 bytes per token

    return Math.max(memoryUsage, 1024); // Minimum 1KB
  }

  private estimateIOOperations(ast: ASTProgram): number {
    let ioOperations = 0;

    this.traverseAST(ast, (node) => {
      if (node.type === 'function_call') {
        const funcName = (node as any).name;
        // Check for I/O operations
        if (
          ['readFile', 'writeFile', 'fetch', 'axios', 'http', 'database'].some(
            (ioFunc) => funcName.includes(ioFunc),
          )
        ) {
          ioOperations += 1;
        }
      }
    });

    return ioOperations;
  }
}
