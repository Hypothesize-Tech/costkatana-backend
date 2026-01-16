/**
 * Parallel Execution Optimizer
 * 
 * Analyzes dependency graphs and optimizes for parallel execution:
 * - Build dependency DAG (Directed Acyclic Graph)
 * - Detect independent execution paths
 * - Schedule parallel execution groups
 * - Estimate performance improvements
 */

import { loggingService } from '../services/logging.service';
import { ProgramNode, IRProgram, IRParallelGroup } from './promptAST.types';

export interface DependencyNode {
  id: string;
  type: string;
  dependencies: string[];
  dependents: string[];
  level: number; // Execution level (0 = no deps, higher = more deps)
  estimatedCost: number;
  estimatedLatency: number;
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: Map<string, string[]>; // from → [to...]
  levels: Map<number, string[]>; // level → [node IDs]
  criticalPath: string[];
  totalLatency: number;
}

export interface ParallelExecutionPlan {
  groups: ParallelGroup[];
  estimatedSequentialLatency: number;
  estimatedParallelLatency: number;
  speedupFactor: number;
  resourceUtilization: number;
}

export interface ParallelGroup {
  groupId: string;
  level: number;
  nodes: string[];
  estimatedLatency: number;
  canExecuteInParallel: boolean;
  maxParallelism: number;
}

export class ParallelExecutionOptimizerService {
  /**
   * Build dependency graph from AST
   */
  static buildDependencyGraph(ast: ProgramNode): DependencyGraph {
    const nodes = new Map<string, DependencyNode>();
    const edges = new Map<string, string[]>();
    
    // First pass: Create nodes
    for (const statement of ast.body) {
      const deps = 'dependencies' in statement ? statement.dependencies || [] : [];
      
      nodes.set(statement.id, {
        id: statement.id,
        type: statement.type,
        dependencies: deps,
        dependents: [],
        level: 0,
        estimatedCost: statement.metadata.cost || 0,
        estimatedLatency: statement.metadata.tokens ? statement.metadata.tokens * 0.01 : 100
      });

      // Build edges
      for (const dep of deps) {
        if (!edges.has(dep)) {
          edges.set(dep, []);
        }
        edges.get(dep)!.push(statement.id);
      }
    }

    // Second pass: Compute dependents
    for (const [fromId, toIds] of edges.entries()) {
      for (const toId of toIds) {
        const node = nodes.get(toId);
        if (node) {
          node.dependents.push(fromId);
        }
      }
    }

    // Third pass: Compute levels (topological sort)
    const levels = this.computeLevels(nodes);

    // Fourth pass: Find critical path
    const criticalPath = this.findCriticalPath(nodes);
    const totalLatency = this.computeTotalLatency(nodes, criticalPath);

    loggingService.info('Dependency graph built', {
      nodeCount: nodes.size,
      edgeCount: Array.from(edges.values()).reduce((sum, arr) => sum + arr.length, 0),
      levelCount: levels.size,
      criticalPathLength: criticalPath.length,
      totalLatency
    });

    return {
      nodes,
      edges,
      levels,
      criticalPath,
      totalLatency
    };
  }

  /**
   * Compute execution levels (topological sort)
   */
  private static computeLevels(nodes: Map<string, DependencyNode>): Map<number, string[]> {
    const levels = new Map<number, string[]>();
    const visited = new Set<string>();
    const temp = new Set<string>();

    const visit = (nodeId: string): number => {
      if (visited.has(nodeId)) {
        const node = nodes.get(nodeId)!;
        return node.level;
      }

      if (temp.has(nodeId)) {
        throw new Error('Circular dependency detected');
      }

      temp.add(nodeId);
      const node = nodes.get(nodeId)!;

      let maxDepLevel = -1;
      for (const depId of node.dependencies) {
        const depLevel = visit(depId);
        maxDepLevel = Math.max(maxDepLevel, depLevel);
      }

      node.level = maxDepLevel + 1;
      temp.delete(nodeId);
      visited.add(nodeId);

      if (!levels.has(node.level)) {
        levels.set(node.level, []);
      }
      levels.get(node.level)!.push(nodeId);

      return node.level;
    };

    for (const nodeId of nodes.keys()) {
      if (!visited.has(nodeId)) {
        visit(nodeId);
      }
    }

    return levels;
  }

