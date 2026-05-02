import { Injectable } from '@nestjs/common';
import type { NodeType } from '../interfaces/dag.interface';
import type { NodeExecutor } from './base-node-executor';

/**
 * Maps NodeType -> NodeExecutor. The runner asks this registry for the
 * executor at the given node and invokes it.
 *
 * Wiring: `AgentPlatformModule` registers this via `useFactory` with an
 * explicit `inject` list of every executor class. Nest's `multi: true` token
 * aggregation is unreliable across versions when using `useExisting`.
 */
@Injectable()
export class NodeExecutorRegistry {
  private readonly index: Map<NodeType, NodeExecutor>;

  constructor(executors: NodeExecutor[]) {
    this.index = new Map();
    for (const executor of executors) {
      if (this.index.has(executor.type)) {
        throw new Error(
          `Duplicate node executor registered for type: ${executor.type}`,
        );
      }
      this.index.set(executor.type, executor);
    }
  }

  has(type: NodeType): boolean {
    return this.index.has(type);
  }

  get(type: NodeType): NodeExecutor {
    const executor = this.index.get(type);
    if (!executor) {
      throw new Error(`No executor registered for node type: ${type}`);
    }
    return executor;
  }

  listTypes(): NodeType[] {
    return Array.from(this.index.keys());
  }
}
