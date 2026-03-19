import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type GovernancePolicyDocument = GovernancePolicy & Document;

@Schema({
  collection: 'governance_policies',
  timestamps: true,
  versionKey: false,
})
export class GovernancePolicy {
  @Prop({ required: true, unique: true, default: 'default' })
  policySetId: string;

  @Prop({ type: [Object], required: true, default: [] })
  agentPolicies: Array<{
    name: string;
    agentType?: string;
    maxTokensPerRequest?: number;
    allowedModels?: string[];
    rateLimit?: { requests: number; window: string };
    identityCount?: number;
    [key: string]: unknown;
  }>;

  @Prop({ type: [Object], required: true, default: [] })
  auditRules: Array<{
    name: string;
    eventTypes?: string[];
    retentionPeriod?: string;
    sensitiveDataMasking?: boolean;
    logLevel?: string;
    enabled?: boolean;
    [key: string]: unknown;
  }>;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const GovernancePolicySchema =
  SchemaFactory.createForClass(GovernancePolicy);

GovernancePolicySchema.index({ policySetId: 1 }, { unique: true });
