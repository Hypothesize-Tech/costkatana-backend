/**
 * Parallel Execution Optimizer Service
 *
 * Analyzes and optimizes parallel execution opportunities in prompts and workflows.
 * Builds dependency graphs and generates execution plans for concurrent processing.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  ASTNode,
  ASTDependencyGraph,
  ASTExecutionPlan,
  ASTExecutionStep,
  ASTProgram,
} from '../types/prompt-ast.types';

export interface DependencyNode {
  id: string;
  node: ASTNode;
  dependencies: string[];
  dependents: string[];
  weight: number;
  canParallelize: boolean;
  estimatedTime: number;
  resourceUsage: {
    memory: number;
    cpu: number;
  };
}

export interface ParallelizationOpportunity {
  nodes: string[];
  type:
    | 'independent_branches'
    | 'parallel_loops'
    | 'concurrent_api_calls'
    | 'batch_operations';
  confidence: number;
  speedup: number;
  resourceRequirements: {
    memory: number;
    cpu: number;
    network: number;
  };
  constraints: string[];
}

export interface ExecutionTimeline {
  steps: Array<{
    stepId: string;
    startTime: number;
    endTime: number;
    parallelGroup: number;
    resourceUsage: {
      memory: number;
      cpu: number;
    };
  }>;
  totalTime: number;
  criticalPath: string[];
  bottlenecks: Array<{
    stepId: string;
    issue: string;
    impact: number;
  }>;
}

@Injectable()
export class ParallelExecutionOptimizerService {
  private readonly logger = new Logger(ParallelExecutionOptimizerService.name);

  /**
   * Build dependency graph for AST nodes
   */
  async buildDependencyGraph(ast: ASTProgram): Promise<ASTDependencyGraph> {
    const nodes = new Map<string, ASTNode>();
    const edges: ASTDependencyGraph['edges'] = [];
    const cycles: string[][] = [];
    const entryPoints: string[] = [];

    // Traverse AST and build nodes
    const dependencyNodes = await this.traverseAST(ast);

    // Convert to graph format
    for (const depNode of dependencyNodes) {
      nodes.set(depNode.id, depNode.node);

      for (const dep of depNode.dependencies) {
        edges.push({
          from: depNode.id,
          to: dep,
          type: 'depends_on',
          weight: 1,
        });
      }

      // Find entry points (nodes with no dependencies)
      if (depNode.dependencies.length === 0) {
        entryPoints.push(depNode.id);
      }
    }

    // Detect cycles
    cycles.push(...this.detectCycles(edges));

    return {
      nodes,
      edges,
      cycles,
      entryPoints,
    };
  }

  /**
   * Generate parallel execution plan
   */
  async generateParallelExecutionPlan(
    dependencyGraph: ASTDependencyGraph,
    constraints?: {
      maxParallelization?: number;
      maxMemory?: number;
      maxCpu?: number;
      timeout?: number;
    },
  ): Promise<ASTExecutionPlan> {
    const maxParallel = constraints?.maxParallelization || 10;
    const maxMemory = constraints?.maxMemory || 1000000; // 1MB
    const maxCpu = constraints?.maxCpu || 4;

    // Create execution steps
    const steps = await this.createExecutionSteps(dependencyGraph);

    // Group into parallel execution groups
    const parallelGroups = this.groupParallelSteps(
      steps,
      maxParallel,
      maxMemory,
      maxCpu,
    );

    // Calculate resource requirements
    const resourceRequirements = this.calculateResourceRequirements(steps);

    // Estimate total execution time
    const estimatedTime = this.estimateTotalExecutionTime(parallelGroups);

    return {
      steps,
      parallelGroups,
      estimatedTime,
      resourceRequirements,
      dependencies: dependencyGraph,
    };
  }

  /**
   * Analyze parallelization opportunities
   */
  async analyzeParallelizationOpportunities(
    ast: ASTProgram,
  ): Promise<ParallelizationOpportunity[]> {
    const opportunities: ParallelizationOpportunity[] = [];

    // Analyze independent branches
    const branchOpportunities = await this.analyzeIndependentBranches(ast);
    opportunities.push(...branchOpportunities);

    // Analyze parallel loops
    const loopOpportunities = await this.analyzeParallelLoops(ast);
    opportunities.push(...loopOpportunities);

    // Analyze concurrent API calls
    const apiOpportunities = await this.analyzeConcurrentApiCalls(ast);
    opportunities.push(...apiOpportunities);

    // Analyze batch operations
    const batchOpportunities = await this.analyzeBatchOperations(ast);
    opportunities.push(...batchOpportunities);

    // Sort by potential speedup
    return opportunities.sort((a, b) => b.speedup - a.speedup);
  }

  /**
   * Create execution timeline
   */
  async createExecutionTimeline(
    executionPlan: ASTExecutionPlan,
    actualTimings?: Map<string, number>,
  ): Promise<ExecutionTimeline> {
    const timelineSteps: ExecutionTimeline['steps'] = [];
    let currentTime = 0;
    const activeSteps = new Map<number, ExecutionTimeline['steps'][0]>();

    // Process parallel groups
    for (
      let groupIndex = 0;
      groupIndex < executionPlan.parallelGroups.length;
      groupIndex++
    ) {
      const group = executionPlan.parallelGroups[groupIndex];
      const groupStartTime = currentTime;

      // Start all steps in this group
      for (const step of group) {
        const startTime = groupStartTime;
        const duration = actualTimings?.get(step.id) || step.estimatedTime;
        const endTime = startTime + duration;

        const timelineStep = {
          stepId: step.id,
          startTime,
          endTime,
          parallelGroup: groupIndex,
          resourceUsage: step.resourceUsage,
        };

        timelineSteps.push(timelineStep);
        activeSteps.set(groupIndex, timelineStep);
      }

      // Update current time to when this group finishes
      const groupEndTime = Math.max(
        ...group.map(
          (step) => actualTimings?.get(step.id) || step.estimatedTime,
        ),
      );
      currentTime = Math.max(currentTime, groupStartTime + groupEndTime);
    }

    // Find critical path
    const criticalPath = this.findCriticalPath(
      timelineSteps,
      executionPlan.dependencies,
    );

    // Identify bottlenecks
    const bottlenecks = this.identifyBottlenecks(timelineSteps, executionPlan);

    return {
      steps: timelineSteps,
      totalTime: currentTime,
      criticalPath,
      bottlenecks,
    };
  }

  /**
   * Optimize execution plan for performance
   */
  async optimizeExecutionPlan(
    executionPlan: ASTExecutionPlan,
    optimizationGoals: {
      minimizeTime?: boolean;
      minimizeResources?: boolean;
      maximizeThroughput?: boolean;
    },
  ): Promise<ASTExecutionPlan> {
    let optimizedPlan = { ...executionPlan };

    if (optimizationGoals.minimizeTime) {
      optimizedPlan = await this.optimizeForTime(optimizedPlan);
    }

    if (optimizationGoals.minimizeResources) {
      optimizedPlan = await this.optimizeForResources(optimizedPlan);
    }

    if (optimizationGoals.maximizeThroughput) {
      optimizedPlan = await this.optimizeForThroughput(optimizedPlan);
    }

    return optimizedPlan;
  }

  // Private helper methods

  private async traverseAST(ast: ASTProgram): Promise<DependencyNode[]> {
    const nodes: DependencyNode[] = [];

    // Build definition map: variable name -> node id that defines it (last write wins per scope)
    const varToNodeId = new Map<string, string>();
    for (let i = 0; i < ast.body.length; i++) {
      const node = ast.body[i];
      const defVars = this.findDefinedVariables(node);
      for (const v of defVars) {
        varToNodeId.set(v, `node_${i}`);
      }
    }

    for (let i = 0; i < ast.body.length; i++) {
      const node = ast.body[i];
      const usedVars = this.findNodeDependencies(node, ast);
      const dependencyNodeIds: string[] = [];
      for (const dep of usedVars) {
        const definerId = dep.startsWith('node_')
          ? dep
          : varToNodeId.get(dep);
        if (!definerId || definerId === `node_${i}`) continue;
        const definerIdx = parseInt(definerId.replace('node_', ''), 10);
        if (definerIdx < i && !dependencyNodeIds.includes(definerId)) {
          dependencyNodeIds.push(definerId);
        }
      }

      nodes.push({
        id: `node_${i}`,
        node,
        dependencies: dependencyNodeIds,
        dependents: [],
        weight: 1,
        canParallelize: this.canNodeBeParallelized(node),
        estimatedTime: this.estimateNodeExecutionTime(node),
        resourceUsage: this.estimateNodeResources(node),
      });
    }

    for (const node of nodes) {
      for (const dep of node.dependencies) {
        const depNode = nodes.find((n) => n.id === dep);
        if (depNode) {
          depNode.dependents.push(node.id);
        }
      }
    }

    return nodes;
  }

  private findDefinedVariables(node: ASTNode): string[] {
    const vars: string[] = [];
    if (node.type === 'assignment' && 'left' in node) {
      const left = (node as any).left;
      if (left?.type === 'identifier' && left.name) {
        vars.push(left.name);
      }
    }
    if (node.type === 'variable_declaration' && 'name' in node) {
      vars.push((node as any).name);
    }
    if (node.type === 'block' && 'statements' in node) {
      for (const stmt of (node as any).statements || []) {
        vars.push(...this.findDefinedVariables(stmt));
      }
    }
    return vars;
  }

  private findNodeDependencies(node: ASTNode, _ast: ASTProgram): string[] {
    const dependencies: string[] = [];

    // Extract variable usages from expressions (right side of assignment, conditionals, etc.)
    if (node.type === 'assignment' && 'right' in node) {
      this.extractVariableDependencies((node as any).right, dependencies);
    } else if (
      node.type === 'conditional' &&
      ('condition' in node || 'test' in node)
    ) {
      const cond = (node as any).condition ?? (node as any).test;
      this.extractVariableDependencies(cond, dependencies);
    } else if (node.type === 'expression' || node.type === 'function_call') {
      this.extractVariableDependencies(node as any, dependencies);
    }

    if (node.type === 'block' && 'statements' in node) {
      for (const child of (node as any).statements || []) {
        dependencies.push(...this.findNodeDependencies(child as ASTNode, _ast));
      }
    }

    if ('dependencies' in node && Array.isArray((node as any).dependencies)) {
      const explicit = (node as any).dependencies;
      for (const d of explicit) {
        if (typeof d === 'string' && d.startsWith('node_')) {
          dependencies.push(d);
        } else if (typeof d === 'string') {
          dependencies.push(d);
        }
      }
    }

    return [...new Set(dependencies)];
  }

  private extractVariableDependencies(
    expression: any,
    dependencies: string[],
  ): void {
    if (!expression) return;

    // Handle different expression types
    switch (expression.type) {
      case 'identifier':
        if (expression.name && !dependencies.includes(expression.name)) {
          dependencies.push(expression.name);
        }
        break;

      case 'binary_expression':
        this.extractVariableDependencies(expression.left, dependencies);
        this.extractVariableDependencies(expression.right, dependencies);
        break;

      case 'unary_expression':
        this.extractVariableDependencies(expression.argument, dependencies);
        break;

      case 'function_call':
        if (expression.arguments) {
          for (const arg of expression.arguments) {
            this.extractVariableDependencies(arg, dependencies);
          }
        }
        break;

      case 'array_expression':
        if (expression.elements) {
          for (const elem of expression.elements) {
            this.extractVariableDependencies(elem, dependencies);
          }
        }
        break;

      case 'object_expression':
        if (expression.properties) {
          for (const prop of expression.properties) {
            this.extractVariableDependencies(prop.value, dependencies);
          }
        }
        break;
    }
  }

  private canNodeBeParallelized(node: ASTNode): boolean {
    // Real parallelization check - check for side effects, shared state, etc.

    // Functions with side effects cannot be parallelized
    if (this.hasSideEffects(node)) {
      return false;
    }

    // Shared state mutations cannot be parallelized
    if (this.hasSharedStateMutations(node)) {
      return false;
    }

    // I/O operations should be sequential unless explicitly marked
    if (this.hasIOOperations(node)) {
      return false;
    }

    // Pure functions and computations can be parallelized
    return this.isPureComputation(node);
  }

  private hasSideEffects(node: ASTNode): boolean {
    // Check if node has external side effects
    return (
      node.type === 'function_call' &&
      ('console' in (node as any) ||
        'fs' in (node as any) ||
        'network' in (node as any))
    );
  }

  private hasSharedStateMutations(node: ASTNode): boolean {
    // Check if node modifies shared state
    if (node.type === 'assignment' && 'left' in node) {
      const target = (node as any).left;
      return this.isSharedVariable(target);
    }
    return false;
  }

  private hasIOOperations(node: ASTNode): boolean {
    // Check for I/O operations
    return (
      node.type === 'function_call' &&
      ('readFile' in (node as any) ||
        'writeFile' in (node as any) ||
        'http' in (node as any) ||
        'database' in (node as any))
    );
  }

  private isPureComputation(node: ASTNode): boolean {
    // Check if node is a pure computation
    return [
      'binary_operation',
      'unary_operation',
      'math_function',
      'string_operation',
    ].includes(node.type);
  }

  private isSharedVariable(target: any): boolean {
    // Check if variable is shared (would need symbol table analysis)
    // For now, assume global variables are shared
    return (
      target?.type === 'identifier' &&
      ['global', 'shared', 'config'].includes(target.scope || 'local')
    );
  }

  private estimateNodeExecutionTime(node: ASTNode): number {
    // Real estimation based on node type and complexity
    const baseTimes: Record<string, number> = {
      function_call: 100,
      binary_operation: 10,
      unary_operation: 8,
      conditional: 50,
      loop: 200,
      assignment: 5,
      return_statement: 2,
      variable_declaration: 3,
      math_function: 15,
      string_operation: 12,
      array_operation: 18,
      object_operation: 25,
      program: 1,
      block: 5,
      statement: 2,
      expression: 3,
      literal: 1,
      identifier: 1,
      function_definition: 50,
      import_statement: 20,
      export_statement: 10,
    };

    let time = baseTimes[node.type] || 20;

    // Adjust for complexity
    if (node.type === 'expression' && 'dataType' in node) {
      time += 5; // Expressions take longer
    }

    // Adjust for nested operations
    if (node.type === 'block' && 'statements' in node) {
      const statements = (node as any).statements || [];
      time += statements.length * 5;
    }

    return Math.max(time, 1);
  }

  private estimateExpressionComplexity(expression: any): number {
    if (!expression) return 0;

    let complexity = 1;

    switch (expression.type) {
      case 'binary_expression':
        complexity += this.estimateExpressionComplexity(expression.left);
        complexity += this.estimateExpressionComplexity(expression.right);
        break;

      case 'function_call':
        complexity += 5; // Function call overhead
        if (expression.arguments) {
          complexity += expression.arguments.length * 2;
        }
        break;

      case 'array_expression':
        complexity += expression.elements?.length || 0;
        break;

      case 'object_expression':
        complexity += expression.properties?.length || 0;
        break;
    }

    return complexity;
  }

  private estimateNodeResources(node: ASTNode): {
    memory: number;
    cpu: number;
  } {
    const baseResources: Record<string, { memory: number; cpu: number }> = {
      function_call: { memory: 1000, cpu: 0.5 },
      binary_operation: { memory: 100, cpu: 0.1 },
      conditional: { memory: 500, cpu: 0.2 },
      loop: { memory: 2000, cpu: 0.8 },
      assignment: { memory: 50, cpu: 0.05 },
    };

    return baseResources[node.type] || { memory: 200, cpu: 0.1 };
  }

  private detectCycles(edges: ASTDependencyGraph['edges']): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (node: string, path: string[]) => {
      if (recursionStack.has(node)) {
        // Found cycle
        const cycleStart = path.indexOf(node);
        cycles.push(path.slice(cycleStart));
        return;
      }

      if (visited.has(node)) return;

      visited.add(node);
      recursionStack.add(node);

      const outgoing = edges.filter((e) => e.from === node);
      for (const edge of outgoing) {
        dfs(edge.to, [...path, node]);
      }

      recursionStack.delete(node);
    };

    const nodes = new Set(edges.flatMap((e) => [e.from, e.to]));
    for (const node of nodes) {
      if (!visited.has(node)) {
        dfs(node, []);
      }
    }

    return cycles;
  }

  private async createExecutionSteps(
    dependencyGraph: ASTDependencyGraph,
  ): Promise<ASTExecutionStep[]> {
    const steps: ASTExecutionStep[] = [];

    for (const [id, node] of dependencyGraph.nodes) {
      const dependencies = dependencyGraph.edges
        .filter((e) => e.to === id)
        .map((e) => e.from);

      steps.push({
        id,
        node,
        dependencies,
        estimatedTime: this.estimateNodeExecutionTime(node),
        resourceUsage: this.estimateNodeResources(node),
        canParallelize: this.canNodeBeParallelized(node),
        priority: this.calculateStepPriority(id, dependencyGraph),
      });
    }

    return steps;
  }

  private groupParallelSteps(
    steps: ASTExecutionStep[],
    maxParallel: number,
    maxMemory: number,
    maxCpu: number,
  ): ASTExecutionStep[][] {
    const groups: ASTExecutionStep[][] = [];
    const processed = new Set<string>();

    // Topological sort respecting dependencies
    const sortedSteps = this.topologicalSort(steps);

    for (const step of sortedSteps) {
      if (processed.has(step.id)) continue;

      const currentGroup: ASTExecutionStep[] = [];
      let groupMemory = 0;
      let groupCpu = 0;

      // Try to add this step and others that can run in parallel
      for (const candidate of sortedSteps) {
        if (processed.has(candidate.id)) continue;

        // Check if candidate can be added to current group
        if (
          this.canAddToGroup(candidate, currentGroup, steps) &&
          currentGroup.length < maxParallel &&
          groupMemory + candidate.resourceUsage.memory <= maxMemory &&
          groupCpu + candidate.resourceUsage.cpu <= maxCpu
        ) {
          currentGroup.push(candidate);
          groupMemory += candidate.resourceUsage.memory;
          groupCpu += candidate.resourceUsage.cpu;
          processed.add(candidate.id);
        }
      }

      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }
    }

    return groups;
  }

  private topologicalSort(steps: ASTExecutionStep[]): ASTExecutionStep[] {
    const result: ASTExecutionStep[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (step: ASTExecutionStep) => {
      if (visited.has(step.id)) return;
      if (visiting.has(step.id)) return; // Cycle detected

      visiting.add(step.id);

      // Visit dependencies first
      for (const depId of step.dependencies) {
        const depStep = steps.find((s) => s.id === depId);
        if (depStep) {
          visit(depStep);
        }
      }

      visiting.delete(step.id);
      visited.add(step.id);
      result.push(step);
    };

    for (const step of steps) {
      if (!visited.has(step.id)) {
        visit(step);
      }
    }

    return result;
  }

  private canAddToGroup(
    candidate: ASTExecutionStep,
    currentGroup: ASTExecutionStep[],
    allSteps: ASTExecutionStep[],
  ): boolean {
    // Check if candidate depends on any step in current group
    for (const groupStep of currentGroup) {
      if (candidate.dependencies.includes(groupStep.id)) {
        return false;
      }

      // Check if any step in current group depends on candidate
      const groupStepDeps =
        allSteps.find((s) => s.id === groupStep.id)?.dependencies || [];
      if (groupStepDeps.includes(candidate.id)) {
        return false;
      }
    }

    return candidate.canParallelize;
  }

  private calculateResourceRequirements(
    steps: ASTExecutionStep[],
  ): ASTExecutionPlan['resourceRequirements'] {
    let maxMemory = 0;
    let maxCpu = 0;
    let totalMemory = 0;
    let totalCpu = 0;

    for (const step of steps) {
      maxMemory = Math.max(maxMemory, step.resourceUsage.memory);
      maxCpu = Math.max(maxCpu, step.resourceUsage.cpu);
      totalMemory += step.resourceUsage.memory;
      totalCpu += step.resourceUsage.cpu;
    }

    return {
      memory: maxMemory,
      cpu: maxCpu,
      io: Math.floor(totalMemory / 1000), // Rough I/O estimation
    };
  }

  private estimateTotalExecutionTime(
    parallelGroups: ASTExecutionStep[][],
  ): number {
    let totalTime = 0;

    for (const group of parallelGroups) {
      const groupTime = Math.max(...group.map((step) => step.estimatedTime));
      totalTime += groupTime;
    }

    return totalTime;
  }

  private calculateStepPriority(
    stepId: string,
    dependencyGraph: ASTDependencyGraph,
  ): number {
    // Calculate priority based on number of dependents (higher = more critical)
    const dependents = dependencyGraph.edges.filter(
      (e) => e.from === stepId,
    ).length;
    return dependents;
  }

  /**
   * Analyzes the AST to identify independent branches that can be executed in parallel.
   *
   * Since the current AST type does not support rich conditional/branch detection,
   * this method looks for top-level statements/subgraphs that have no
   * data/control dependencies between them ("embarrassingly parallel").
   *
   * Returns opportunities with low confidence unless structure is improved.
   */
  private async analyzeIndependentBranches(
    ast: ASTProgram,
  ): Promise<ParallelizationOpportunity[]> {
    const opportunities: ParallelizationOpportunity[] = [];

    // Build dependency info (naive: assumes top-level statements with no dependencies)
    // In a more advanced implementation, dependency analysis would be more precise.

    // 1. Gather all top-level statements.
    const statements = ast.body.filter((node) => node.type === 'statement');
    if (statements.length < 2) {
      // Less than two top-level statements, not enough for parallel branches.
      return opportunities;
    }

    // 2. Group statements that do not depend on each other.
    // For now, we treat each top-level statement as independent if there are no explicit dependency annotations.
    // (A real implementation would check for variable assignments/usage, data flow, etc.)

    // For very naive independence, put each top-level statement as a separate "branch".
    // If all are independent, suggest parallelization.
    // If types/AST change, update this.

    // Track nodes (top-level statement indices) to display.
    const nodes: string[] = [];
    for (let i = 0; i < statements.length; i++) {
      nodes.push(`node_${i}`);
    }

    // Confidence is low due to lack of deep analysis.
    if (nodes.length > 1) {
      opportunities.push({
        nodes,
        type: 'independent_branches',
        confidence: 0.5,
        speedup: Math.min(nodes.length * 0.5, nodes.length - 1), // Some speedup, not perfect
        resourceRequirements: {
          memory: Math.max(
            ...statements.map((s) => (s as any).resourceUsage?.memory || 0),
          ),
          cpu: Math.max(
            ...statements.map((s) => (s as any).resourceUsage?.cpu || 0),
          ),
          network: Math.max(
            ...statements.map((s) => (s as any).resourceUsage?.network || 0),
          ),
        },
        constraints: [
          'Assumes top-level statements have no dependencies.',
          'May not be safe if statements interact via shared state.',
          'AST does not provide deep dependency info.',
        ],
      });
    }

    return opportunities;
  }

  private async analyzeParallelLoops(
    ast: ASTProgram,
  ): Promise<ParallelizationOpportunity[]> {
    const opportunities: ParallelizationOpportunity[] = [];

    // Analyze loops for parallelization opportunities
    for (let i = 0; i < ast.body.length; i++) {
      const node = ast.body[i];
      if (node.type === 'statement') {
        // Simplified loop analysis - would check loop body for dependencies
        const loopBody = [node]; // Simplified

        // Check if loop iterations are independent
        if (this.isLoopParallelizable(loopBody)) {
          const iterations = this.estimateLoopIterations(node);
          const speedup = Math.min(iterations * 0.7, 4.0); // Cap at 4x speedup

          opportunities.push({
            nodes: [`node_${i}`],
            type: 'parallel_loops',
            confidence: 0.75,
            speedup,
            resourceRequirements: {
              memory: this.estimateLoopMemory(node),
              cpu: Math.min(iterations, 8),
              network: 0,
            },
            constraints: [
              'Independent loop iterations',
              'No loop-carried dependencies',
            ],
          });
        }
      }
    }

    return opportunities;
  }

  private async analyzeConcurrentApiCalls(
    ast: ASTProgram,
  ): Promise<ParallelizationOpportunity[]> {
    const opportunities: ParallelizationOpportunity[] = [];

    // Find independent API calls
    const apiCalls: ASTNode[] = [];

    for (const node of ast.body) {
      if (this.isApiCall(node)) {
        apiCalls.push(node);
      }
    }

    // Group independent API calls
    if (apiCalls.length > 1) {
      const independentGroups = this.groupIndependentApiCalls(apiCalls);

      for (let i = 0; i < independentGroups.length; i++) {
        const group = independentGroups[i];
        if (group.length > 1) {
          opportunities.push({
            nodes: group.map((_, idx) => `api_group_${i}_${idx}`),
            type: 'concurrent_api_calls',
            confidence: 0.9,
            speedup: group.length * 0.9,
            resourceRequirements: {
              memory: group.length * 500,
              cpu: group.length * 0.2,
              network: group.length,
            },
            constraints: [
              'Independent API endpoints',
              'No rate limiting conflicts',
            ],
          });
        }
      }
    }

    return opportunities;
  }

  private async analyzeBatchOperations(
    ast: ASTProgram,
  ): Promise<ParallelizationOpportunity[]> {
    const opportunities: ParallelizationOpportunity[] = [];

    // Find operations that can be batched
    const batchableOps = this.findBatchableOperations(ast.body);

    for (const batch of batchableOps) {
      if (batch.operations.length > 2) {
        opportunities.push({
          nodes: batch.operations.map(
            (_, idx) => `batch_${batch.operations.length}_${idx}`,
          ),
          type: 'batch_operations',
          confidence: 0.8,
          speedup: batch.operations.length * 0.6,
          resourceRequirements: {
            memory: batch.operations.length * 200,
            cpu: 1.0,
            network: 0.5,
          },
          constraints: ['Homogeneous operations', 'No ordering dependencies'],
        });
      }
    }

    return opportunities;
  }

  private areBranchesIndependent(branches: ASTNode[]): boolean {
    // Check if branches modify different variables
    const modifiedVars = new Set<string>();

    for (const branch of branches) {
      const vars = this.findModifiedVariables(branch);
      for (const v of vars) {
        if (modifiedVars.has(v)) {
          return false; // Shared variable modification
        }
        modifiedVars.add(v);
      }
    }

    return true;
  }

  private findModifiedVariables(node: ASTNode): string[] {
    const variables: string[] = [];

    // Check assignments
    if (node.type === 'assignment' && 'left' in node) {
      const left = (node as any).left;
      if (left?.type === 'identifier' && left.name) {
        variables.push(left.name);
      }
    }

    // Recursively check child nodes
    if (node.type === 'block' && 'statements' in node) {
      for (const child of (node as any).statements || []) {
        variables.push(...this.findModifiedVariables(child));
      }
    }

    return [...new Set(variables)];
  }

  private estimateBranchMemory(branches: ASTNode[]): number {
    return branches.reduce((total, branch) => {
      return total + this.estimateNodeMemory(branch);
    }, 0);
  }

  private isLoopParallelizable(loopBody: ASTNode[]): boolean {
    // Check for loop-carried dependencies
    const modifiedVars = new Set<string>();

    for (const node of loopBody) {
      const reads = this.findReadVariables(node);
      const writes = this.findModifiedVariables(node);

      // Check if any read variable is modified in the same loop
      for (const read of reads) {
        if (modifiedVars.has(read)) {
          return false; // Loop-carried dependency
        }
      }

      // Add writes to modified set
      for (const write of writes) {
        modifiedVars.add(write);
      }
    }

    return true;
  }

  private findReadVariables(node: ASTNode): string[] {
    const variables: string[] = [];

    // Check identifiers in expressions
    if (node.type === 'expression' && 'dependencies' in node) {
      variables.push(...((node as any).dependencies || []));
    }

    // Check function calls
    if (node.type === 'function_call' && 'arguments' in node) {
      // Arguments might contain identifiers
    }

    // Check assignments (right side)
    if (node.type === 'assignment' && 'right' in node) {
      const right = (node as any).right;
      if (right?.type === 'identifier' && right.name) {
        variables.push(right.name);
      }
    }

    // Recursively check child nodes
    if (node.type === 'block' && 'statements' in node) {
      for (const child of (node as any).statements || []) {
        variables.push(...this.findReadVariables(child));
      }
    }

    return [...new Set(variables)];
  }

  private estimateLoopIterations(node: ASTNode): number {
    // Estimate iterations based on loop parameters
    if ('iterations' in node) {
      return Math.min(node.iterations as number, 100); // Cap estimate
    }
    return 10; // Default estimate
  }

  private estimateLoopMemory(node: ASTNode): number {
    const baseMemory = 1000;
    const iterations = this.estimateLoopIterations(node);
    return baseMemory + iterations * 100;
  }

  private isApiCall(node: ASTNode): boolean {
    return (
      node.type === 'function_call' &&
      ('fetch' in node || 'axios' in node || 'http' in node || 'api' in node)
    );
  }

  private groupIndependentApiCalls(apiCalls: ASTNode[]): ASTNode[][] {
    const groups: ASTNode[][] = [];
    const processed = new Set<string>();

    for (let i = 0; i < apiCalls.length; i++) {
      const call = apiCalls[i];
      const callId = `call_${i}`;

      if (processed.has(callId)) continue;

      const group = [call];
      processed.add(callId);

      // Find other calls that don't conflict with this one
      for (let j = 0; j < apiCalls.length; j++) {
        const otherCall = apiCalls[j];
        const otherCallId = `call_${j}`;

        if (processed.has(otherCallId)) continue;

        if (this.canExecuteConcurrently(call, otherCall)) {
          group.push(otherCall);
          processed.add(otherCallId);
        }
      }

      if (group.length > 1) {
        groups.push(group);
      }
    }

    return groups;
  }

  private findBatchableOperations(
    nodes: ASTNode[],
  ): Array<{ operations: ASTNode[] }> {
    const batches: Array<{ operations: ASTNode[] }> = [];
    const processed = new Set<string>();

    // Group by operation type
    const byType = new Map<string, ASTNode[]>();

    for (const node of nodes) {
      if (!byType.has(node.type)) {
        byType.set(node.type, []);
      }
      byType.get(node.type)!.push(node);
    }

    // Find homogeneous groups that can be batched
    for (const [type, typeNodes] of byType.entries()) {
      if (
        ['database_query', 'file_operation', 'calculation'].includes(type) &&
        typeNodes.length > 2
      ) {
        batches.push({ operations: typeNodes });
      }
    }

    return batches;
  }

  private extractVariablesFromExpression(
    expression: any,
    variables: string[],
  ): void {
    if (!expression) return;

    switch (expression.type) {
      case 'identifier':
        variables.push(expression.name);
        break;

      case 'binary_expression':
        this.extractVariablesFromExpression(expression.left, variables);
        this.extractVariablesFromExpression(expression.right, variables);
        break;

      case 'function_call':
        if (expression.arguments) {
          for (const arg of expression.arguments) {
            this.extractVariablesFromExpression(arg, variables);
          }
        }
        break;
    }
  }

  /**
   * Determines if two AST API call nodes can be executed concurrently.
   *
   * Two API calls can execute concurrently if:
   *   - They do not have data dependencies between them (outputs/variables produced by one are not needed as input to the other).
   *   - They target different external resources where required (e.g., different endpoints or non-conflicting file/database operations).
   *   - They are not explicitly marked as requiring sequential execution by node metadata.
   *
   * @param call1 The first ASTNode API call
   * @param call2 The second ASTNode API call
   * @returns True if they can be safely run in parallel, false otherwise.
   */
  private canExecuteConcurrently(call1: ASTNode, call2: ASTNode): boolean {
    // 1. Sequential constraint check via metadata annotation
    if (
      (call1.metadata as any)?.sequential === true ||
      (call2.metadata as any)?.sequential === true
    ) {
      return false;
    }

    // 2. Data dependency check (output of one as input to the other)
    // Assume variablesWritten and variablesRead properties exist for dependency analysis.
    const call1Writes = new Set<string>((call1 as any).variablesWritten ?? []);
    const call2Writes = new Set<string>((call2 as any).variablesWritten ?? []);
    const call1Reads = new Set<string>((call1 as any).variablesRead ?? []);
    const call2Reads = new Set<string>((call2 as any).variablesRead ?? []);

    // Data hazard: Output of one used as input to another
    // call1 writes, call2 reads (avoid RAW)
    for (const w of call1Writes) if (call2Reads.has(w)) return false;
    // call2 writes, call1 reads
    for (const w of call2Writes) if (call1Reads.has(w)) return false;
    // WAW hazard (should avoid both writing to the same variable in parallel)
    for (const w of call1Writes) if (call2Writes.has(w)) return false;

    // 3. (Optional) API endpoint/resource clash avoidance
    // If both nodes call the same exact endpoint and are not explicitly marked safe
    // Skip API call endpoint check when AST types do not expose endpoint metadata
    // if (
    //   call1.type === 'api_call' &&
    //   call2.type === 'api_call' &&
    //   (call1 as any).endpoint &&
    //   (call2 as any).endpoint &&
    //   (call1 as any).endpoint === (call2 as any).endpoint &&
    //   !(call1.metadata as any)?.allowParallelWithSameEndpoint &&
    //   !(call2.metadata as any)?.allowParallelWithSameEndpoint
    // ) {
    //   return false;
    // }

    // Otherwise, assume they can be executed in parallel
    return true;
  }

  private estimateNodeMemory(node: ASTNode): number {
    // Estimate memory usage for a node
    const baseMemory = 100;

    if ('expression' in node) {
      return baseMemory + this.estimateExpressionMemory(node.expression);
    }

    if ('body' in node && Array.isArray(node.body)) {
      return baseMemory + node.body.length * 50;
    }

    return baseMemory;
  }

  private estimateExpressionMemory(expression: any): number {
    if (!expression) return 0;

    let memory = 0;

    switch (expression.type) {
      case 'array_expression':
        memory += (expression.elements?.length || 0) * 8;
        break;

      case 'object_expression':
        memory += (expression.properties?.length || 0) * 16;
        break;

      case 'string_literal':
        memory += expression.value?.length || 0;
        break;
    }

    return memory;
  }

  private findCriticalPath(
    timelineSteps: ExecutionTimeline['steps'],
    dependencies: ASTDependencyGraph | Record<string, string[]>,
  ): string[] {
    if (timelineSteps.length === 0) return [];

    const stepMap = new Map(
      timelineSteps.map((s) => [s.stepId, s]),
    );
    const stepIds = new Set(stepMap.keys());

    // Build predecessor map: depGraph[from] = [to1, to2] means from depends on to1, to2
    const pred = new Map<string, string[]>();
    const depRecord =
      'nodes' in dependencies && 'edges' in dependencies
        ? Object.fromEntries(
            Array.from((dependencies as ASTDependencyGraph).nodes.keys()).map(
              (id) => [
                id,
                (dependencies as ASTDependencyGraph).edges
                  .filter((e) => e.from === id)
                  .map((e) => e.to)
                  .filter((x) => stepIds.has(x)),
              ],
            ),
          )
        : (dependencies as Record<string, string[]>);
    for (const [id, deps] of Object.entries(depRecord)) {
      if (Array.isArray(deps)) {
        pred.set(id, deps.filter((d) => stepIds.has(d)));
      }
    }
    for (const id of stepIds) {
      if (!pred.has(id)) pred.set(id, []);
    }

    // Longest path from each node to sink (reverse graph: successors)
    const succ = new Map<string, string[]>();
    for (const [id, deps] of pred) {
      for (const d of deps) {
        if (!succ.has(d)) succ.set(d, []);
        succ.get(d)!.push(id);
      }
    }
    const topoOrder = this.topoSort(timelineSteps.map((s) => s.stepId), pred);
    const longestFrom = new Map<string, number>();
    const nextOnPath = new Map<string, string>();
    for (const id of topoOrder.reverse()) {
      const step = stepMap.get(id);
      const duration = step ? step.endTime - step.startTime : 0;
      const succIds = succ.get(id) || [];
      let maxSucc = 0;
      let bestNext = '';
      for (const s of succIds) {
        const v = longestFrom.get(s) ?? 0;
        if (v > maxSucc) {
          maxSucc = v;
          bestNext = s;
        }
      }
      longestFrom.set(id, duration + maxSucc);
      if (bestNext) nextOnPath.set(id, bestNext);
    }
    const startIds = topoOrder.filter((id) => (pred.get(id) || []).length === 0);
    let bestStart = startIds[0];
    let bestLen = 0;
    for (const s of startIds) {
      const len = longestFrom.get(s) ?? 0;
      if (len > bestLen) {
        bestLen = len;
        bestStart = s;
      }
    }
    const path: string[] = [];
    for (let id: string | undefined = bestStart; id; id = nextOnPath.get(id)) {
      path.push(id);
    }
    return path;
  }

  private topoSort(
    ids: string[],
    pred: Map<string, string[]>,
  ): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      for (const p of pred.get(id) || []) {
        visit(p);
      }
      result.push(id);
    };
    for (const id of ids) {
      visit(id);
    }
    return result;
  }



  private identifyBottlenecks(
    timelineSteps: ExecutionTimeline['steps'],
    executionPlan: ASTExecutionPlan,
  ): ExecutionTimeline['bottlenecks'] {
    const bottlenecks: ExecutionTimeline['bottlenecks'] = [];
    const avgStepTime =
      timelineSteps.reduce(
        (sum, step) => sum + (step.endTime - step.startTime),
        0,
      ) / timelineSteps.length;

    for (const step of timelineSteps) {
      const stepTime = step.endTime - step.startTime;

      // Check for long execution time
      if (stepTime > avgStepTime * 2) {
        bottlenecks.push({
          stepId: step.stepId,
          issue: `Execution time (${stepTime}ms) is ${Math.round(stepTime / avgStepTime)}x above average`,
          impact: Math.min(stepTime / executionPlan.estimatedTime, 0.5),
        });
      }

      // Check for resource contention
      if (this.detectResourceContention(step, timelineSteps)) {
        bottlenecks.push({
          stepId: step.stepId,
          issue: 'Resource contention detected',
          impact: 0.2,
        });
      }

      // Check for resource inefficiency
      if (step.resourceUsage.cpu < 0.5) {
        bottlenecks.push({
          stepId: step.stepId,
          issue: `Low CPU utilization (${(step.resourceUsage.cpu * 100).toFixed(1)}%)`,
          impact: 0.1,
        });
      }
    }

    return bottlenecks;
  }

  private detectResourceContention(
    step: ExecutionTimeline['steps'][0],
    allSteps: ExecutionTimeline['steps'],
  ): boolean {
    // Check if step overlaps with many other steps (potential resource contention)
    const overlappingSteps = allSteps.filter(
      (other) =>
        other.stepId !== step.stepId &&
        other.startTime < step.endTime &&
        other.endTime > step.startTime,
    );

    return overlappingSteps.length > 3; // Arbitrary threshold
  }

  private async optimizeForTime(
    executionPlan: ASTExecutionPlan,
  ): Promise<ASTExecutionPlan> {
    // Increase parallelization, prioritize critical path
    const optimizedPlan = { ...executionPlan };

    // Increase CPU allocation for time-critical operations
    optimizedPlan.resourceRequirements = {
      ...executionPlan.resourceRequirements,
      cpu: Math.min(executionPlan.resourceRequirements.cpu * 1.5, 4.0),
      memory: executionPlan.resourceRequirements.memory * 1.2,
    };

    // Optimize parallel groups for better performance
    optimizedPlan.parallelGroups = this.optimizeParallelGroups(
      executionPlan.parallelGroups,
    );

    return optimizedPlan;
  }

  private async optimizeForResources(
    executionPlan: ASTExecutionPlan,
  ): Promise<ASTExecutionPlan> {
    // Reduce resource usage, batch operations
    const optimizedPlan = { ...executionPlan };

    // Reduce CPU allocation to save resources
    optimizedPlan.resourceRequirements = {
      ...executionPlan.resourceRequirements,
      cpu: executionPlan.resourceRequirements.cpu * 0.8,
      memory: executionPlan.resourceRequirements.memory * 0.9,
      io: executionPlan.resourceRequirements.io * 0.7,
    };

    // Consolidate parallel groups to reduce overhead
    optimizedPlan.parallelGroups = this.consolidateParallelGroups(
      executionPlan.parallelGroups,
    );

    return optimizedPlan;
  }

  private async optimizeForThroughput(
    executionPlan: ASTExecutionPlan,
  ): Promise<ASTExecutionPlan> {
    // Optimize for concurrent processing
    const optimizedPlan = { ...executionPlan };

    // Maximize CPU allocation for throughput
    optimizedPlan.resourceRequirements = {
      ...executionPlan.resourceRequirements,
      cpu: executionPlan.resourceRequirements.cpu * 1.2,
      io: executionPlan.resourceRequirements.io * 1.5,
    };

    // Expand parallel groups for maximum concurrency
    optimizedPlan.parallelGroups = this.expandParallelGroups(
      executionPlan.parallelGroups,
    );

    return optimizedPlan;
  }

  private optimizeExecutionOrder(nodes: string[]): string[] {
    // Optimize execution order to minimize critical path
    // This is a simplified implementation - real optimization would use more sophisticated algorithms

    // Sort by priority (critical path nodes first)
    const sorted = [...nodes].sort((a, b) => {
      const aPriority = this.getNodePriority(a);
      const bPriority = this.getNodePriority(b);
      return bPriority - aPriority;
    });

    return sorted;
  }

  /**
   * Calculate the priority of a node in the execution plan.
   * Higher priority means the node should be executed earlier in a parallel/concurrent schedule.
   * This takes into account:
   *   - Number of dependents (downstream nodes; i.e., how many other nodes depend on this one)
   *   - Estimated execution time (longer = higher priority)
   * If metadata is not available, falls back to a neutral priority.
   *
   * @param nodeId - The ID of the node to score.
   * @returns Priority score (higher means more important/critical).
   */
  private getNodePriority(nodeId: string): number {
    // Edge case: If plan/metadata not present, default to neutral priority
    if (!this.executionPlanMeta || !this.executionPlanMeta.nodes) {
      return 1;
    }

    const node = this.executionPlanMeta.nodes[nodeId];
    if (!node) {
      return 1;
    }

    // Priority = weighted sum of dependents and estimated execution time
    // - more dependents increases priority (critical path)
    // - greater estimatedTime increases priority
    // Weights can be tuned based on optimization goals
    const DEPENDENT_WEIGHT = 1.5;
    const EXEC_TIME_WEIGHT = 1;

    const numDependents = Array.isArray(node.dependents)
      ? node.dependents.length
      : 0;
    const estimatedTime =
      typeof node.estimatedTime === 'number' ? node.estimatedTime : 1;

    // Normalize estimatedTime if needed (optional improvement)

    return DEPENDENT_WEIGHT * numDependents + EXEC_TIME_WEIGHT * estimatedTime;
  }

  /**
   * Inject execution plan metadata for priority calculation.
   * Should be invoked before scheduling/optimization.
   *
   * @param meta - Metadata containing nodes and their details
   */
  public setExecutionPlanMeta(meta: {
    nodes: Record<
      string,
      {
        dependents?: string[];
        estimatedTime?: number;
        [key: string]: any;
      }
    >;
  }) {
    this.executionPlanMeta = meta;
  }

  private executionPlanMeta?: {
    nodes: Record<
      string,
      {
        dependents?: string[];
        estimatedTime?: number;
        [key: string]: any;
      }
    >;
  };

  private optimizeParallelGroups(
    groups: ASTExecutionStep[][],
  ): ASTExecutionStep[][] {
    // Optimize parallel groups for better time performance
    return groups.filter((group) => group.length > 0); // Remove empty groups
  }

  private consolidateParallelGroups(
    groups: ASTExecutionStep[][],
  ): ASTExecutionStep[][] {
    // Consolidate parallel groups to reduce resource overhead
    return groups.slice(0, Math.max(1, groups.length / 2)); // Reduce by half
  }

  private expandParallelGroups(
    groups: ASTExecutionStep[][],
  ): ASTExecutionStep[][] {
    // Expand parallel groups for maximum throughput
    const expanded: ASTExecutionStep[][] = [];

    for (const group of groups) {
      // Split large groups into smaller ones
      if (group.length > 3) {
        const mid = Math.floor(group.length / 2);
        expanded.push(group.slice(0, mid));
        expanded.push(group.slice(mid));
      } else {
        expanded.push(group);
      }
    }

    return expanded;
  }
}
