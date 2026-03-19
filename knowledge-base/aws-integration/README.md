# Manage AWS with Natural Language

## What You Can Do

With Cost Katana's AWS integration, you can manage AWS resources using plain English in the chat. Ask to stop idle EC2 instances, start RDS databases, adjust S3 lifecycle rules, or change Lambda settings—Cost Katana creates a plan, you review and approve it, then it runs securely against your AWS account.

## How It Works

1. **You ask** – e.g., "Stop my idle EC2 instances in us-east-1"
2. **Cost Katana plans** – A step-by-step plan is generated with cost impact
3. **You approve** – You review and approve before anything runs
4. **Cost Katana executes** – Actions run using your IAM role via secure temporary credentials

Every execution requires your approval. Nothing runs automatically.

## Supported AWS Services

| Service | Common Actions |
|---------|----------------|
| EC2 | Stop, start, resize instances |
| RDS | Stop, start, snapshot, resize |
| S3 | Lifecycle rules, intelligent tiering |
| Lambda | Update memory, timeout |
| ECS, DynamoDB, CloudWatch | Via resource creation and cost exploration |

## Safety Features

- **Kill switch** – You or Cost Katana can immediately stop all executions
- **Cost anomaly guard** – Blocks or flags plans that could cause unusual cost spikes
- **Simulate first** – Run a dry run to see what would happen without making changes
- **Blocked commands** – Destructive actions (e.g., "delete all") are blocked

## FAQ

**How do I connect my AWS account?**  
Connect via IAM role in the Integrations section. Cost Katana uses your role with minimal permissions—only for the actions you allow.

**What if something goes wrong?**  
For reversible actions, Cost Katana can roll back. You can also use the kill switch to stop everything.

**Can I try it without affecting my account?**  
Yes. Use "simulate" to see the planned changes without executing them.
