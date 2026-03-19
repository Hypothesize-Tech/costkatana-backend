# Prompt Templates

## What They Are

Prompt templates are reusable prompts with placeholders. You define a template once (e.g., "Summarize {{topic}} in {{language}}"), then fill in the values each time you use it. Cost Katana tracks usage and can suggest more cost-effective variants.

## What You Get

- **Reusable prompts** – Write once, use many times with different variables
- **Variables** – Use `{{variableName}}` for text or image inputs
- **AI-generated templates** – Describe what you need in plain language and Cost Katana suggests a template
- **Execution tracking** – See how often templates are used and how much they cost
- **Cost optimization** – Get suggestions to reduce cost while keeping quality

## Example

**Template:** "Summarize {{topic}} in {{language}} with {{tone}} tone."

**Variables:** topic = "AI costs", language = "English", tone = "professional"

**Result:** "Summarize AI costs in English with professional tone."

## Prompt Caching

When you use the API gateway, Cost Katana supports provider prompt caching (OpenAI, Anthropic, Google). Repeated system prompts or long contexts can be cached so you pay less for tokens on similar requests.

## FAQ

**How do I create a template?**  
Use the dashboard or API to create a template with `{{variableName}}` placeholders, then execute it with your variable values.

**Can templates include images?**  
Yes. You can define image variables with roles like "reference" or "evidence."

**How does AI template generation work?**  
Describe what you want (e.g., "a prompt for code review in Spanish") and Cost Katana generates a template and suggests variables.