  /**
   * Find critical path (longest path through DAG)
   */
  private static findCriticalPath(
    nodes: Map<string, DependencyNode>,
  ): string[] {
    const distances = new Map<string, number>();
    const parents = new Map<string, string | null>();

    // Initialize
    for (const nodeId of nodes.keys()) {
      distances.set(nodeId, 0);
      parents.set(nodeId, null);
    }

    // Topological order
    const sorted: string[] = [];
    const visited = new Set<string>();
    
    const dfs = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      
      const node = nodes.get(nodeId)!;
      for (const depId of node.dependencies) {
        dfs(depId);
      }
      sorted.push(nodeId);
    };

    for (const nodeId of nodes.keys()) {
      dfs(nodeId);
    }

    sorted.reverse();

    // Compute longest paths
    for (const nodeId of sorted) {
      const node = nodes.get(nodeId)!;
      
      for (const depId of node.dependencies) {
        const newDist = distances.get(depId)! + node.estimatedLatency;
        
        if (newDist > distances.get(nodeId)!) {
          distances.set(nodeId, newDist);
          parents.set(nodeId, depId);
        }
      }
    }

    // Find node with maximum distance
    let maxDist = 0;
    let maxNode = sorted[0];
    
    for (const [nodeId, dist] of distances.entries()) {
      if (dist > maxDist) {
        maxDist = dist;
        maxNode = nodeId;
      }
    }

    // Reconstruct path
    const path: string[] = [];
    let current: string | null = maxNode;
    
    while (current !== null) {
      path.push(current);
      current = parents.get(current)!;
    }

