import { Workspace, IWorkspace } from '../models/Workspace';
import { TeamMember } from '../models/TeamMember';
import { loggingService } from './logging.service';
import { AppError } from '../middleware/error.middleware';
import { ObjectId } from 'mongoose';
import { SubscriptionService } from './subscription.service';
import { paymentGatewayManager } from './paymentGateway/paymentGatewayManager.service';
import { PaymentMethod } from '../models/PaymentMethod';
import { Invoice } from '../models/Invoice';
import { ISubscription } from '../models/Subscription';

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

      const userIdStr: string = typeof userId === 'string' ? userId : String(userId);
      const workspaceIdStr: string = typeof workspaceId === 'string' ? workspaceId : String(workspaceId);
      loggingService.info('Additional seats added', {
        workspaceId: workspaceIdStr,
        seatsAdded: numberOfSeats,
        totalSeats: workspace.billing.seatsIncluded + workspace.billing.additionalSeats,
        newMonthlyCost,
        userId: userIdStr,
      });

      // Integrate with payment processor to charge for additional seats
      await this.chargeForAdditionalSeats(workspace, numberOfSeats, userId);
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

      const userIdStr: string = typeof userId === 'string' ? userId : String(userId);
      const workspaceIdStr: string = typeof workspaceId === 'string' ? workspaceId : String(workspaceId);
      loggingService.info('Seats removed', {
        workspaceId: workspaceIdStr,
        seatsRemoved: numberOfSeats,
        totalSeats: newTotalSeats,
        userId: userIdStr,
      });

      // Process refund or credit for removed seats
      await this.processSeatRemovalRefund(workspace, numberOfSeats, userId);
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

      const userIdStr: string = typeof userId === 'string' ? userId : String(userId);
      const workspaceIdStr: string = typeof workspaceId === 'string' ? workspaceId : String(workspaceId);
      loggingService.info('Billing cycle updated', {
        workspaceId: workspaceIdStr,
        newBillingCycle: billingCycle,
        userId: userIdStr,
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
  static async getWorkspaceOwner(workspaceId: string | ObjectId): Promise<{ _id: ObjectId; email: string; name: string } | null> {
    try {
      const workspace = await Workspace.findById(workspaceId).populate('ownerId', 'email name');
      if (!workspace) {
        throw new AppError('Workspace not found', 404);
      }
      return (workspace.ownerId as unknown) as { _id: ObjectId; email: string; name: string } | null;
    } catch (error) {
      loggingService.error('Error getting workspace owner', { error, workspaceId });
      throw error;
    }
  }

  /**
   * Charge for additional seats
   * Integrates with payment gateway to charge for additional seats
   */
  private static async chargeForAdditionalSeats(
    workspace: IWorkspace,
    numberOfSeats: number,
    _userId: string | ObjectId
  ): Promise<void> {
    const workspaceIdStr: string = workspace._id ? String(workspace._id) : '';
    try {
      const ownerId = workspace.ownerId;
      if (!ownerId) {
        throw new AppError('Workspace owner not found', 404);
      }

      const ownerIdStr: string = typeof ownerId === 'string' ? ownerId : String(ownerId);

      // Get owner's subscription
      const subscription = await SubscriptionService.getSubscriptionByUserId(ownerId);
      if (!subscription) {
        loggingService.warn('No subscription found for workspace owner, skipping seat charge', {
          workspaceId: workspaceIdStr,
          ownerId: ownerIdStr,
        });
        return;
      }

      const subscriptionIdStr: string = subscription._id ? String(subscription._id) : '';

      // Check if subscription has payment method
      if (!subscription.paymentGateway || !subscription.paymentMethodId) {
        loggingService.warn('No payment method configured for subscription, skipping seat charge', {
          subscriptionId: subscriptionIdStr,
          workspaceId: workspaceIdStr,
        });
        return;
      }

      const paymentMethodIdStr: string = subscription.paymentMethodId 
        ? (typeof subscription.paymentMethodId === 'string' 
          ? subscription.paymentMethodId 
          : String(subscription.paymentMethodId))
        : '';

      // Get payment method
      const paymentMethod = await PaymentMethod.findById(subscription.paymentMethodId);
      if (!paymentMethod || !paymentMethod.isActive) {
        loggingService.warn('Payment method not found or inactive, skipping seat charge', {
          paymentMethodId: paymentMethodIdStr,
          workspaceId: workspaceIdStr,
        });
        return;
      }

      // Calculate prorated charge for additional seats
      const now = new Date();
      const cycleStart = subscription.billing.billingCycleAnchor ?? subscription.startDate;
      const cycleEnd = subscription.billing.nextBillingDate ?? new Date(cycleStart);
      if (workspace.billing.billingCycle === 'monthly') {
        cycleEnd.setMonth(cycleEnd.getMonth() + 1);
      } else {
        cycleEnd.setFullYear(cycleEnd.getFullYear() + 1);
      }

      const daysRemaining = Math.ceil((cycleEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const proratedCharge = this.calculateProratedCharge(
        workspace.billing.pricePerSeat * numberOfSeats,
        workspace.billing.billingCycle,
        daysRemaining
      );

      // Charge the customer
      try {
        const chargeResult = await paymentGatewayManager.charge(subscription.paymentGateway, {
          customerId: paymentMethod.gatewayCustomerId,
          paymentMethodId: paymentMethod.gatewayPaymentMethodId,
          amount: proratedCharge,
          currency: subscription.billing.currency ?? 'USD',
          description: `Additional ${numberOfSeats} seat(s) for workspace - prorated charge`,
          metadata: {
            workspaceId: workspaceIdStr,
            seatsAdded: numberOfSeats,
            prorated: true,
            daysRemaining,
            billingCycle: workspace.billing.billingCycle,
          },
        });

        // Create invoice for the charge
        const invoice = await SubscriptionService.generateInvoice(
          ownerId,
          subscription,
            [
              {
                description: `Additional ${numberOfSeats} seat(s) - Prorated charge (${daysRemaining} days remaining)`,
                quantity: numberOfSeats,
                unitPrice: workspace.billing.pricePerSeat,
                total: proratedCharge,
                type: 'seat' as const,
              },
            ]
        );

        // Update invoice with payment information
        invoice.status = chargeResult.status === 'succeeded' ? 'paid' : 'pending';
        invoice.paymentDate = chargeResult.status === 'succeeded' ? new Date() : undefined;
        invoice.gatewayTransactionId = chargeResult.transactionId;
        invoice.paymentMethodId = paymentMethod._id as ObjectId;
        invoice.paymentGateway = subscription.paymentGateway;
        await invoice.save();

        const invoiceIdStr: string = invoice._id ? String(invoice._id) : '';
        loggingService.info('Additional seats charged successfully', {
          workspaceId: workspaceIdStr,
          seatsAdded: numberOfSeats,
          amount: proratedCharge,
          currency: subscription.billing.currency ?? 'USD',
          invoiceId: invoiceIdStr,
          transactionId: chargeResult.transactionId,
          status: chargeResult.status,
        });
      } catch (chargeError: unknown) {
        const errorMessage = chargeError instanceof Error ? chargeError.message : String(chargeError);
        loggingService.error('Failed to charge for additional seats', {
          workspaceId: workspaceIdStr,
          seatsAdded: numberOfSeats,
          amount: proratedCharge,
          error: errorMessage,
        });
        // Don't throw - allow seats to be added even if charge fails
        // The charge can be retried later or handled through invoice
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggingService.error('Error charging for additional seats', {
        workspaceId: workspaceIdStr,
        error: errorMessage,
      });
      // Don't throw - allow seats to be added even if billing fails
      // This can be handled through manual billing or retry
    }
  }

  /**
   * Process refund or credit for removed seats
   */
  private static async processSeatRemovalRefund(
    workspace: IWorkspace,
    numberOfSeats: number,
    _userId: string | ObjectId
  ): Promise<void> {
    const workspaceIdStr: string = workspace._id ? String(workspace._id) : '';
    try {
      const ownerId = workspace.ownerId;
      if (!ownerId) {
        throw new AppError('Workspace owner not found', 404);
      }

      const ownerIdStr: string = typeof ownerId === 'string' ? ownerId : String(ownerId);

      // Get owner's subscription
      const subscription = await SubscriptionService.getSubscriptionByUserId(ownerId);
      if (!subscription) {
        loggingService.warn('No subscription found for workspace owner, skipping seat refund', {
          workspaceId: workspaceIdStr,
          ownerId: ownerIdStr,
        });
        return;
      }

      const subscriptionIdStr: string = subscription._id ? String(subscription._id) : '';

      // Check if subscription has payment method
      if (!subscription.paymentGateway || !subscription.paymentMethodId) {
        loggingService.warn('No payment method configured for subscription, creating credit invoice only', {
          subscriptionId: subscriptionIdStr,
          workspaceId: workspaceIdStr,
        });
        // Create credit invoice even without payment method
        await this.createSeatRemovalCredit(workspace, numberOfSeats, subscription, ownerId);
        return;
      }

      const paymentMethodIdStr: string = subscription.paymentMethodId 
        ? (typeof subscription.paymentMethodId === 'string' 
          ? subscription.paymentMethodId 
          : String(subscription.paymentMethodId))
        : '';

      // Get payment method
      const paymentMethod = await PaymentMethod.findById(subscription.paymentMethodId);
      if (!paymentMethod || !paymentMethod.isActive) {
        loggingService.warn('Payment method not found or inactive, creating credit invoice only', {
          paymentMethodId: paymentMethodIdStr,
          workspaceId: workspaceIdStr,
        });
        // Create credit invoice even without active payment method
        await this.createSeatRemovalCredit(workspace, numberOfSeats, subscription, ownerId);
        return;
      }

      // Find recent invoices for seat charges to refund
      const recentInvoices = await Invoice.find({
        userId: ownerId,
        subscriptionId: subscription._id,
        status: 'paid',
        'lineItems.type': 'seat',
        createdAt: { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }, // Last 90 days
      })
        .sort({ createdAt: -1 })
        .limit(10);

      // Calculate prorated refund
      const now = new Date();
      const cycleStart = subscription.billing.billingCycleAnchor ?? subscription.startDate;
      const cycleEnd = subscription.billing.nextBillingDate ?? new Date(cycleStart);
      if (workspace.billing.billingCycle === 'monthly') {
        cycleEnd.setMonth(cycleEnd.getMonth() + 1);
      } else {
        cycleEnd.setFullYear(cycleEnd.getFullYear() + 1);
      }

      const daysRemaining = Math.ceil((cycleEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const proratedRefund = this.calculateProratedCharge(
        workspace.billing.pricePerSeat * numberOfSeats,
        workspace.billing.billingCycle,
        daysRemaining
      );

      // Try to refund from recent invoices first
      let refundProcessed = false;
      for (const invoice of recentInvoices) {
        if (invoice.gatewayTransactionId && invoice.paymentGateway && proratedRefund > 0) {
          try {
            const refundResult = await paymentGatewayManager.refund(invoice.paymentGateway, {
              transactionId: invoice.gatewayTransactionId,
              amount: Math.min(proratedRefund, invoice.total),
              reason: `Refund for ${numberOfSeats} removed seat(s) - prorated`,
              metadata: {
                workspaceId: workspaceIdStr,
                seatsRemoved: numberOfSeats,
                originalInvoiceId: invoice._id ? String(invoice._id) : '',
                prorated: true,
                daysRemaining,
              },
            });

            // Create credit invoice for the refund
            const creditInvoice = await SubscriptionService.generateInvoice(
              ownerId,
              subscription,
            [
              {
                description: `Credit for ${numberOfSeats} removed seat(s) - Prorated refund (${daysRemaining} days remaining)`,
                quantity: numberOfSeats,
                unitPrice: -workspace.billing.pricePerSeat, // Negative for credit
                total: -refundResult.amount, // Negative for credit
                type: 'seat' as const,
              },
            ]
            );

            creditInvoice.status = refundResult.status === 'succeeded' ? 'refunded' : 'pending';
            creditInvoice.gatewayTransactionId = refundResult.refundId;
            creditInvoice.paymentMethodId = paymentMethod._id as ObjectId;
            creditInvoice.paymentGateway = subscription.paymentGateway;
            await creditInvoice.save();

            const creditInvoiceIdStr: string = creditInvoice._id ? String(creditInvoice._id) : '';
            loggingService.info('Seat removal refund processed successfully', {
              workspaceId: workspaceIdStr,
              seatsRemoved: numberOfSeats,
              refundAmount: refundResult.amount,
              currency: subscription.billing.currency ?? 'USD',
              creditInvoiceId: creditInvoiceIdStr,
              refundId: refundResult.refundId,
              status: refundResult.status,
            });

            refundProcessed = true;
            break; // Process only one refund
          } catch (refundError: unknown) {
            const errorMessage = refundError instanceof Error ? refundError.message : String(refundError);
            loggingService.warn('Failed to refund from invoice, will create credit invoice', {
              invoiceId: invoice._id?.toString(),
              error: errorMessage,
            });
            // Continue to next invoice or create credit
          }
        }
      }

      // If no refund was processed, create a credit invoice
      if (!refundProcessed) {
        await this.createSeatRemovalCredit(workspace, numberOfSeats, subscription, ownerId, proratedRefund);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggingService.error('Error processing seat removal refund', {
        workspaceId: workspaceIdStr,
        error: errorMessage,
      });
      // Don't throw - allow seats to be removed even if refund fails
      // The refund can be processed manually or through credit
    }
  }

  /**
   * Create credit invoice for seat removal
   */
  private static async createSeatRemovalCredit(
    workspace: IWorkspace,
    numberOfSeats: number,
    subscription: ISubscription,
    ownerId: string | ObjectId,
    creditAmount?: number
  ): Promise<void> {
    const workspaceIdStr: string = workspace._id ? String(workspace._id) : '';
    try {
      // Calculate prorated credit if not provided
      let proratedCredit = creditAmount;
      if (proratedCredit === undefined) {
        const now = new Date();
        const cycleStart = subscription.billing.billingCycleAnchor ?? subscription.startDate;
        const cycleEnd = subscription.billing.nextBillingDate ?? new Date(cycleStart);
        if (workspace.billing.billingCycle === 'monthly') {
          cycleEnd.setMonth(cycleEnd.getMonth() + 1);
        } else {
          cycleEnd.setFullYear(cycleEnd.getFullYear() + 1);
        }

        const daysRemaining = Math.ceil((cycleEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        proratedCredit = this.calculateProratedCharge(
          workspace.billing.pricePerSeat * numberOfSeats,
          workspace.billing.billingCycle,
          daysRemaining
        );
      }

      // Create credit invoice (negative amounts)
      const creditInvoice = await SubscriptionService.generateInvoice(
        ownerId,
        subscription,
            [
              {
                description: `Credit for ${numberOfSeats} removed seat(s) - Prorated credit`,
                quantity: numberOfSeats,
                unitPrice: -workspace.billing.pricePerSeat, // Negative for credit
                total: -proratedCredit, // Negative for credit
                type: 'seat' as const,
              },
            ]
      );

      creditInvoice.status = 'paid'; // Credit is immediately applied
      creditInvoice.paymentGateway = subscription.paymentGateway ?? null;
      await creditInvoice.save();

      const creditInvoiceIdStr: string = creditInvoice._id ? String(creditInvoice._id) : '';
      loggingService.info('Seat removal credit invoice created', {
        workspaceId: workspaceIdStr,
        seatsRemoved: numberOfSeats,
        creditAmount: proratedCredit,
        currency: subscription.billing.currency ?? 'USD',
        creditInvoiceId: creditInvoiceIdStr,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggingService.error('Error creating seat removal credit invoice', {
        workspaceId: workspaceIdStr,
        error: errorMessage,
      });
      // Don't throw - credit can be created manually if needed
    }
  }
}

export const billingService = BillingService;

