# MongoDB Migrations

## Workflow → Agent Trace migration

**Script:** `renameWorkflowToAgentTrace.ts`

Migrates existing MongoDB data to align with the Workflow → Agent Trace rename.

### What it does

- **workflowversions** → renames collection to **agenttraceversions** (if source exists and target does not), and renames fields `workflowId`→`traceId`, `workflowName`→`traceName` inside
- **usages**: renames `workflowId`→`traceId`, `workflowName`→`traceName`, `workflowStep`→`traceStep`, `workflowSequence`→`traceSequence`; sets `templateUsage.context` from `'workflow'` to `'agent_trace'`
- **ailogs**: same field renames
- **alerts**: type enum `workflow_budget`→`agent_trace_budget`, `workflow_spike`→`agent_trace_spike`, `workflow_inefficiency`→`agent_trace_inefficiency`, `workflow_failure`→`agent_trace_failure`
- **agentdecisionlogs**: `actionType` `workflow_step`→`agent_trace_step`, `agentType` `workflow`→`agent_trace`
- **agentidentities**: `agentType` `workflow`→`agent_trace`
- **agent_decision_audits**: `actionType` `workflow_step`→`agent_trace_step`
- **subscriptions**: renames `limits.workflows`→`limits.agentTraces`, `usage.workflowsUsed`→`usage.agentTracesUsed`
- **userexamples**: sets `category` from `'workflows'` to `'agent_trace'`

Does **not** modify the **googleworkflows** collection.

### How to run

1. Set `MONGODB_URI` (or `MONGODB_URI_PROD` in production) to your MongoDB connection string.
2. From the backend root:

   ```bash
   npm run migrate:agent-trace
   ```

   Or with an explicit URI:

   ```bash
   MONGODB_URI="mongodb://..." npm run migrate:agent-trace
   ```

3. The script is **idempotent**: safe to run multiple times. It only updates documents that still have the old field names or values.

### Requirements

- Node.js 18+
- `ts-node` and `tsconfig-paths` (already in devDependencies)
- Network access to MongoDB
