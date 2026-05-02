import { AgentCompilerService } from '../agent-compiler.service';
import type { AgentDag } from '../../interfaces/dag.interface';

describe('AgentCompilerService', () => {
  const compiler = new AgentCompilerService();

  const node = (id: string, type: string, config: object = {}): any => ({
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label: id, config },
  });
  const edge = (id: string, source: string, target: string, label?: string) => ({
    id,
    source,
    target,
    ...(label ? { label } : {}),
  });

  it('compiles a valid linear DAG and returns a topological order', () => {
    const dag: AgentDag = {
      nodes: [
        node('a', 'user-message-input'),
        node('b', 'llm-call', { model: 'claude-3-5-sonnet' }),
        node('c', 'response-output'),
      ],
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
    };
    const result = compiler.compile(dag);
    expect(result.ok).toBe(true);
    expect(result.compiled?.topologicalOrder).toEqual(['a', 'b', 'c']);
    expect(result.compiled?.entryNodeIds).toEqual(['a']);
    expect(result.compiled?.terminalNodeIds).toEqual(['c']);
  });

  it('detects cycles', () => {
    const dag: AgentDag = {
      nodes: [
        node('a', 'user-message-input'),
        node('b', 'llm-call', { model: 'm' }),
        node('c', 'response-output'),
      ],
      edges: [
        edge('e1', 'a', 'b'),
        edge('e2', 'b', 'c'),
        edge('e3', 'c', 'b'), // cycle back to b
      ],
    };
    const result = compiler.compile(dag);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'cycle_detected')).toBe(true);
  });

  it('flags dangling edges that reference unknown nodes', () => {
    const dag: AgentDag = {
      nodes: [node('a', 'user-message-input'), node('b', 'response-output')],
      edges: [edge('e1', 'a', 'ghost')],
    };
    const result = compiler.compile(dag);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'invalid_edge')).toBe(true);
  });

  it('flags a graph with no entry node (every node has incoming edges)', () => {
    const dag: AgentDag = {
      nodes: [
        node('a', 'llm-call', { model: 'm' }),
        node('b', 'llm-call', { model: 'm' }),
      ],
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'a')],
    };
    const result = compiler.compile(dag);
    expect(result.ok).toBe(false);
    expect(
      result.issues.some(
        (i) =>
          i.code === 'missing_entry' || i.code === 'cycle_detected',
      ),
    ).toBe(true);
  });

  it('flags unknown node types', () => {
    const dag: AgentDag = {
      nodes: [node('a', 'totally-bogus' as any)],
      edges: [],
    };
    const result = compiler.compile(dag);
    expect(result.ok).toBe(false);
    expect(
      result.issues.some((i) => i.code === 'invalid_node_type'),
    ).toBe(true);
  });

  it('flags duplicate node ids', () => {
    const dag: AgentDag = {
      nodes: [
        node('a', 'user-message-input'),
        node('a', 'response-output'),
      ],
      edges: [],
    };
    const result = compiler.compile(dag);
    expect(result.ok).toBe(false);
    expect(
      result.issues.some((i) => i.code === 'duplicate_node_id'),
    ).toBe(true);
  });

  it('flags invalid llm-call config (missing model)', () => {
    const dag: AgentDag = {
      nodes: [
        node('a', 'user-message-input'),
        node('b', 'llm-call', {}),
        node('c', 'response-output'),
      ],
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
    };
    const result = compiler.compile(dag);
    expect(result.ok).toBe(false);
    expect(
      result.issues.some(
        (i) => i.code === 'invalid_node_config' && i.nodeId === 'b',
      ),
    ).toBe(true);
  });

  it('validateNodeConfig rejects unknown types', () => {
    const r = compiler.validateNodeConfig('not-a-real-type' as any, {});
    expect(r.ok).toBe(false);
  });

  it('validateNodeConfig accepts a permissive checkpoint config', () => {
    const r = compiler.validateNodeConfig('checkpoint', { reason: 'low_conf' });
    expect(r.ok).toBe(true);
  });
});
