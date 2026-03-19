# Billing & Subscriptions

## Overview

Cost Katana offers subscription plans (Free, Plus, Pro, Enterprise) so you can choose the right level of features and usage. You can manage payment methods, view invoices, set budgets, and use discount codes.

## Plans & Billing

- **Plans**: Free, Plus, Pro, Enterprise  
- **Billing**: Monthly or yearly  
- **Trials**: Free trials are available when starting a paid plan  
- **Status**: Active, trialing, past due, canceled, unpaid  

## Payment Methods

- **Supported**: Credit and debit cards via Stripe (primary), plus Razorpay and PayPal where available  
- **Adding a card**: Use the dashboard or API to add a payment method  
- **Upgrading**: Add a payment method, then confirm to upgrade your plan  

## Budgets

- **User budget**: Default token allowance per user (e.g., 100,000 tokens/month)  
- **Project budget**: Per-project limits to keep spending under control  
- **What happens when you hit the limit**: Requests can be blocked until the next period or until you raise the budget  
- **Alerts**: Cost Katana sends alerts when you approach or exceed your budget  

## Invoices

- **View invoices**: In the dashboard or via the API  
- **Upcoming invoice**: See the next billing amount, line items (plan, overage, discounts, taxes), and due date  
- **Line items**: Plan fee, overage, discounts, proration, tax, seats  

## Discounts

- **Discount codes**: Apply during checkout or subscription creation  
- **Types**: Percentage or fixed amount  
- **Usage limits**: Some codes are single-use or limited to a number of redemptions  

## FAQ

**How do I upgrade my plan?**  
Go to the dashboard → Billing → Upgrade, add a payment method if needed, then select your plan.

**What if my payment fails?**  
Your subscription may move to "past due." Update your payment method to avoid service interruptions.

**Can I cancel anytime?**  
Yes. You can cancel immediately or at the end of the current billing period.

**How do budgets work with the gateway?**  
If you use Cost Katana’s API gateway with a budget, requests are checked before they run. If you’re over budget, the request is blocked and you see an error.
