# MCP Integrations: Connect AI Tools to Cost Katana

## What Is MCP?

MCP (Model Context Protocol) lets AI tools like Claude, Cursor, and Windsurf talk to external services. Cost Katana provides MCP integrations so these tools can securely use your Cost Katana data and capabilities.

## What You Can Connect

Cost Katana supports MCP integrations with:

| Service | What You Can Do |
|---------|-----------------|
| **MongoDB** | Query your databases (read-only) for cost analysis, with index suggestions |
| **GitHub** | Access repos, analyze code, create PRs and issues |
| **Vercel** | Manage deployments, projects, and environments |
| **AWS** | Manage resources and explore costs |
| **Google** | Use Google Cloud, Workspace, and AI (Gemini) |
| **Slack** | Work with channels and messages |
| **Jira** | Access issues and projects |
| **Linear** | Use Linear issues and workflows |
| **Discord** | Integrate with Discord bots and channels |

## How to Set Up

1. **Connect in Cost Katana** – Link your account (e.g., MongoDB, GitHub, Vercel) in the Integrations section  
2. **Configure your AI client** – Add the Cost Katana MCP server to your Cursor or Claude config  
3. **Use in chat** – Ask questions or give instructions; the AI will use the connected tools when relevant  

## Security

- **Read-only by default** – Many integrations (e.g., MongoDB) are read-only  
- **Your data stays yours** – BYOC (Bring Your Own Connection) means Cost Katana connects to your instances  
- **Rate limiting** – Prevents misuse and protects your account  
- **Audit logging** – Actions are logged for review  

## FAQ

**Do I need to install anything?**  
Yes. You configure the MCP server in your AI client (e.g., Cursor’s `mcp-config.json` or Claude’s `claude_desktop_config.json`).

**Is MongoDB access safe?**  
MongoDB MCP is read-only and validates queries. Sensitive fields can be redacted in responses.

**Can I use multiple integrations at once?**  
Yes. You can connect several services; the AI will use the right one based on your request.
