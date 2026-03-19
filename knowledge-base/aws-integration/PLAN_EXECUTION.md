# AWS Plan Execution Flow

## Overview

Execution of AWS plans follows a strict approval-based flow: parse intent → generate plan → approve → execute. No autonomous scheduling; every execution requires a fresh approval token.

## Flow Diagram

```
User (NL) → IntentParser → PlanGenerator → Approval → ExecutionEngine → AWS APIs
                ↓              ↓             ↓              ↓
           Blocked?      Permission?    Token?      KillSwitch? CostAnomaly?
```

## Step 1: Parse Intent

- **Input**: Natural language (e.g., "stop my idle EC2 instances in us-east-1")
- **IntentParserService**: Extracts entities (service: ec2, action: stop, regions), risk level
- **Blocked Check**: BLOCKED_COMMANDS list; if matched → blocked, no plan generated

## Step 2: Generate Plan

- **PlanGeneratorService**: Converts intent to ExecutionPlan
- **DSL Validation**: Service, action, constraints must be valid
- **Permission Boundary**: Action must be allowed for the connection
- **Output**: planId, steps[], summary (riskScore, costImpact, mermaidDiagram, rollbackPlan)

## Step 3: Approve Plan

- **User Review**: Plan shown with cost impact, risk, visualization
- **Approval Endpoint**: `POST /api/aws/approve-plan` with planId
- **Approval Token**: Issued; expires in 15 minutes; single-use
- **Token Storage**: Marked used after execution

## Step 4: Execute

### Pre-Execution Checks

1. **Token Validation**: Valid, not expired, not used
2. **Plan Validation**: Plan still valid (PlanGeneratorService.validatePlan)
3. **Kill Switch**: checkKillSwitch(customerId, connectionId, service, action, riskLevel)
4. **Cost Anomaly** (if configured): CostAnomalyGuard validation

### Execution Loop

1. **STS Assume Role**: Get temporary credentials for customer role
2. **Per Step**:
   - Execute API call (EC2, RDS, S3, Lambda SDK)
   - On success: record result, update progress
   - On critical error: trigger rollback if reversible
3. **Rollback**: Reverse completed steps if mid-execution failure
4. **SSE Progress**: Real-time progress callback (optional)

### Supported Step Types

- **EC2**: StopInstances, StartInstances, ModifyInstanceAttribute
- **RDS**: StopDBInstance, StartDBInstance, CreateDBSnapshot, ModifyDBInstance
- **S3**: PutBucketLifecycleConfiguration, PutBucketIntelligentTieringConfiguration
- **Lambda**: UpdateFunctionConfiguration (memory, timeout)

## Security Guarantees

- **No Long-Lived Credentials**: STS assume-role only
- **Minimal Permissions**: Permission boundary enforced
- **Approval Required**: No auto-execution
- **Kill Switch**: Immediate stop capability
- **Audit**: Execution logs, step results, rollback events
