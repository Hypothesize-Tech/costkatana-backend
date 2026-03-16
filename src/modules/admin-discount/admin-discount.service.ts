import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { Discount } from '../../schemas/billing/discount.schema';
import { LoggingService } from '../../common/services/logging.service';
import { DiscountUsageService } from './discount-usage.service';
import { ServiceHelper } from '../../common/services/service-helper.service';
import { CreateDiscountDto } from './dto/create-discount.dto';
import { UpdateDiscountDto } from './dto/update-discount.dto';
import { AdminDiscountQueryDto } from './dto/admin-discount-query.dto';

export interface DiscountWithUsageStats {
  _id: mongoose.Types.ObjectId;
  code: string;
  type: 'percentage' | 'fixed';
  amount: number;
  validFrom: Date;
  validUntil: Date;
  maxUses: number;
  currentUses: number;
  applicablePlans: ('free' | 'plus' | 'pro' | 'enterprise')[];
  minAmount?: number;
  userId?: mongoose.Types.ObjectId;
  isActive: boolean;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  usageStats: {
    totalUses: number;
    uniqueUsers: number;
  };
}

@Injectable()
export class AdminDiscountService {
  private readonly logger = new Logger(AdminDiscountService.name);

  constructor(
    @InjectModel(Discount.name) private discountModel: Model<Discount>,
    private readonly discountUsageService: DiscountUsageService,
    private readonly loggingService: LoggingService,
  ) {}