    return path.reverse();
  }

  /**
   * Compute total latency along path
   */
  private static computeTotalLatency(
    nodes: Map<string, DependencyNode>,
    path: string[]
  ): number {
    return path.reduce((sum, nodeId) => {
      const node = nodes.get(nodeId);
      return sum + (node?.estimatedLatency || 0);
    }, 0);
  }

  /**
   * Generate parallel execution plan
   */
  static generateParallelExecutionPlan(
    graph: DependencyGraph,
    maxParallelism: number = 4
  ): ParallelExecutionPlan {
    const groups: ParallelGroup[] = [];
    let estimatedParallelLatency = 0;
    const estimatedSequentialLatency = graph.totalLatency;

    // Group nodes by level for parallel execution
    for (const [level, nodeIds] of Array.from(graph.levels.entries()).sort((a, b) => a[0] - b[0])) {
      const nodeLatencies = nodeIds.map(id => graph.nodes.get(id)!.estimatedLatency);
      const maxLatency = Math.max(...nodeLatencies);
      
      const group: ParallelGroup = {
        groupId: `group_level_${level}`,
        level,
        nodes: nodeIds,
        estimatedLatency: maxLatency,
        canExecuteInParallel: nodeIds.length > 1,
        maxParallelism: Math.min(nodeIds.length, maxParallelism)
      };

      groups.push(group);
      estimatedParallelLatency += maxLatency;
    }

    const speedupFactor = estimatedSequentialLatency / estimatedParallelLatency;
    const resourceUtilization = this.computeResourceUtilization(groups, maxParallelism);

    loggingService.info('Generated parallel execution plan', {
      groupCount: groups.length,
      estimatedSequentialLatency,
      estimatedParallelLatency,
      speedupFactor: speedupFactor.toFixed(2) + 'x',
      resourceUtilization: (resourceUtilization * 100).toFixed(1) + '%'
    });

    return {
      groups,
      estimatedSequentialLatency,
      estimatedParallelLatency,
      speedupFactor,
      resourceUtilization
    };
  }

  /**
   * Compute resource utilization
   */
  private static computeResourceUtilization(
    groups: ParallelGroup[],
    maxParallelism: number
  ): number {
    if (groups.length === 0) return 0;

    const totalSlots = groups.reduce(
      (sum, group) => sum + group.maxParallelism,
      0
    );
    const maxPossibleSlots = groups.length * maxParallelism;

    return totalSlots / maxPossibleSlots;
  }

  /**
   * Optimize IR for parallel execution
   */
  static optimizeIRForParallel(
    ir: IRProgram,
    plan: ParallelExecutionPlan
  ): IRProgram {
    const parallelGroups: IRParallelGroup[] = [];

    for (const group of plan.groups) {
      if (group.canExecuteInParallel && group.nodes.length > 1) {
        parallelGroups.push({
          id: group.groupId,
          instructions: group.nodes,
          estimatedSpeedup: group.nodes.length / group.maxParallelism
        });
      }
    }

    return {
      ...ir,
      metadata: {
        ...ir.metadata,
        parallelGroups
      }
    };
  }

  /**
   * Analyze parallelization opportunities
   */
  static analyzeParallelizationOpportunities(
    ast: ProgramNode
  ): {
    totalNodes: number;
    parallelizableNodes: number;
    parallelizationPercentage: number;
    recommendedMaxParallelism: number;
    estimatedSpeedup: number;
  } {
    const graph = this.buildDependencyGraph(ast);
    
    // Count nodes that can execute in parallel (nodes at same level)
    let parallelizableNodes = 0;
    let maxNodesAtSameLevel = 0;

    for (const nodeIds of graph.levels.values()) {
      if (nodeIds.length > 1) {
        parallelizableNodes += nodeIds.length;
        maxNodesAtSameLevel = Math.max(maxNodesAtSameLevel, nodeIds.length);
      }
    }

    const totalNodes = graph.nodes.size;
    const parallelizationPercentage = (parallelizableNodes / totalNodes) * 100;
    const recommendedMaxParallelism = Math.min(maxNodesAtSameLevel, 8); // Cap at 8

    // Estimate speedup using Amdahl's Law
    const parallelFraction = parallelizableNodes / totalNodes;
    const estimatedSpeedup = 1 / ((1 - parallelFraction) + (parallelFraction / recommendedMaxParallelism));

    loggingService.info('Analyzed parallelization opportunities', {
      totalNodes,
      parallelizableNodes,
      parallelizationPercentage: parallelizationPercentage.toFixed(1) + '%',
      recommendedMaxParallelism,
      estimatedSpeedup: estimatedSpeedup.toFixed(2) + 'x'
    });

    return {
      totalNodes,
      parallelizableNodes,
      parallelizationPercentage,
      recommendedMaxParallelism,
      estimatedSpeedup
    };
  }

  /**
   * Validate dependency graph (detect cycles)
   */
  static validateDependencyGraph(graph: DependencyGraph): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for cycles (already done in topological sort, but explicit check here)
    try {
      this.detectCycles(graph);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Cycle detected');
    }

    // Check for orphaned nodes
    for (const [nodeId, node] of graph.nodes.entries()) {
      if (node.dependencies.length === 0 && node.dependents.length === 0) {
        warnings.push(`Orphaned node detected: ${nodeId}`);
      }
    }

    // Check for long critical path
    if (graph.criticalPath.length > 10) {
      warnings.push(`Long critical path detected (${graph.criticalPath.length} nodes). Consider breaking into smaller tasks.`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Detect cycles in dependency graph
   */
  private static detectCycles(graph: DependencyGraph): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      const node = graph.nodes.get(nodeId)!;
      for (const depId of node.dependencies) {
        if (!visited.has(depId)) {
          if (dfs(depId)) return true;
        } else if (recursionStack.has(depId)) {
          throw new Error(`Circular dependency detected: ${nodeId} → ${depId}`);
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of graph.nodes.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId);
      }
    }
  }

  /**
   * Generate execution schedule
   */
  static generateExecutionSchedule(
    plan: ParallelExecutionPlan
  ): {
    schedule: Array<{
      time: number;
      group: ParallelGroup;
      action: 'start' | 'end';
    }>;
    totalTime: number;
  } {
    const schedule: Array<{ time: number; group: ParallelGroup; action: 'start' | 'end' }> = [];
    let currentTime = 0;

    for (const group of plan.groups) {
      schedule.push({
        time: currentTime,
        group,
        action: 'start'
      });

      currentTime += group.estimatedLatency;

      schedule.push({
        time: currentTime,
        group,
        action: 'end'
      });
    }

    return {
      schedule,
      totalTime: currentTime
    };
  }
}

