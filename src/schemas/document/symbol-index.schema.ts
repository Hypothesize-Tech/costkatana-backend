import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export interface ISymbolReference {
  filePath: string;
  lineNumber: number;
  context: string;
  isDefinition: boolean;
}

export interface ISymbolRelation {
  relatedSymbol: string;
  relationType: 'inherits' | 'implements' | 'uses' | 'calls' | 'imports';
  confidence: number;
}

export type SymbolIndexDocument = HydratedDocument<SymbolIndex>;

@Schema({ timestamps: true, collection: 'symbol_indexes' })
export class SymbolIndex {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  repositoryId: string;

  @Prop({ required: true })
  symbolName: string;

  @Prop({ required: true })
  symbolType:
    | 'function'
    | 'class'
    | 'variable'
    | 'method'
    | 'interface'
    | 'type'
    | 'constant';

  @Prop({ required: true })
  filePath: string;

  @Prop({ required: true })
  lineNumber: number;

  @Prop()
  language?: string;

  @Prop()
  signature?: string;

  @Prop()
  documentation?: string;

  @Prop([
    {
      filePath: { type: String, required: true },
      lineNumber: { type: Number, required: true },
      context: { type: String, required: true },
      isDefinition: { type: Boolean, default: false },
    },
  ])
  references: ISymbolReference[];

  @Prop([
    {
      relatedSymbol: { type: String, required: true },
      relationType: {
        type: String,
        enum: ['inherits', 'implements', 'uses', 'calls', 'imports'],
        required: true,
      },
      confidence: { type: Number, required: true, min: 0, max: 1 },
    },
  ])
  relations: ISymbolRelation[];

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const SymbolIndexSchema = SchemaFactory.createForClass(SymbolIndex);

// Indexes
SymbolIndexSchema.index({ userId: 1, repositoryId: 1 });
SymbolIndexSchema.index({ symbolName: 1, symbolType: 1 });
SymbolIndexSchema.index({ filePath: 1, lineNumber: 1 });