  /**
   * Get all discounts with pagination and filtering
   */
  async getDiscounts(query: AdminDiscountQueryDto): Promise<{
    discounts: DiscountWithUsageStats[];
    pagination: { page: number; limit: number; total: number; pages: number };
    filters: Record<string, unknown>;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};

    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }
    if (query.type) {
      filter.type = query.type;
    }
    if (query.search) {
      filter.code = { $regex: query.search, $options: 'i' };
    }
    if (query.plan) {
      filter.applicablePlans = { $in: [query.plan] };
    }

    const [discounts, total] = await Promise.all([
      this.discountModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.discountModel.countDocuments(filter),
    ]);

    const discountsWithUsage = await Promise.all(
      (discounts as any[]).map(async (discount) => {
        const usageStats =
          await this.discountUsageService.getUsageStatsForDiscount(
            discount.code,
          );
        return {
          ...discount,
          usageStats,
        } as DiscountWithUsageStats;
      }),
    );

    return {
      discounts: discountsWithUsage,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      filters: filter,
    };
  }

  /**
   * Get single discount by ID
   */
  async getDiscountById(id: string): Promise<any> {
    ServiceHelper.validateObjectId(id, 'discountId');
    const discount = await this.discountModel.findById(id).lean().exec();
    if (!discount) {
      throw new Error('Discount not found');
    }
    return discount;
  }

  /**
   * Create new discount
   */
  async createDiscount(dto: CreateDiscountDto): Promise<any> {
    if (dto.type === 'percentage' && (dto.amount < 0 || dto.amount > 100)) {
      throw new Error('Percentage discount must be between 0 and 100');
    }
    if (dto.type === 'fixed' && dto.amount < 0) {
      throw new Error(
        'Fixed discount amount must be greater than or equal to 0',
      );
    }
    if (dto.minAmount !== undefined && dto.minAmount < 1.0) {
      throw new Error(
        'Minimum amount must be at least $1.00 (or ₹1.00) to meet payment gateway requirements',
      );
    }
    if (
      dto.validFrom &&
      dto.validUntil &&
      new Date(dto.validFrom) > new Date(dto.validUntil)
    ) {
      throw new Error('Valid from date must be before valid until date');
    }

    const code = dto.code.toUpperCase().trim();
    const existing = await this.discountModel.findOne({ code }).exec();
    if (existing) {
      throw new Error('Discount code already exists');
    }

    const discount = await this.discountModel.create({
      code,
      type: dto.type,
      amount: dto.amount,
      validFrom: dto.validFrom ? new Date(dto.validFrom) : new Date(),
      validUntil: dto.validUntil
        ? new Date(dto.validUntil)
        : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      maxUses: dto.maxUses !== undefined ? dto.maxUses : -1,
      applicablePlans: dto.applicablePlans ?? [],
      minAmount: dto.minAmount,
      userId: dto.userId ? new mongoose.Types.ObjectId(dto.userId) : undefined,
      isActive: dto.isActive !== undefined ? dto.isActive : true,
      description: dto.description,
    });

    return discount.toObject ? discount.toObject() : discount;
  }

  /**
   * Update existing discount
   */
  async updateDiscount(id: string, dto: UpdateDiscountDto): Promise<any> {
    ServiceHelper.validateObjectId(id, 'discountId');

    const discount = await this.discountModel.findById(id).exec();
    if (!discount) {
      throw new Error('Discount not found');
    }

    if (
      dto.type === 'percentage' &&
      dto.amount !== undefined &&
      (dto.amount < 0 || dto.amount > 100)
    ) {
      throw new Error('Percentage discount must be between 0 and 100');
    }
    if (dto.type === 'fixed' && dto.amount !== undefined && dto.amount < 0) {
      throw new Error(
        'Fixed discount amount must be greater than or equal to 0',
      );
    }
    if (dto.minAmount !== undefined && dto.minAmount < 1.0) {
      throw new Error(
        'Minimum amount must be at least $1.00 (or ₹1.00) to meet payment gateway requirements',
      );
    }
    if (
      dto.validFrom &&
      dto.validUntil &&
      new Date(dto.validFrom) > new Date(dto.validUntil)
    ) {
      throw new Error('Valid from date must be before valid until date');
    }

    if (dto.code && dto.code.toUpperCase().trim() !== discount.code) {
      const existing = await this.discountModel
        .findOne({ code: dto.code.toUpperCase().trim(), _id: { $ne: id } })
        .exec();
      if (existing) {
        throw new Error('Discount code already exists');
      }
      discount.code = dto.code.toUpperCase().trim();
    }

    if (dto.type !== undefined) discount.type = dto.type;
    if (dto.amount !== undefined) discount.amount = dto.amount;
    if (dto.validFrom !== undefined)
      discount.validFrom = new Date(dto.validFrom);
    if (dto.validUntil !== undefined)
      discount.validUntil = new Date(dto.validUntil);
    if (dto.maxUses !== undefined) discount.maxUses = dto.maxUses;
    if (dto.applicablePlans !== undefined)
      discount.applicablePlans = dto.applicablePlans;
    if (dto.minAmount !== undefined) discount.minAmount = dto.minAmount;
    if (dto.userId !== undefined) {
      discount.userId = dto.userId
        ? (new mongoose.Types.ObjectId(dto.userId) as any)
        : undefined;
    }
    if (dto.isActive !== undefined) discount.isActive = dto.isActive;
    if (dto.description !== undefined) discount.description = dto.description;

    await discount.save();
    return discount.toObject ? discount.toObject() : discount;
  }

  /**
   * Delete discount
   */
  async deleteDiscount(id: string): Promise<{ code: string }> {
    ServiceHelper.validateObjectId(id, 'discountId');

    const discount = await this.discountModel.findById(id).exec();
    if (!discount) {
      throw new Error('Discount not found');
    }
    const code = discount.code;
    await this.discountModel.findByIdAndDelete(id).exec();
    return { code };
  }

  /**
   * Bulk activate discounts
   */
  async bulkActivate(ids: string[]): Promise<{ modifiedCount: number }> {
    ids.forEach((id) => ServiceHelper.validateObjectId(id, 'discountId'));
    const result = await this.discountModel
      .updateMany(
        { _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } },
        { $set: { isActive: true } },
      )
      .exec();
    return { modifiedCount: result.modifiedCount };
  }

  /**
   * Bulk deactivate discounts
   */
  async bulkDeactivate(ids: string[]): Promise<{ modifiedCount: number }> {
    ids.forEach((id) => ServiceHelper.validateObjectId(id, 'discountId'));
    const result = await this.discountModel
      .updateMany(
        { _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } },
        { $set: { isActive: false } },
      )
      .exec();
    return { modifiedCount: result.modifiedCount };
  }

  /**
   * Bulk delete discounts
   */
  async bulkDelete(ids: string[]): Promise<{ deletedCount: number }> {
    ids.forEach((id) => ServiceHelper.validateObjectId(id, 'discountId'));
    const result = await this.discountModel
      .deleteMany({
        _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
      })
      .exec();
    return { deletedCount: result.deletedCount };
  }
}
