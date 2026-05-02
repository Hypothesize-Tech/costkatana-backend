import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import type {
  AgentDag,
  CompiledPlan,
  DagEdge,
  DagNode,
  DagValidationIssue,
  DagValidationResult,
  NodeType,
} from '../interfaces/dag.interface';

/**
 * Per-node config schemas. The compiler validates each node's `data.config`
 * against the schema for its `type`. Unknown types fail validation.
 *
 * Schemas should be permissive — they're a "config is reasonably shaped"
 * check, not a full design contract. Executors do their own input validation
 * at run time.
 */
const NODE_CONFIG_SCHEMAS: Record<NodeType, z.ZodTypeAny> = {
  'user-message-input': z.object({}).passthrough(),
  'webhook-input': z
    .object({
      method: z.enum(['POST', 'GET', 'PUT']).optional(),
      path: z.string().optional(),
    })
    .passthrough(),
  'llm-call': z
    .object({
      model: z.string().min(1),
      system: z.string().optional(),
      promptTemplate: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().positive().optional(),
    })
    .passthrough(),
  embedder: z
    .object({
      model: z.string().optional(),
    })
    .passthrough(),
  'web-search': z
    .object({
      query: z.string().optional(),
      maxResults: z.number().int().min(1).max(20).optional(),
    })
    .passthrough(),
  'vector-store-bedrock-kb': z
    .object({
      topK: z.number().int().min(1).max(20).optional(),
      knowledgeBaseId: z.string().optional(),
    })
    .passthrough(),
  'api-call': z
    .object({
      url: z.string().url(),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.unknown().optional(),
    })
    .passthrough(),
  'if-else': z
    .object({
      // JSONLogic-style predicate (e.g. `{ ">=": [{"var": "confidence"}, 0.7] }`).
      predicate: z.unknown().optional(),
      // Or a simple expression with a key + comparator + value.
      simple: z
        .object({
          path: z.string(),
          op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'truthy']),
          value: z.unknown().optional(),
        })
        .optional(),
    })
    .passthrough(),
  checkpoint: z
    .object({
      reason: z.string().optional(),
      notify: z
        .object({
          slackChannel: z.string().optional(),
          email: z.string().optional(),
        })
        .optional(),
      timeoutSeconds: z.number().int().positive().optional(),
    })
    .passthrough(),
  'memory-read': z
    .object({
      key: z.string().min(1),
    })
    .passthrough(),
  'memory-write': z
    .object({
      key: z.string().min(1),
      ttlSeconds: z.number().int().positive().optional(),
    })
    .passthrough(),
  'response-output': z
    .object({
      template: z.string().optional(),
    })
    .passthrough(),
};

const KNOWN_NODE_TYPES = new Set<NodeType>(
  Object.keys(NODE_CONFIG_SCHEMAS) as NodeType[],
);

