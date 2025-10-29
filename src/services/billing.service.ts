import { Workspace } from '../models/Workspace';
import { TeamMember } from '../models/TeamMember';
import { loggingService } from './logging.service';
import { AppError } from '../middleware/error.middleware';
import { ObjectId } from 'mongoose';

export class BillingService {
  /**
   * Calculate total seats used in a workspace
   */
  static async calculateSeatsUsed(workspaceId: string | ObjectId): Promise<number> {
    try {
      const activeMembers = await TeamMember.countDocuments({
        workspaceId,
        status: { $in: ['active', 'invited'] },
      });
      return activeMembers;
    } catch (error) {
      loggingService.error('Error calculating seats used', { error, workspaceId });
      throw error;
    }
  }

  /**
   * Get available seats in workspace
   */
  static async getAvailableSeats(workspaceId: string | ObjectId): Promise<{
    total: number;
    used: number;
    available: number;
  }> {
    try {
      const workspace = await Workspace.findById(workspaceId);
      if (!workspace) {
        throw new AppError('Workspace not found', 404);
      }

      const totalSeats = workspace.billing.seatsIncluded + workspace.billing.additionalSeats;
      const usedSeats = await this.calculateSeatsUsed(workspaceId);
      const availableSeats = Math.max(0, totalSeats - usedSeats);

      return {
        total: totalSeats,
        used: usedSeats,
        available: availableSeats,
      };
    } catch (error) {
      loggingService.error('Error getting available seats', { error, workspaceId });
      throw error;
    }
  }

  /**
   * Check if workspace can add new members
   */
  static async canAddMembers(workspaceId: string | ObjectId, count: number = 1): Promise<boolean> {
    try {
      const seats = await this.getAvailableSeats(workspaceId);
      return seats.available >= count;
    } catch (error) {
      loggingService.error('Error checking if can add members', { error, workspaceId, count });
      return false;
    }
  }

  /**
   * Add additional seats to workspace
   */
  static async addSeats(
    workspaceId: string | ObjectId,
    numberOfSeats: number,
    userId: string | ObjectId
  ): Promise<void> {
    try {
      const workspace = await Workspace.findById(workspaceId);
      if (!workspace) {
        throw new AppError('Workspace not found', 404);
      }

      workspace.billing.additionalSeats += numberOfSeats;
      await workspace.save();

      // Calculate new billing amount
      const newMonthlyCost = this.calculateMonthlyCost(workspace.billing);

      loggingService.info('Additional seats added', {
        workspaceId,
        seatsAdded: numberOfSeats,
        totalSeats: workspace.billing.seatsIncluded + workspace.billing.additionalSeats,
        newMonthlyCost,
        userId: typeof userId === 'string' ? userId : userId?.toString(),
      });

      // TODO: Integrate with payment processor to charge for additional seats
    } catch (error) {
      loggingService.error('Error adding seats', { error, workspaceId, numberOfSeats });
      throw error;
    }
  }

  /**
   * Remove seats from workspace
   */
  static async removeSeats(
    workspaceId: string | ObjectId,
    numberOfSeats: number,
    userId: string | ObjectId
  ): Promise<void> {
    try {
      const workspace = await Workspace.findById(workspaceId);
      if (!workspace) {
        throw new AppError('Workspace not found', 404);
      }

      const usedSeats = await this.calculateSeatsUsed(workspaceId);
      const minRequiredSeats = Math.max(1, usedSeats); // At least 1 seat or current usage
      const newAdditionalSeats = Math.max(0, workspace.billing.additionalSeats - numberOfSeats);
      const newTotalSeats = workspace.billing.seatsIncluded + newAdditionalSeats;

      if (newTotalSeats < minRequiredSeats) {
        throw new AppError(
          `Cannot reduce seats below current usage (${usedSeats} members). Remove members first.`,
          400
        );
      }

      workspace.billing.additionalSeats = newAdditionalSeats;
      await workspace.save();

      loggingService.info('Seats removed', {
        workspaceId,
        seatsRemoved: numberOfSeats,
        totalSeats: newTotalSeats,
        userId: typeof userId === 'string' ? userId : userId?.toString(),
      });

      // TODO: Process refund or credit for removed seats
    } catch (error) {
      loggingService.error('Error removing seats', { error, workspaceId, numberOfSeats });
      throw error;
    }
  }

