import { AgentQueryDto } from './agent-query.dto';

/**
 * DTO for agent stream requests (POST /api/agent/stream)
 * Same validation as AgentQueryDto
 */
export class AgentStreamDto extends AgentQueryDto {}
