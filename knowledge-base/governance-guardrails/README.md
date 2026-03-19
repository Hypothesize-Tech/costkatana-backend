# Governance & Guardrails

## What They Are

Governance and guardrails control how AI agents and automations act in Cost Katana. You can set limits on models, actions, and spending, require approval for risky actions, and keep a record of decisions for compliance.

## What You Can Control

- **Agent permissions** – Which models and providers an agent can use  
- **Budget caps** – Per-request, daily, or monthly limits per agent  
- **Rate limits** – Max requests per minute or hour  
- **Approval workflows** – High-risk actions (e.g., AWS changes) need your approval before running  
- **Content guardrails** – Filters to keep outputs safe and appropriate  

## How It Protects You

- **Deny by default** – New agents start with read-only access; you grant more as needed  
- **Audit trail** – Decisions are recorded with reasoning and alternatives  
- **Human oversight** – You can mark actions as reversible or require human review  
- **Moderation** – Output can be checked before it’s shown or used  

## FAQ

**Who needs governance?**  
Teams using agents, automations, or integrations that can perform actions (e.g., AWS, GitHub, MCP).

**Can I revoke access quickly?**  
Yes. You can suspend or revoke agent identities so they stop working immediately.

**What gets audited?**  
Model choices, executions, resource use, and API calls, with configurable retention.
