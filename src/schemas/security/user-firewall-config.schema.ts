import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type UserFirewallConfigDocument = HydratedDocument<UserFirewallConfig>;

@Schema({ timestamps: true, collection: 'user_firewall_configs' })
export class UserFirewallConfig {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, default: true })
  enableBasicFirewall: boolean;

  @Prop({ required: true, default: true })
  enableAdvancedFirewall: boolean;

  @Prop({ required: true, default: true })
  enableRAGSecurity: boolean;

  @Prop({ required: true, default: true })
  enableToolSecurity: boolean;

  @Prop({ required: true, default: 0.5 })
  promptGuardThreshold: number;

  @Prop({ required: true, default: 0.8 })
  openaiSafeguardThreshold: number;

  @Prop({ required: true, default: 0.6 })
  ragSecurityThreshold: number;

  @Prop({ required: true, default: 0.7 })
  toolSecurityThreshold: number;

  @Prop({ required: true, default: true })
  sandboxHighRisk: boolean;

  @Prop({ required: true, default: false })
  requireHumanApproval: boolean;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const UserFirewallConfigSchema =
  SchemaFactory.createForClass(UserFirewallConfig);

UserFirewallConfigSchema.index({ userId: 1 });
