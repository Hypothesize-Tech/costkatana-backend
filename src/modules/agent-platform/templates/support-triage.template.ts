import type { AgentDag } from '../interfaces/dag.interface';

/**
 * Support Triage v1 — the smallest viable RAG agent for embed-widget deploy.
 *
 * Flow: User Message -> Bedrock KB retrieval -> confidence check
 *   - high confidence (>=0.7): LLM drafts a reply -> Response
 *   - low confidence: Checkpoint (human-in-the-loop) -> LLM drafts -> Response
 *
 * The if-else label "true" maps to the high-confidence path; "false" maps
 * to the escalation path. Both paths converge on the same LLM node.
 */
export const supportTriageTemplate = {
  slug: 'support-triage',
  name: 'Support Triage',
  description:
    'Answer customer questions from your docs (RAG). Escalates low-confidence answers to a human via Checkpoint, then drafts a final reply.',
  category: 'support',
  requiredCapabilities: ['bedrock-kb', 'bedrock-llm'],
  isOfficial: true,
  dag: {
    nodes: [
      {
        id: 'n_input',
        type: 'user-message-input',
        position: { x: 80, y: 200 },
        data: { label: 'User message', config: {} },
      },
      {
        id: 'n_kb',
        type: 'vector-store-bedrock-kb',
        position: { x: 320, y: 200 },
        data: {
          label: 'Search docs',
          config: { topK: 5 },
        },
      },
      {
        id: 'n_check',
        type: 'if-else',
        position: { x: 560, y: 200 },
        data: {
          label: 'Confidence ≥ 0.7?',
          config: {
            simple: { path: 'confidence', op: 'gte', value: 0.7 },
          },
        },
      },
      {
        id: 'n_pause',
        type: 'checkpoint',
        position: { x: 800, y: 80 },
        data: {
          label: 'Escalate to human',
          config: {
            reason: 'low_confidence',
            timeoutSeconds: 600,
            notify: { slackChannel: 'support-ops' },
          },
        },
      },
      {
        id: 'n_llm',
        type: 'llm-call',
        position: { x: 1080, y: 200 },
        data: {
          label: 'Draft reply',
          config: {
            model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
            system:
              'You are a helpful support agent. Use the retrieved documents to answer accurately. Cite which documents you used. If the answer is not in the documents, say so.',
            temperature: 0.3,
            maxTokens: 1024,
          },
        },
      },
      {
        id: 'n_out',
        type: 'response-output',
        position: { x: 1340, y: 200 },
        data: { label: 'Reply', config: {} },
      },
    ],
    edges: [
      { id: 'e1', source: 'n_input', target: 'n_kb' },
      { id: 'e2', source: 'n_kb', target: 'n_check' },
      { id: 'e3', source: 'n_check', target: 'n_llm', label: 'true' },
      { id: 'e4', source: 'n_check', target: 'n_pause', label: 'false' },
      { id: 'e5', source: 'n_pause', target: 'n_llm' },
      { id: 'e6', source: 'n_llm', target: 'n_out' },
    ],
  } satisfies AgentDag,
} as const;

export type SupportTriageTemplate = typeof supportTriageTemplate;
