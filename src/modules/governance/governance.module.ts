import { Module, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AgentIdentity,
  AgentIdentitySchema,
} from './schemas/agent-identity.schema';
import {
  AgentDecisionAudit,
  AgentDecisionAuditSchema,
} from './schemas/agent-decision-audit.schema';
import { AgentIdentityService } from './services/agent-identity.service';
import { AgentDecisionAuditService } from './services/agent-decision-audit.service';
import { AgentRateLimitService } from './services/agent-rate-limit.service';
import { setGovernanceModuleRef } from './index';

/**
 * Governance Module
 * Provides agent identity management, decision auditing, and governance controls
 * Implements Zero Trust, Principle of Least Privilege, and comprehensive audit trails
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AgentIdentity.name, schema: AgentIdentitySchema },
      { name: AgentDecisionAudit.name, schema: AgentDecisionAuditSchema },
    ]),
  ],
  providers: [
    AgentIdentityService,
    AgentDecisionAuditService,
    AgentRateLimitService,
  ],
  exports: [
    AgentIdentityService,
    AgentDecisionAuditService,
    AgentRateLimitService,
  ],
})
export class GovernanceModule implements OnModuleInit {
  constructor(private moduleRef: ModuleRef) {}

  onModuleInit() {
    // Set the module reference for governance functions
    setGovernanceModuleRef(this.moduleRef);
  }
}
