/**
 * Node types supported by the Agent Builder platform.
 *
 * Add a new entry here, register a NodeExecutor, and update the AgentCompiler
 * config schemas. The frontend palette + node component must match.
 */
export type NodeType =
  | 'user-message-input'
  | 'webhook-input'
  | 'llm-call'
  | 'embedder'
  | 'web-search'
  | 'vector-store-bedrock-kb'
  | 'api-call'
  | 'if-else'
  | 'checkpoint'
  | 'memory-read'
  | 'memory-write'
  | 'response-output';

export interface DagNodePosition {
  x: number;
  y: number;
}

export interface DagNode {
  id: string;
  type: NodeType;
  position: DagNodePosition;
  data: {
    label: string;
    config: Record<string, unknown>;
  };
}

export interface DagEdge {
  id: string;
  source: string;
  target: string;
  /** Optional branch label, e.g. "true" / "false" for if-else nodes. */
  label?: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface AgentDag {
  nodes: DagNode[];
  edges: DagEdge[];
}

/**
 * Output of AgentCompilerService — what the runner walks.
 *
 * `topologicalOrder` is the ordered list of node IDs to execute when no
 * branch decisions are involved; the runner consults `nodeIndex` and the
 * outgoing edges to handle branching at if-else nodes.
 */
export interface CompiledPlan {
  topologicalOrder: string[];
  nodeIndex: Record<string, DagNode>;
  outgoingEdges: Record<string, DagEdge[]>;
  incomingEdges: Record<string, DagEdge[]>;
  entryNodeIds: string[];
  terminalNodeIds: string[];
}

export interface DagValidationIssue {
  nodeId?: string;
  edgeId?: string;
  code:
    | 'cycle_detected'
    | 'unreachable_node'
    | 'missing_entry'
    | 'missing_terminal'
    | 'invalid_node_type'
    | 'invalid_node_config'
    | 'invalid_edge'
    | 'duplicate_node_id';
  message: string;
}

export interface DagValidationResult {
  ok: boolean;
  issues: DagValidationIssue[];
  compiled?: CompiledPlan;
}
