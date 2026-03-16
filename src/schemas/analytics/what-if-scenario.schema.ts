import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface IScenarioChange {
  type:
    | 'model_switch'
    | 'volume_change'
    | 'feature_addition'
    | 'optimization_applied';
  currentValue: any;
  proposedValue: any;
  affectedMetrics: string[];
  description: string;
}

export interface IBaselineData {
  cost: number;
  volume: number;
  performance: number;
}

export interface ISavingsOpportunity {
  category: string;
  savings: number;
  effort: 'low' | 'medium' | 'high';
}

export interface IProjectedImpact {
  costChange: number;
  costChangePercentage: number;
  performanceChange: number;
  performanceChangePercentage: number;
  riskLevel: 'low' | 'medium' | 'high';
  confidence: number;
}

export interface IScenarioBreakdown {
  currentCosts: Record<string, number>;
  projectedCosts: Record<string, number>;
  savingsOpportunities: ISavingsOpportunity[];
}

export interface IScenarioAnalysis {
  projectedImpact: IProjectedImpact;
  breakdown: IScenarioBreakdown;
  recommendations: string[];
  warnings: string[];
  aiInsights?: string[];
}

export type WhatIfScenarioDocument = HydratedDocument<WhatIfScenario>;

@Schema({ timestamps: true })
export class WhatIfScenario {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  description: string;

  @Prop([
    {
      type: {
        type: String,
        enum: [
          'model_switch',
          'volume_change',
          'feature_addition',
          'optimization_applied',
        ],
        required: true,
      },
      currentValue: mongoose.Schema.Types.Mixed,
      proposedValue: mongoose.Schema.Types.Mixed,
      affectedMetrics: [String],
      description: String,
    },
  ])
  changes: IScenarioChange[];

  @Prop({
    type: String,
    enum: ['daily', 'weekly', 'monthly', 'yearly'],
    required: true,
  })
  timeframe: 'daily' | 'weekly' | 'monthly' | 'yearly';

  @Prop({
    type: {
      cost: { type: Number, required: true },
      volume: { type: Number, required: true },
      performance: { type: Number, required: true },
    },
  })
  baselineData: IBaselineData;

  @Prop({
    type: {
      projectedImpact: {
        costChange: Number,
        costChangePercentage: Number,
        performanceChange: Number,
        performanceChangePercentage: Number,
        riskLevel: {
          type: String,
          enum: ['low', 'medium', 'high'],
        },
        confidence: Number,
      },
      breakdown: {
        currentCosts: mongoose.Schema.Types.Mixed,
        projectedCosts: mongoose.Schema.Types.Mixed,
        savingsOpportunities: [
          {
            category: String,
            savings: Number,
            effort: {
              type: String,
              enum: ['low', 'medium', 'high'],
            },
          },
        ],
      },
      recommendations: [String],
      warnings: [String],
      aiInsights: [String],
    },
  })
  analysis?: IScenarioAnalysis;

  @Prop({
    type: String,
    enum: ['created', 'analyzed', 'applied'],
    default: 'created',
  })
  status: 'created' | 'analyzed' | 'applied';

  @Prop({ type: Boolean, default: true })
  isUserCreated: boolean;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const WhatIfScenarioSchema =
  SchemaFactory.createForClass(WhatIfScenario);

// Compound index to ensure unique names per user
WhatIfScenarioSchema.index({ userId: 1, name: 1 }, { unique: true });

// Indexes for efficient querying
WhatIfScenarioSchema.index({ userId: 1, createdAt: -1 });
WhatIfScenarioSchema.index({ userId: 1, status: 1 });
WhatIfScenarioSchema.index({ userId: 1, isUserCreated: 1 });
