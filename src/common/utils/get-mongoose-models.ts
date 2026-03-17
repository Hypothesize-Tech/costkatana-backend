/**
 * Mongoose Model Getters
 *
 * Use these when you need Mongoose model methods (findOne, findById, etc.) outside of
 * NestJS DI context (middleware, standalone tools, etc.). Models are registered at
 * runtime via MongooseModule.forFeature in SchemasModule.
 */

import mongoose, { Model } from 'mongoose';

// User & Auth
import { User, UserSchema } from '../../schemas/user/user.schema';
import { UserSession, UserSessionSchema } from '../../schemas/user/user-session.schema';
import {
  UserApprovalRequest,
  UserApprovalRequestSchema,
} from '../../schemas/user/user-approval-request.schema';

// Project & Team
import { Project, ProjectSchema } from '../../schemas/team-project/project.schema';

// Core
import { Usage, UsageSchema } from '../../schemas/core/usage.schema';
import { Optimization, OptimizationSchema } from '../../schemas/core/optimization.schema';
import { Subscription, SubscriptionSchema } from '../../schemas/core/subscription.schema';
import { Telemetry, TelemetrySchema } from '../../schemas/core/telemetry.schema';

// Integration
import {
  MongoDBConnection,
  MongoDBConnectionSchema,
} from '../../schemas/integration/mongodb-connection.schema';
import {
  GitHubConnection,
  GitHubConnectionSchema,
} from '../../schemas/integration/github-connection.schema';
import {
  GoogleConnection,
  GoogleConnectionSchema,
} from '../../schemas/integration/google-connection.schema';
import {
  Integration,
  IntegrationSchema,
} from '../../schemas/integration/integration.schema';
import {
  VercelConnection,
  VercelConnectionSchema,
} from '../../schemas/integration/vercel-connection.schema';

// Security
import {
  McpPermission,
  McpPermissionSchema,
} from '../../schemas/security/mcp-permission.schema';
import {
  MongodbMcpAuditLog,
  MongodbMcpAuditLogSchema,
} from '../../schemas/security/mongodb-mcp-audit-log.schema';

function getModel<T>(name: string, schema: mongoose.Schema): Model<T> {
  return (mongoose.models[name] as Model<T>) ?? (mongoose.model<T>(name, schema) as Model<T>);
}

export const getUserModel = () => getModel<User>(User.name, UserSchema);
export const getUserSessionModel = () => getModel<UserSession>(UserSession.name, UserSessionSchema);
export const getUserApprovalRequestModel = () =>
  getModel<UserApprovalRequest>(UserApprovalRequest.name, UserApprovalRequestSchema);
export const getProjectModel = () => getModel<Project>(Project.name, ProjectSchema);
export const getUsageModel = () => getModel<Usage>(Usage.name, UsageSchema);
export const getOptimizationModel = () => getModel<Optimization>(Optimization.name, OptimizationSchema);
export const getSubscriptionModel = () => getModel<Subscription>(Subscription.name, SubscriptionSchema);
export const getTelemetryModel = () => getModel<Telemetry>(Telemetry.name, TelemetrySchema);
export const getMongoDBConnectionModel = () =>
  getModel<MongoDBConnection>(MongoDBConnection.name, MongoDBConnectionSchema);
export const getGitHubConnectionModel = () =>
  getModel<unknown>(GitHubConnection.name, GitHubConnectionSchema);
export const getGoogleConnectionModel = () =>
  getModel<unknown>(GoogleConnection.name, GoogleConnectionSchema);
export const getIntegrationModel = () =>
  getModel<unknown>(Integration.name, IntegrationSchema);
export const getVercelConnectionModel = () =>
  getModel<unknown>(VercelConnection.name, VercelConnectionSchema);
export const getMcpPermissionModel = () =>
  getModel<McpPermission>(McpPermission.name, McpPermissionSchema);
export const getMongodbMcpAuditLogModel = () =>
  getModel<MongodbMcpAuditLog>(MongodbMcpAuditLog.name, MongodbMcpAuditLogSchema);
