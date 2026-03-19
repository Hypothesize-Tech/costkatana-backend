# Cost Katana API Gateway

## What It Is

The Cost Katana API Gateway is a single entry point for your AI API calls. You send requests to Cost Katana instead of directly to OpenAI, Anthropic, Google, or AWS Bedrock. Cost Katana routes them, enforces budgets, and can optimize and cache them.

## What You Get

- **One endpoint for many providers** – Use one integration to switch between OpenAI, Anthropic, Google, and Bedrock  
- **Budget control** – Requests can be blocked when you hit your budget, with suggested alternatives  
- **Automatic failover** – If one provider fails, Cost Katana can try another (when configured)  
- **Prompt caching** – Repeated prompts are cached by supported providers to reduce cost  
- **Rate limiting** – Protects you from spikes and helps avoid throttling  

## Budgets & Spending

- **Pre-check**: Before each request, Cost Katana estimates the cost and checks your budget  
- **Over budget**: Requests are blocked with a clear error and, where possible, cheaper alternatives  
- **Alerts**: You get alerts when usage is high or near your limit  

## Failover

If Cost Katana is configured for multiple providers, a failed request can automatically retry with another provider. This helps keep your app running when a provider has issues.

## Priority Queue

For high-traffic setups, requests can be prioritized (e.g., critical vs bulk). Higher-priority requests are processed first when capacity is limited.

## FAQ

**Why use the gateway instead of calling providers directly?**  
You get unified billing, budgets, failover, caching, and analytics in one place.

**What happens when I exceed my budget?**  
Requests are blocked with a clear error. You can increase the budget or wait until the next period.

**Does Cost Katana store my API keys?**  
Cost Katana uses your keys to proxy requests. Keys are stored securely and used only for your traffic.
