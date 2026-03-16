import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export interface IRepoMetadata {
  fullName: string;
  owner: string;
  name: string;
  language?: string;
  framework?: string;
  packageManager?: string;
  lastIndexedAt: Date;
  commitSha?: string;
  branch?: string;
}

export interface ISharedUtilityReference {
  name: string;
  filePath: string;
  repoFullName: string;
  type: 'function' | 'class' | 'module' | 'utility';
  signature?: string;
  usedInRepos: string[];
  similarityScore?: number;
}

export interface ICrossRepoDependency {
  fromRepo: string;
  toRepo: string;
  type: 'package' | 'module' | 'shared-code' | 'monorepo';
  dependencyName?: string;
  version?: string;
}

export type MultiRepoIndexDocument = HydratedDocument<MultiRepoIndex>;

@Schema({ timestamps: true, collection: 'multi_repo_indexes' })
export class MultiRepoIndex {
  @Prop({ required: true })
  userId: string;

  @Prop([
    {
      fullName: { type: String, required: true },
      owner: { type: String, required: true },
      name: { type: String, required: true },
      language: String,
      framework: String,
      packageManager: String,
      lastIndexedAt: { type: Date, required: true },
      commitSha: String,
      branch: String,
    },
  ])
  repositories: IRepoMetadata[];

  @Prop([
    {
      name: { type: String, required: true },
      filePath: { type: String, required: true },
      repoFullName: { type: String, required: true },
      type: {
        type: String,
        enum: ['function', 'class', 'module', 'utility'],
        required: true,
      },
      signature: String,
      usedInRepos: [{ type: String, required: true }],
      similarityScore: Number,
    },
  ])
  sharedUtilities: ISharedUtilityReference[];

  @Prop([
    {
      fromRepo: { type: String, required: true },
      toRepo: { type: String, required: true },
      type: {
        type: String,
        enum: ['package', 'module', 'shared-code', 'monorepo'],
        required: true,
      },
      dependencyName: String,
      version: String,
    },
  ])
  crossRepoDependencies: ICrossRepoDependency[];

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const MultiRepoIndexSchema =
  SchemaFactory.createForClass(MultiRepoIndex);

// Indexes
MultiRepoIndexSchema.index({ userId: 1, isActive: 1 });
MultiRepoIndexSchema.index({ 'repositories.fullName': 1 });
