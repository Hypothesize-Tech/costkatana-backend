/**
 * Compatibility barrel for @models path alias.
 * Re-exports from schema paths for backward compatibility with test mocks.
 * Prefer importing directly from schema files (e.g. schemas/user/user.schema).
 */
export { User } from './user/user.schema';
export { Project } from './team-project/project.schema';
export { Integration } from './integration/integration.schema';
export { Alert } from './core/alert.schema';
export { Session } from './misc/session.schema';
export { Subscription } from './core/subscription.schema';
export { Usage } from './core/usage.schema';
export { Optimization } from './core/optimization.schema';
export { MongoDBConnection } from './integration/mongodb-connection.schema';
export { Telemetry } from './core/telemetry.schema';
export { Document } from './document/document.schema';
export { Document as DocumentModel } from './document/document.schema';
export { Conversation } from './chat/conversation.schema';
export { ChatMessage } from './chat/chat-message.schema';
