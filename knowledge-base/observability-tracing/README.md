# Observability & Tracing

## What You Get

Cost Katana tracks your AI usage end-to-end so you can see what’s happening, debug issues, and understand costs. You get tracing, session replay, telemetry, and real-time cost streaming.

## Tracing

- **What it does** – Captures each request (API call, LLM call, tool use) as a span in a trace
- **What you see** – Models used, tokens, cost, latency, errors
- **Sessions** – Spans are grouped into sessions so you can follow a full workflow

## Session Replay

- **What it does** – Records your AI interactions (prompts, responses, tokens, cost) in a replayable session
- **When it runs** – When you enable it in your preferences
- **Use cases** – Debugging, analyzing usage, reviewing what happened in a session

## Real-Time Cost Streaming

- **What it does** – Streams cost events as they occur
- **Use cases** – Live dashboards, alerts, integrations that need real-time cost data

## Agent Trace

- **What it does** – Tracks agent execution steps (model choices, tool calls, reasoning)
- **Use cases** – Auditing agent behavior, debugging multi-step flows

## FAQ

**How do I enable session replay?**  
Turn it on in your account or workspace preferences. Replay applies to usage tracked via Cost Katana.

**Where do I see traces?**  
In the dashboard: open a session or trace to see spans, models, tokens, and cost.

**Can I stream costs to my own system?**  
Yes. Use the cost streaming API to receive events in real time.
