import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RootOfTrustDocument = RootOfTrust & Document;

@Schema({
  timestamps: true,
  collection: 'root_of_trust',
})
export class RootOfTrust {
  @Prop({ required: true })
  anchorId: string;

  @Prop({ required: true })
  hash: string;

  @Prop({ required: true, type: Date })
  createdAt: Date;

  // Ensure only one root of trust exists
  @Prop({ type: Boolean, default: true, unique: true })
  isRoot: boolean;
}

export const RootOfTrustSchema = SchemaFactory.createForClass(RootOfTrust);

// Ensure only one root of trust document exists (isRoot unique index created by @Prop)
