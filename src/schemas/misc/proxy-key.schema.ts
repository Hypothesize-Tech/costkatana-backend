import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ProxyKeyDocument = HydratedDocument<ProxyKey>;

@Schema({ _id: false })
export class ProxyKeyUsageStats {
  @Prop({ default: 0 })
  totalRequests: number;

  @Prop({ default: 0 })
  totalCost: number;

  @Prop({ default: Date.now })
  lastResetDate: Date;

  @Prop({ default: 0 })
  dailyCost: number;

  @Prop({ default: 0 })
  monthlyCost: number;
}

@Schema({ timestamps: true })
export class ProxyKey {
  @Prop({
    required: true,
    unique: true,
    match: /^ck-proxy-[a-zA-Z0-9]{32}$/,
  })
  keyId: string;

  @Prop({ required: true, trim: true, maxlength: 100 })
  name: string;

  @Prop({ trim: true, maxlength: 500 })
  description?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ProviderKey', required: true })
  providerKeyId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Project' })
  projectId?: Types.ObjectId;

  @Prop({ type: String, ref: 'Team' })
  teamId?: string;

  @Prop({ type: [String], ref: 'Project' })
  assignedProjects?: string[];

  @Prop({
    enum: ['personal', 'team', 'project', 'organization'],
    default: 'personal',
  })
  scope: 'personal' | 'team' | 'project' | 'organization';

  @Prop({ type: [String], ref: 'User' })
  sharedWith?: string[];

  @Prop({ type: [String], enum: ['read', 'write', 'admin'], default: ['read'] })
  permissions: ('read' | 'write' | 'admin')[];

  @Prop({ min: 0 })
  budgetLimit?: number;

  @Prop({ min: 0 })
  dailyBudgetLimit?: number;

  @Prop({ min: 0 })
  monthlyBudgetLimit?: number;

  @Prop({ min: 0 })
  rateLimit?: number;

  @Prop({ type: [String] })
  allowedIPs?: string[];

  @Prop({ type: [String] })
  allowedDomains?: string[];

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  lastUsed?: Date;

  @Prop()
  expiresAt?: Date;

  @Prop({ type: ProxyKeyUsageStats, default: () => ({}) })
  usageStats: ProxyKeyUsageStats;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;

  // Instance methods
  isExpired(): boolean {
    return this.expiresAt ? new Date() > this.expiresAt : false;
  }

  isOverBudget(): boolean {
    if (this.budgetLimit && this.usageStats.totalCost >= this.budgetLimit) {
      return true;
    }
    if (
      this.dailyBudgetLimit &&
      this.usageStats.dailyCost >= this.dailyBudgetLimit
    ) {
      return true;
    }
    if (
      this.monthlyBudgetLimit &&
      this.usageStats.monthlyCost >= this.monthlyBudgetLimit
    ) {
      return true;
    }
    return false;
  }

  canBeUsedBy(userId: string): boolean {
    // Owner can always use (userId may be string or ObjectId)
    const ownerId = this.userId?.toString?.() ?? String(this.userId);
    if (ownerId === userId) {
      return true;
    }

    // Check if shared with user
    return this.sharedWith?.includes(userId) || false;
  }

  canAccessProject(projectId: string): boolean {
    // No project restriction
    if (!this.projectId && !this.assignedProjects?.length) {
      return true;
    }

    // Specific project access (projectId may be string or ObjectId)
    const projId = this.projectId?.toString?.() ?? String(this.projectId);
    if (projId === projectId) {
      return true;
    }

    // Multiple project access
    return this.assignedProjects?.includes(projectId) || false;
  }
}

export const ProxyKeySchema = SchemaFactory.createForClass(ProxyKey);

// Indexes
ProxyKeySchema.index({ userId: 1 });
ProxyKeySchema.index({ projectId: 1 });
ProxyKeySchema.index({ teamId: 1 });
ProxyKeySchema.index({ keyId: 1 }, { unique: true });
ProxyKeySchema.index({ expiresAt: 1 });

// Instance methods
ProxyKeySchema.methods.isExpired = function (): boolean {
  return this.expiresAt ? new Date() > this.expiresAt : false;
};

ProxyKeySchema.methods.isOverBudget = function (): boolean {
  if (this.budgetLimit && this.usageStats.totalCost >= this.budgetLimit) {
    return true;
  }
  if (
    this.dailyBudgetLimit &&
    this.usageStats.dailyCost >= this.dailyBudgetLimit
  ) {
    return true;
  }
  if (
    this.monthlyBudgetLimit &&
    this.usageStats.monthlyCost >= this.monthlyBudgetLimit
  ) {
    return true;
  }
  return false;
};

ProxyKeySchema.methods.canBeUsedBy = function (userId: string): boolean {
  // Owner can always use
  if (this.userId === userId) {
    return true;
  }

  // Check if shared with user
  return this.sharedWith?.includes(userId) || false;
};

ProxyKeySchema.methods.canAccessProject = function (
  projectId: string,
): boolean {
  // No project restriction
  if (!this.projectId && !this.assignedProjects?.length) {
    return true;
  }

  // Specific project access
  if (this.projectId === projectId) {
    return true;
  }

  // Multiple project access
  return this.assignedProjects?.includes(projectId) || false;
};
