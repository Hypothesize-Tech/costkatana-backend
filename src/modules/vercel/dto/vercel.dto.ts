import { z } from 'zod';

// Deployment options schema
export const deploymentOptionsSchema = z.object({
  gitSource: z
    .object({
      ref: z.string().optional(),
      repoId: z.string().optional(),
      type: z.enum(['github', 'gitlab', 'bitbucket']).optional(),
    })
    .optional(),
  target: z.enum(['production', 'preview']).optional(),
  name: z.string().optional(),
});
export type DeploymentOptionsDto = z.infer<typeof deploymentOptionsSchema>;

// Trigger deployment schema
export const triggerDeploymentSchema = deploymentOptionsSchema;
export type TriggerDeploymentDto = z.infer<typeof triggerDeploymentSchema>;

// Rollback deployment schema
export const rollbackDeploymentSchema = z.object({
  projectId: z.string(),
});
export type RollbackDeploymentDto = z.infer<typeof rollbackDeploymentSchema>;

// Add domain schema
export const addDomainSchema = z.object({
  domain: z.string().min(1).trim(),
});
export type AddDomainDto = z.infer<typeof addDomainSchema>;

// Environment variable schema
export const envVarTargetSchema = z
  .array(z.enum(['production', 'preview', 'development']))
  .min(1);
export const envVarTypeSchema = z.enum([
  'plain',
  'secret',
  'encrypted',
  'system',
]);

export const setEnvVarSchema = z.object({
  key: z.string().min(1).trim(),
  value: z.string(),
  target: envVarTargetSchema.default(['production', 'preview', 'development']),
  type: envVarTypeSchema.default('encrypted'),
});
export type SetEnvVarDto = z.infer<typeof setEnvVarSchema>;

// Query parameter schemas
export const refreshQuerySchema = z.object({
  refresh: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
});
export type RefreshQueryDto = z.infer<typeof refreshQuerySchema>;

export const limitQuerySchema = z.object({
  limit: z
    .string()
    .transform((val) => Math.min(parseInt(val) || 20, 100))
    .optional(),
});
export type LimitQueryDto = z.infer<typeof limitQuerySchema>;

// Parameter schemas
export const connectionIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid connection ID format'),
});
export type ConnectionIdParamDto = z.infer<typeof connectionIdParamSchema>;

export const projectIdParamSchema = z.object({
  projectId: z.string().min(1),
});
export type ProjectIdParamDto = z.infer<typeof projectIdParamSchema>;

export const deploymentIdParamSchema = z.object({
  deploymentId: z.string().min(1),
});
export type DeploymentIdParamDto = z.infer<typeof deploymentIdParamSchema>;

export const envVarIdParamSchema = z.object({
  envVarId: z.string().min(1),
});
export type EnvVarIdParamDto = z.infer<typeof envVarIdParamSchema>;

export const domainParamSchema = z.object({
  domain: z.string().min(1).trim(),
});
export type DomainParamDto = z.infer<typeof domainParamSchema>;

// Response DTOs (for documentation, not validation)

// OAuth initiation response
export interface OAuthInitiateResponseDto {
  success: true;
  data: { authUrl: string };
}

// Connection list response
export interface ConnectionListResponseDto {
  success: true;
  data: VercelConnectionResponseDto[];
}

// Connection response
export interface VercelConnectionResponseDto {
  _id: string;
  userId: string;
  name: string;
  status: 'active' | 'inactive' | 'error' | 'pending_verification';
  vercelUserId?: string;
  vercelUsername?: string;
  vercelEmail?: string;
  avatarUrl?: string;
  teamId?: string;
  teamSlug?: string;
  teamName?: string;
  team?: {
    id: string;
    slug: string;
    name: string;
    avatar?: string;
  };
  projects: VercelProjectResponseDto[];
  isActive: boolean;
  lastSyncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Project response
export interface VercelProjectResponseDto {
  id: string;
  name: string;
  framework?: string;
  latestDeployment?: {
    id: string;
    url: string;
    state:
      | 'BUILDING'
      | 'ERROR'
      | 'INITIALIZING'
      | 'QUEUED'
      | 'READY'
      | 'CANCELED';
    createdAt: Date;
  };
  targets?: {
    production?: {
      url: string;
    };
  };
  createdAt?: Date;
  updatedAt?: Date;
}

// Deployment response
export interface VercelDeploymentResponseDto {
  uid: string;
  name: string;
  url: string;
  state:
    | 'BUILDING'
    | 'ERROR'
    | 'INITIALIZING'
    | 'QUEUED'
    | 'READY'
    | 'CANCELED';
  readyState?: string;
  createdAt: number;
  buildingAt?: number;
  ready?: number;
  meta?: {
    githubCommitRef?: string;
    githubCommitSha?: string;
    githubCommitMessage?: string;
  };
  target?: 'production' | 'preview';
  creator?: {
    uid: string;
    username: string;
  };
}

// Domain response
export interface VercelDomainResponseDto {
  name: string;
  apexName: string;
  projectId: string;
  verified: boolean;
  verification?: Array<{
    type: string;
    domain: string;
    value: string;
  }>;
  createdAt: number;
  updatedAt: number;
}

// Environment variable response
export interface VercelEnvVarResponseDto {
  id: string;
  key: string;
  type: 'plain' | 'secret' | 'encrypted' | 'system';
  target: Array<'production' | 'preview' | 'development'>;
  createdAt: number;
  updatedAt: number;
  // Note: value is never returned for security
}

// Generic success response
export interface VercelSuccessResponseDto {
  success: true;
  data: any;
}

// Generic message response
export interface VercelMessageResponseDto {
  success: true;
  message: string;
}

// Projects list response
export interface VercelProjectsResponseDto {
  success: true;
  data: VercelProjectResponseDto[];
}

// Project details response
export interface VercelProjectDetailResponseDto {
  success: true;
  data: VercelProjectResponseDto;
}

// Deployments list response
export interface VercelDeploymentsResponseDto {
  success: true;
  data: VercelDeploymentResponseDto[];
}

// Deployment logs response
export interface VercelDeploymentLogsResponseDto {
  success: true;
  data: string[];
}

// Domains list response
export interface VercelDomainsResponseDto {
  success: true;
  data: VercelDomainResponseDto[];
}

// Environment variables list response
export interface VercelEnvVarsResponseDto {
  success: true;
  data: VercelEnvVarResponseDto[];
}

// Environment variable set response
export interface VercelEnvVarSetResponseDto {
  success: true;
  data: VercelEnvVarResponseDto;
}
