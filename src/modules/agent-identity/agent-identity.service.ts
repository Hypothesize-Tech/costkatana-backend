import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as ipaddr from 'ipaddr.js';
import { AgentIdentity } from '../../schemas/agent/agent-identity.schema';
import { User } from '../../schemas/user/user.schema';
import { EncryptionService } from '../../utils/encryption';

@Injectable()
export class AgentIdentityService {
  private readonly logger = new Logger(AgentIdentityService.name);

  constructor(
    @InjectModel(AgentIdentity.name)
    private agentIdentityModel: Model<AgentIdentity>,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {}

  /**
   * Authenticate agent by token
   */
  async authenticateAgent(
    token: string,
    clientIP?: string,
  ): Promise<AgentIdentity | null> {
    try {
      // Validate token format
      if (!token || typeof token !== 'string') {
        this.logger.warn('Invalid token format provided', {
          tokenLength: token?.length || 0,
          tokenType: typeof token,
        });
        return null;
      }

      // Split token into prefix and actual token
      const tokenParts = token.split('.');
      if (tokenParts.length !== 2) {
        this.logger.warn(
          'Token does not follow expected format: prefix.token',
          {
            tokenParts: tokenParts.length,
            tokenPreview: token.substring(0, 20) + '...',
          },
        );
        return null;
      }

      const [tokenPrefix, tokenValue] = tokenParts;

      // Validate token components
      if (!tokenPrefix || !tokenValue) {
        this.logger.warn('Token prefix or value is empty', {
          hasPrefix: !!tokenPrefix,
          hasValue: !!tokenValue,
        });
        return null;
      }

      // Hash the token for comparison
      const tokenHash = EncryptionService.hash256(tokenValue);

      this.logger.debug('Attempting agent authentication', {
        tokenPrefix,
        tokenHashPreview: tokenHash.substring(0, 10) + '...',
      });

      // Find agent by token hash and prefix
      const agent = await this.agentIdentityModel
        .findOne({
          tokenHash,
          tokenPrefix,
          status: 'active',
        })
        .exec();

      if (!agent) {
        this.logger.warn('Agent not found or inactive', {
          tokenPrefix,
          tokenHashPreview: tokenHash.substring(0, 10) + '...',
        });
        return null;
      }

      // Check if agent is expired
      if (agent.isExpired()) {
        this.logger.warn('Agent token is expired', {
          agentId: agent.agentId,
          expiresAt: agent.expiresAt,
          tokenPrefix,
        });
        return null;
      }

      // Check IP restrictions if configured
      if (clientIP && agent.ipWhitelist && agent.ipWhitelist.length > 0) {
        const isIPAllowed = this.isIPAllowed(clientIP, agent.ipWhitelist);
        if (!isIPAllowed) {
          this.logger.warn(
            'Agent authentication failed - IP not in whitelist',
            {
              agentId: agent.agentId,
              clientIP,
              whitelist: agent.ipWhitelist,
            },
          );
          return null;
        }
      }

      // Update last used timestamp
      agent.lastUsedAt = new Date();
      await agent.save();

      this.logger.log('Agent authenticated successfully', {
        agentId: agent.agentId,
        agentName: agent.agentName,
        agentType: agent.agentType,
        userId: (agent.userId as unknown as Types.ObjectId).toString(),
        tokenPrefix,
      });

      return agent;
    } catch (error) {
      this.logger.error('Error authenticating agent', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tokenLength: token?.length || 0,
        tokenPreview: token?.substring(0, 10) + '...' || 'undefined',
      });
      return null;
    }
  }

  /**
   * Get user by agent ID
   */
  async getUserByAgentId(agentId: string): Promise<User | null> {
    try {
      // Validate agent ID
      if (!agentId || typeof agentId !== 'string') {
        this.logger.warn('Invalid agent ID provided', {
          agentId,
          agentIdType: typeof agentId,
        });
        return null;
      }

      this.logger.debug('Looking up user by agent ID', { agentId });

      // Find agent and populate user information
      const agent = await this.agentIdentityModel
        .findOne({
          agentId,
          status: 'active',
        })
        .exec();

      if (!agent) {
        this.logger.warn('Agent not found or inactive', { agentId });
        return null;
      }

      // Check if agent is expired
      if (agent.isExpired()) {
        this.logger.warn('Agent is expired', {
          agentId,
          expiresAt: agent.expiresAt,
        });
        return null;
      }

      // Fetch user information
      const user = await this.userModel.findById(agent.userId).exec();

      if (!user) {
        this.logger.error('User not found for agent', {
          agentId,
          userId: (agent.userId as unknown as Types.ObjectId).toString(),
        });
        return null;
      }

      this.logger.log('Successfully retrieved user for agent', {
        agentId,
        agentName: agent.agentName,
        userId: user._id.toString(),
        userEmail: user.email,
      });

      return user;
    } catch (error) {
      this.logger.error('Error getting user by agent ID', {
        error: error instanceof Error ? error.message : 'Unknown error',
        agentId,
      });
      return null;
    }
  }

  /**
   * Check if an IP address is allowed based on whitelist (single IPs or CIDR).
   * Uses ipaddr.js for IPv4/IPv6 CIDR and single-IP checks.
   */
  private isIPAllowed(clientIP: string, whitelist: string[]): boolean {
    if (!whitelist.length) return false;

    let clientAddr: ipaddr.IPv4 | ipaddr.IPv6;
    try {
      clientAddr = ipaddr.process(clientIP);
    } catch {
      this.logger.warn('Invalid client IP for whitelist check', { clientIP });
      return false;
    }

    for (const entry of whitelist) {
      const trimmed = entry?.trim();
      if (!trimmed) continue;

      try {
        if (trimmed.includes('/')) {
          const [rangeAddr, prefixLength] = ipaddr.parseCIDR(trimmed);
          if (clientAddr.kind() === rangeAddr.kind()) {
            if (clientAddr.kind() === 'ipv4') {
              if (
                (clientAddr as ipaddr.IPv4).match(
                  rangeAddr as ipaddr.IPv4,
                  prefixLength,
                )
              ) {
                return true;
              }
            } else {
              if (
                (clientAddr as ipaddr.IPv6).match(
                  rangeAddr as ipaddr.IPv6,
                  prefixLength,
                )
              ) {
                return true;
              }
            }
          }
        } else {
          const allowedAddr = ipaddr.process(trimmed);
          if (
            clientAddr.kind() === allowedAddr.kind() &&
            clientAddr.toString() === allowedAddr.toString()
          ) {
            return true;
          }
        }
      } catch (error) {
        this.logger.warn('Invalid whitelist entry, skipping', {
          entry: trimmed,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return false;
  }
}
