import { Response, NextFunction } from 'express';
import { Discount, IDiscount } from '../models/Discount';
import { loggingService } from '../services/logging.service';
import { AppError } from '../middleware/error.middleware';
import { DiscountUsageService } from '../services/discountUsage.service';
import mongoose from 'mongoose';

export class AdminDiscountController {
    /**
     * Get all discounts with pagination and filtering
     * GET /api/admin/discounts
     */
    static async getDiscounts(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;
            const skip = (page - 1) * limit;

            // Build query filters
            const query: any = {};

            if (req.query.isActive !== undefined) {
                query.isActive = req.query.isActive === 'true';
            }

            if (req.query.type) {
                query.type = req.query.type;
            }

            if (req.query.search) {
                query.code = { $regex: req.query.search, $options: 'i' };
            }

            if (req.query.plan) {
                query.applicablePlans = { $in: [req.query.plan] };
            }

            // Get discounts with pagination
            const [discounts, total] = await Promise.all([
                Discount.find(query)
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                Discount.countDocuments(query),
            ]);

            // Get basic usage stats for each discount
            const discountsWithUsage = await Promise.all(
                discounts.map(async (discount) => {
                    const { Subscription } = await import('../models/Subscription');
                    const totalUses = await Subscription.countDocuments({
                        'discount.code': discount.code,
                    });
                    const uniqueUsers = await Subscription.distinct('userId', {
                        'discount.code': discount.code,
                    });

                    return {
                        ...discount,
                        usageStats: {
                            totalUses,
                            uniqueUsers: uniqueUsers.length,
                        },
                    };
                })
            );

            const duration = Date.now() - startTime;
            loggingService.info('Discounts retrieved', {
                component: 'AdminDiscountController',
                operation: 'getDiscounts',
                adminUserId: req.user?.id,
                count: discounts.length,
                duration,
            });

            res.json({
                success: true,
                data: {
                    discounts: discountsWithUsage,
                    pagination: {
                        page,
                        limit,
                        total,
                        pages: Math.ceil(total / limit),
                    },
                    filters: query,
                },
            });
        } catch (error) {
            loggingService.error('Error getting discounts:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDiscountController',
                operation: 'getDiscounts',
                adminUserId: req.user?.id,
            });
            next(error);
        }
    }

    /**
     * Get single discount by ID
     * GET /api/admin/discounts/:id
     */
    static async getDiscount(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const { id } = req.params;

            if (!mongoose.Types.ObjectId.isValid(id)) {
                throw new AppError('Invalid discount ID', 400);
            }

            const discount = await Discount.findById(id);

            if (!discount) {
                throw new AppError('Discount not found', 404);
            }

            const duration = Date.now() - startTime;
            loggingService.info('Discount retrieved', {
                component: 'AdminDiscountController',
                operation: 'getDiscount',
                adminUserId: req.user?.id,
                discountId: id,
                duration,
            });

            res.json({
                success: true,
                data: discount,
            });
        } catch (error) {
            loggingService.error('Error getting discount:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDiscountController',
                operation: 'getDiscount',
                adminUserId: req.user?.id,
            });
            next(error);
        }
    }

    /**
     * Create new discount
     * POST /api/admin/discounts
     */
    static async createDiscount(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const {
                code,
                type,
                amount,
                validFrom,
                validUntil,
                maxUses,
                applicablePlans,
                minAmount,
                userId,
                isActive,
                description,
            } = req.body;

            // Validation
            if (!code || !type || amount === undefined) {
                throw new AppError('Code, type, and amount are required', 400);
            }

            if (type === 'percentage' && (amount < 0 || amount > 100)) {
                throw new AppError('Percentage discount must be between 0 and 100', 400);
            }

            if (type === 'fixed' && amount < 0) {
                throw new AppError('Fixed discount amount must be greater than or equal to 0', 400);
            }

            // Validate minimum amount - must be at least 1.00 (Razorpay minimum)
            if (minAmount !== undefined && minAmount < 1.0) {
                throw new AppError('Minimum amount must be at least $1.00 (or ₹1.00) to meet payment gateway requirements', 400);
            }

            

            if (validFrom && validUntil && new Date(validFrom) > new Date(validUntil)) {
                throw new AppError('Valid from date must be before valid until date', 400);
            }

            // Check if code already exists
            const existingDiscount = await Discount.findOne({
                code: code.toUpperCase().trim(),
            });

            if (existingDiscount) {
                throw new AppError('Discount code already exists', 400);
            }

            // Create discount
            const discount = new Discount({
                code: code.toUpperCase().trim(),
                type,
                amount,
                validFrom: validFrom ? new Date(validFrom) : new Date(),
                validUntil: validUntil ? new Date(validUntil) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // Default 1 year
                maxUses: maxUses !== undefined ? maxUses : -1,
                applicablePlans: applicablePlans || [],
                minAmount,
                userId: userId ? new mongoose.Types.ObjectId(userId) : undefined,
                isActive: isActive !== undefined ? isActive : true,
                description,
            });

            await discount.save();

            const duration = Date.now() - startTime;
            loggingService.info('Discount created', {
                component: 'AdminDiscountController',
                operation: 'createDiscount',
                adminUserId: req.user?.id,
                discountId: discount._id,
                code: discount.code,
                duration,
            });

            res.status(201).json({
                success: true,
                message: 'Discount created successfully',
                data: discount,
            });
        } catch (error) {
            loggingService.error('Error creating discount:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDiscountController',
                operation: 'createDiscount',
                adminUserId: req.user?.id,
            });
            next(error);
        }
    }

    /**
     * Update existing discount
     * PUT /api/admin/discounts/:id
     */
    static async updateDiscount(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const { id } = req.params;

            if (!mongoose.Types.ObjectId.isValid(id)) {
                throw new AppError('Invalid discount ID', 400);
            }

            const discount = await Discount.findById(id);

            if (!discount) {
                throw new AppError('Discount not found', 404);
            }

            const {
                code,
                type,
                amount,
                validFrom,
                validUntil,
                maxUses,
                applicablePlans,
                minAmount,
                userId,
                isActive,
                description,
            } = req.body;

            // Validation
            if (type === 'percentage' && amount !== undefined && (amount < 0 || amount > 100)) {
                throw new AppError('Percentage discount must be between 0 and 100', 400);
            }

            if (type === 'fixed' && amount !== undefined && amount < 0) {
                throw new AppError('Fixed discount amount must be greater than or equal to 0', 400);
            }

            // Validate minimum amount - must be at least 1.00 (Razorpay minimum)
            if (minAmount !== undefined && minAmount < 1.0) {
                throw new AppError('Minimum amount must be at least $1.00 (or ₹1.00) to meet payment gateway requirements', 400);
            }


            if (validFrom && validUntil && new Date(validFrom) > new Date(validUntil)) {
                throw new AppError('Valid from date must be before valid until date', 400);
            }

            // Check code uniqueness if code is being changed
            if (code && code.toUpperCase().trim() !== discount.code) {
                const existingDiscount = await Discount.findOne({
                    code: code.toUpperCase().trim(),
                    _id: { $ne: id },
                });

                if (existingDiscount) {
                    throw new AppError('Discount code already exists', 400);
                }
                discount.code = code.toUpperCase().trim();
            }

            // Update fields
            if (type !== undefined) discount.type = type;
            if (amount !== undefined) discount.amount = amount;
            if (validFrom !== undefined) discount.validFrom = new Date(validFrom);
            if (validUntil !== undefined) discount.validUntil = new Date(validUntil);
            if (maxUses !== undefined) discount.maxUses = maxUses;
            if (applicablePlans !== undefined) discount.applicablePlans = applicablePlans;
            if (minAmount !== undefined) discount.minAmount = minAmount;
            if (userId !== undefined) {
                discount.userId = userId ? (new mongoose.Types.ObjectId(userId) as any) : undefined;
            }
            if (isActive !== undefined) discount.isActive = isActive;
            if (description !== undefined) discount.description = description;

            await discount.save();

            const duration = Date.now() - startTime;
            loggingService.info('Discount updated', {
                component: 'AdminDiscountController',
                operation: 'updateDiscount',
                adminUserId: req.user?.id,
                discountId: id,
                duration,
            });

            res.json({
                success: true,
                message: 'Discount updated successfully',
                data: discount,
            });
        } catch (error) {
            loggingService.error('Error updating discount:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDiscountController',
                operation: 'updateDiscount',
                adminUserId: req.user?.id,
            });
            next(error);
        }
    }

    /**
     * Delete discount
     * DELETE /api/admin/discounts/:id
     */
    static async deleteDiscount(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const { id } = req.params;

            if (!mongoose.Types.ObjectId.isValid(id)) {
                throw new AppError('Invalid discount ID', 400);
            }

            const discount = await Discount.findById(id);

            if (!discount) {
                throw new AppError('Discount not found', 404);
            }

            await Discount.findByIdAndDelete(id);

            const duration = Date.now() - startTime;
            loggingService.info('Discount deleted', {
                component: 'AdminDiscountController',
                operation: 'deleteDiscount',
                adminUserId: req.user?.id,
                discountId: id,
                code: discount.code,
                duration,
            });

            res.json({
                success: true,
                message: 'Discount deleted successfully',
            });
        } catch (error) {
            loggingService.error('Error deleting discount:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDiscountController',
                operation: 'deleteDiscount',
                adminUserId: req.user?.id,
            });
            next(error);
        }
    }

    /**
     * Get usage statistics for a discount
     * GET /api/admin/discounts/:id/usage
     */
    static async getDiscountUsage(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const { id } = req.params;

            if (!mongoose.Types.ObjectId.isValid(id)) {
                throw new AppError('Invalid discount ID', 400);
            }

            const stats = await DiscountUsageService.getDiscountUsageStats(id);

            const duration = Date.now() - startTime;
            loggingService.info('Discount usage stats retrieved', {
                component: 'AdminDiscountController',
                operation: 'getDiscountUsage',
                adminUserId: req.user?.id,
                discountId: id,
                duration,
            });

            res.json({
                success: true,
                data: stats,
            });
        } catch (error) {
            loggingService.error('Error getting discount usage:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDiscountController',
                operation: 'getDiscountUsage',
                adminUserId: req.user?.id,
            });
            next(error);
        }
    }

    /**
     * Bulk activate discounts
     * POST /api/admin/discounts/bulk-activate
     */
    static async bulkActivate(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const { ids } = req.body;

            if (!Array.isArray(ids) || ids.length === 0) {
                throw new AppError('IDs array is required', 400);
            }

            const result = await Discount.updateMany(
                { _id: { $in: ids.map((id: string) => new mongoose.Types.ObjectId(id)) } },
                { $set: { isActive: true } }
            );

            const duration = Date.now() - startTime;
            loggingService.info('Discounts bulk activated', {
                component: 'AdminDiscountController',
                operation: 'bulkActivate',
                adminUserId: req.user?.id,
                count: result.modifiedCount,
                duration,
            });

            res.json({
                success: true,
                message: `${result.modifiedCount} discount(s) activated successfully`,
                data: { modifiedCount: result.modifiedCount },
            });
        } catch (error) {
            loggingService.error('Error bulk activating discounts:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDiscountController',
                operation: 'bulkActivate',
                adminUserId: req.user?.id,
            });
            next(error);
        }
    }

    /**
     * Bulk deactivate discounts
     * POST /api/admin/discounts/bulk-deactivate
     */
    static async bulkDeactivate(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const { ids } = req.body;

            if (!Array.isArray(ids) || ids.length === 0) {
                throw new AppError('IDs array is required', 400);
            }

            const result = await Discount.updateMany(
                { _id: { $in: ids.map((id: string) => new mongoose.Types.ObjectId(id)) } },
                { $set: { isActive: false } }
            );

            const duration = Date.now() - startTime;
            loggingService.info('Discounts bulk deactivated', {
                component: 'AdminDiscountController',
                operation: 'bulkDeactivate',
                adminUserId: req.user?.id,
                count: result.modifiedCount,
                duration,
            });

            res.json({
                success: true,
                message: `${result.modifiedCount} discount(s) deactivated successfully`,
                data: { modifiedCount: result.modifiedCount },
            });
        } catch (error) {
            loggingService.error('Error bulk deactivating discounts:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDiscountController',
                operation: 'bulkDeactivate',
                adminUserId: req.user?.id,
            });
            next(error);
        }
    }

    /**
     * Bulk delete discounts
     * POST /api/admin/discounts/bulk-delete
     */
    static async bulkDelete(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            const { ids } = req.body;

            if (!Array.isArray(ids) || ids.length === 0) {
                throw new AppError('IDs array is required', 400);
            }

            const result = await Discount.deleteMany({
                _id: { $in: ids.map((id: string) => new mongoose.Types.ObjectId(id)) },
            });

            const duration = Date.now() - startTime;
            loggingService.info('Discounts bulk deleted', {
                component: 'AdminDiscountController',
                operation: 'bulkDelete',
                adminUserId: req.user?.id,
                count: result.deletedCount,
                duration,
            });

            res.json({
                success: true,
                message: `${result.deletedCount} discount(s) deleted successfully`,
                data: { deletedCount: result.deletedCount },
            });
        } catch (error) {
            loggingService.error('Error bulk deleting discounts:', {
                error: error instanceof Error ? error.message : String(error),
                component: 'AdminDiscountController',
                operation: 'bulkDelete',
                adminUserId: req.user?.id,
            });
            next(error);
        }
    }
}

