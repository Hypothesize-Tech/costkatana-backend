import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  GovernancePolicy,
  GovernancePolicyDocument,
} from '../schemas/governance-policy.schema';

export interface StoredPolicies {
  agentPolicies: any[];
  auditRules: any[];
}

@Injectable()
export class GovernancePolicyStoreService {
  private readonly logger = new Logger(GovernancePolicyStoreService.name);
  private static readonly DEFAULT_POLICY_SET_ID = 'default';

  constructor(
    @InjectModel(GovernancePolicy.name)
    private readonly policyModel: Model<GovernancePolicyDocument>,
  ) {}

  /**
   * Load policies from persistent store. Returns null when store is empty.
   */
  async loadPolicies(): Promise<StoredPolicies | null> {
    try {
      const doc = await this.policyModel
        .findOne({
          policySetId: GovernancePolicyStoreService.DEFAULT_POLICY_SET_ID,
        })
        .lean()
        .exec();

      if (!doc || !doc.agentPolicies?.length) {
        return null;
      }

      this.logger.debug(
        `Loaded ${doc.agentPolicies.length} agent policies and ${doc.auditRules?.length ?? 0} audit rules from store`,
      );

      return {
        agentPolicies: doc.agentPolicies ?? [],
        auditRules: doc.auditRules ?? [],
      };
    } catch (error) {
      this.logger.warn('Failed to load policies from store', { error });
      return null;
    }
  }

  /**
   * Persist policies to the store.
   */
  async savePolicies(policies: StoredPolicies): Promise<void> {
    try {
      await this.policyModel
        .findOneAndUpdate(
          {
            policySetId: GovernancePolicyStoreService.DEFAULT_POLICY_SET_ID,
          },
          {
            $set: {
              agentPolicies: policies.agentPolicies,
              auditRules: policies.auditRules,
              updatedAt: new Date(),
            },
          },
          {
            upsert: true,
            new: true,
          },
        )
        .exec();

      this.logger.debug(
        `Saved ${policies.agentPolicies.length} agent policies and ${policies.auditRules.length} audit rules to store`,
      );
    } catch (error) {
      this.logger.error('Failed to save policies to store', { error });
    }
  }

  /**
   * Check if the store has any policies.
   */
  async hasPolicies(): Promise<boolean> {
    const doc = await this.policyModel
      .findOne(
        { policySetId: GovernancePolicyStoreService.DEFAULT_POLICY_SET_ID },
        { agentPolicies: 1, auditRules: 1 },
      )
      .lean()
      .exec();
    return !!(doc?.agentPolicies?.length || doc?.auditRules?.length);
  }
}