@Injectable()
export class AgentCompilerService {
  /**
   * Validate a DAG and return either the compiled plan or a list of issues.
   * Pure function — no I/O.
   */
  compile(dag: AgentDag): DagValidationResult {
    const issues: DagValidationIssue[] = [];

    if (!dag || !Array.isArray(dag.nodes) || !Array.isArray(dag.edges)) {
      return {
        ok: false,
        issues: [
          {
            code: 'invalid_edge',
            message: 'dag.nodes and dag.edges must both be arrays.',
          },
        ],
      };
    }

    const nodeIndex: Record<string, DagNode> = {};
    const seenIds = new Set<string>();
    for (const node of dag.nodes) {
      if (!node?.id) {
        issues.push({
          code: 'invalid_node_type',
          message: 'Node is missing an id.',
        });
        continue;
      }
      if (seenIds.has(node.id)) {
        issues.push({
          nodeId: node.id,
          code: 'duplicate_node_id',
          message: `Duplicate node id: ${node.id}`,
        });
        continue;
      }
      seenIds.add(node.id);
      if (!KNOWN_NODE_TYPES.has(node.type)) {
        issues.push({
          nodeId: node.id,
          code: 'invalid_node_type',
          message: `Unknown node type: ${node.type}`,
        });
        continue;
      }
      const schema = NODE_CONFIG_SCHEMAS[node.type];
      const cfg = node.data?.config ?? {};
      const result = schema.safeParse(cfg);
      if (!result.success) {
        const reason = result.error.issues
          .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
          .join('; ');
        issues.push({
          nodeId: node.id,
          code: 'invalid_node_config',
          message: `Node ${node.id} (${node.type}) has invalid config: ${reason}`,
        });
        continue;
      }
      nodeIndex[node.id] = node;
    }

    const outgoingEdges: Record<string, DagEdge[]> = {};
    const incomingEdges: Record<string, DagEdge[]> = {};
    for (const id of seenIds) {
      outgoingEdges[id] = [];
      incomingEdges[id] = [];
    }

    for (const edge of dag.edges) {
      if (!edge?.id || !edge.source || !edge.target) {
        issues.push({
          edgeId: edge?.id,
          code: 'invalid_edge',
          message: 'Edge missing id/source/target.',
        });
        continue;
      }
      if (!seenIds.has(edge.source) || !seenIds.has(edge.target)) {
        issues.push({
          edgeId: edge.id,
          code: 'invalid_edge',
          message: `Edge ${edge.id} references unknown node(s).`,
        });
        continue;
      }
      outgoingEdges[edge.source].push(edge);
      incomingEdges[edge.target].push(edge);
    }

    if (issues.length > 0 && !this.isOnlyWarnings(issues)) {
      return { ok: false, issues };
    }

    const entryNodeIds = Array.from(seenIds).filter(
      (id) => incomingEdges[id]?.length === 0,
    );
    const terminalNodeIds = Array.from(seenIds).filter(
      (id) => outgoingEdges[id]?.length === 0,
    );

    if (entryNodeIds.length === 0) {
      issues.push({
        code: 'missing_entry',
        message: 'No entry node found (every node has an incoming edge).',
      });
    }
    if (terminalNodeIds.length === 0) {
      issues.push({
        code: 'missing_terminal',
        message: 'No terminal node found (every node has an outgoing edge).',
      });
    }

    // Kahn's topological sort (also detects cycles).
    const inDegree: Record<string, number> = {};
    for (const id of seenIds) {
      inDegree[id] = incomingEdges[id]?.length ?? 0;
    }
    const queue: string[] = entryNodeIds.slice();
    const topologicalOrder: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      topologicalOrder.push(id);
      for (const edge of outgoingEdges[id] ?? []) {
        inDegree[edge.target] = (inDegree[edge.target] ?? 0) - 1;
        if (inDegree[edge.target] === 0) queue.push(edge.target);
      }
    }
    if (topologicalOrder.length !== seenIds.size) {
      issues.push({
        code: 'cycle_detected',
        message: 'DAG contains a cycle — agent flows must be acyclic.',
      });
    }

    if (issues.length > 0) {
      return { ok: false, issues };
    }

    const compiled: CompiledPlan = {
      topologicalOrder,
      nodeIndex,
      outgoingEdges,
      incomingEdges,
      entryNodeIds,
      terminalNodeIds,
    };

    return { ok: true, issues: [], compiled };
  }

  /**
   * Stand-alone validator for a single node's config (used by REST endpoints
   * that want to surface inline form errors without running the full
   * compile).
   */
  validateNodeConfig(
    type: NodeType,
    config: unknown,
  ): { ok: boolean; issues: string[] } {
    const schema = NODE_CONFIG_SCHEMAS[type];
    if (!schema) {
      return { ok: false, issues: [`Unknown node type: ${type}`] };
    }
    const result = schema.safeParse(config ?? {});
    if (result.success) return { ok: true, issues: [] };
    return {
      ok: false,
      issues: result.error.issues.map(
        (iss) => `${iss.path.join('.')}: ${iss.message}`,
      ),
    };
  }

  private isOnlyWarnings(_issues: DagValidationIssue[]): boolean {
    // Today everything is an error — leave hook for future "warning"-class
    // codes (e.g. `missing_terminal_node` could be downgraded for dry-runs).
    return false;
  }
}