  /**
   * Calculate monthly cost for workspace
   */
  static calculateMonthlyCost(billing: {
    seatsIncluded: number;
    additionalSeats: number;
    pricePerSeat: number;
    billingCycle: 'monthly' | 'yearly';
  }): number {
    const additionalSeatsCost = billing.additionalSeats * billing.pricePerSeat;
    
    // Apply discount for yearly billing (e.g., 20% off)
    if (billing.billingCycle === 'yearly') {
      return additionalSeatsCost * 12 * 0.8; // 20% discount
    }
    
    return additionalSeatsCost;
  }

  /**
   * Get billing summary for workspace
   */
  static async getBillingSummary(workspaceId: string | ObjectId): Promise<{
    seats: {
      included: number;
      additional: number;
      total: number;
      used: number;
      available: number;
    };
    costs: {
      pricePerSeat: number;
      additionalSeatsCost: number;
      totalMonthlyCost: number;
      billingCycle: 'monthly' | 'yearly';
    };
    nextBillingDate?: Date;
  }> {
    try {
      const workspace = await Workspace.findById(workspaceId);
      if (!workspace) {
        throw new AppError('Workspace not found', 404);
      }

      const seatsInfo = await this.getAvailableSeats(workspaceId);
      const monthlyCost = this.calculateMonthlyCost(workspace.billing);
      const additionalSeatsCost = workspace.billing.additionalSeats * workspace.billing.pricePerSeat;

      return {
        seats: {
          included: workspace.billing.seatsIncluded,
          additional: workspace.billing.additionalSeats,
          total: seatsInfo.total,
          used: seatsInfo.used,
          available: seatsInfo.available,
        },
        costs: {
          pricePerSeat: workspace.billing.pricePerSeat,
          additionalSeatsCost,
          totalMonthlyCost: monthlyCost,
          billingCycle: workspace.billing.billingCycle,
        },
      };
    } catch (error) {
      loggingService.error('Error getting billing summary', { error, workspaceId });
      throw error;
    }
  }

  /**
   * Prorate charges for mid-cycle seat additions
   */
  static calculateProratedCharge(
    pricePerSeat: number,
    billingCycle: 'monthly' | 'yearly',
    daysRemaining: number
  ): number {
    const daysInCycle = billingCycle === 'monthly' ? 30 : 365;
    const pricePerDay = pricePerSeat / daysInCycle;
    return pricePerDay * daysRemaining;
  }

  /**
   * Update workspace billing cycle
   */
  static async updateBillingCycle(
    workspaceId: string | ObjectId,
    billingCycle: 'monthly' | 'yearly',
    userId: string | ObjectId
  ): Promise<void> {
    try {
      const workspace = await Workspace.findById(workspaceId);
      if (!workspace) {
        throw new AppError('Workspace not found', 404);
      }

      workspace.billing.billingCycle = billingCycle;
      await workspace.save();

      loggingService.info('Billing cycle updated', {
        workspaceId,
        newBillingCycle: billingCycle,
        userId: typeof userId === 'string' ? userId : userId?.toString(),
      });
    } catch (error) {
      loggingService.error('Error updating billing cycle', { error, workspaceId });
      throw error;
    }
  }

  /**
   * Check seat limits before adding member
   */
  static async validateSeatAvailability(workspaceId: string | ObjectId): Promise<void> {
    const canAdd = await this.canAddMembers(workspaceId, 1);
    if (!canAdd) {
      const seats = await this.getAvailableSeats(workspaceId);
      throw new AppError(
        `No available seats. Currently using ${seats.used} of ${seats.total} seats. Please upgrade your plan.`,
        400
      );
    }
  }

  /**
   * Get workspace owner for billing purposes
   */
  static async getWorkspaceOwner(workspaceId: string | ObjectId): Promise<any> {
    try {
      const workspace = await Workspace.findById(workspaceId).populate('ownerId', 'email name');
      if (!workspace) {
        throw new AppError('Workspace not found', 404);
      }
      return workspace.ownerId;
    } catch (error) {
      loggingService.error('Error getting workspace owner', { error, workspaceId });
      throw error;
    }
  }
}

export const billingService = BillingService;

