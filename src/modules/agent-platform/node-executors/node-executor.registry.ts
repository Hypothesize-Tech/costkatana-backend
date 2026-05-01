import { Inject, Injectable } from '@nestjs/common';
import type { NodeType } from '../interfaces/dag.interface';
import { NODE_EXECUTOR, NodeExecutor } from './base-node-executor';

/**
 * Maps NodeType -> NodeExecutor. The runner asks this registry for the
 * executor at the given node and invokes it.
 *
 * Wiring: every executor is registered in the module's `providers` array
 * with `{ provide: NODE_EXECUTOR, useExisting: SomeExecutor, multi: true }`,
 * Nest gathers them all, and the registry indexes by `type`.
 */
@Injectable()
export class NodeExecutorRegistry {
  private readonly index: Map<NodeType, NodeExecutor>;

  constructor(@Inject(NODE_EXECUTOR) executors: NodeExecutor[]) {
    this.index = new Map();
    for (const executor of executors ?? []) {
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
