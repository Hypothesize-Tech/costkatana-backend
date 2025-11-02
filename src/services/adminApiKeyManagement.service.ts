import { User } from '../models/User';
import { ProxyKey } from '../models/ProxyKey';
import { Usage } from '../models/Usage';
import { loggingService } from './logging.service';

export interface ApiKeyStats {
    totalKeys: number;
    activeKeys: number;
    inactiveKeys: number;
    expiredKeys: number;
    expiringKeys: number; // Expiring in next 30 days
    keysWithBudgetLimits: number;
    keysOverBudget: number;
}

export interface ApiKeyUsage {
    keyId: string;
    keyName: string;
    userId: string;
    userEmail: string;
    isActive: boolean;
    totalRequests: number;
    totalCost: number;
    dailyCost: number;
    monthlyCost: number;
    lastUsed?: Date;
    expiresAt?: Date;
    budgetLimit?: number;
    dailyBudgetLimit?: number;
    monthlyBudgetLimit?: number;
    isOverBudget: boolean;
    isExpired: boolean;
    isExpiring: boolean; // Expiring in next 30 days
}

export interface ApiKeyTopUsage {
    keyId: string;
    keyName: string;
    userId: string;
    userEmail: string;
    requests: number;
    cost: number;
    lastUsed?: Date;
}

export class AdminApiKeyManagementService {
    /**
     * Get API key statistics
     */
    static async getApiKeyStats(): Promise<ApiKeyStats> {
        try {
            const now = new Date();
            const thirtyDaysFromNow = new Date(now);
            thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

            // Get user API keys
            const users = await User.find({ isActive: true })
                .select('apiKeys')
                .lean();

            let totalKeys = 0;
            let activeKeys = 0;
            let inactiveKeys = 0;
            let expiredKeys = 0;
            let expiringKeys = 0;
            let keysWithBudgetLimits = 0;
            let keysOverBudget = 0;

            // Count user API keys
            for (const user of users) {
                const apiKeys = user.apiKeys || [];
                totalKeys += apiKeys.length;

                for (const key of apiKeys) {
                    if (key.isActive) {
                        activeKeys++;
                    } else {
                        inactiveKeys++;
                    }

                    // User API keys don't have expiresAt field
                    // Only ProxyKeys have expiration
                }
            }

            // Get proxy keys
            const proxyKeys = await ProxyKey.find().lean();
            totalKeys += proxyKeys.length;

            for (const key of proxyKeys) {
                if (key.isActive) {
                    activeKeys++;
                } else {
                    inactiveKeys++;
                }

                if (key.expiresAt && key.expiresAt < now) {
                    expiredKeys++;
                } else if (key.expiresAt && key.expiresAt <= thirtyDaysFromNow) {
                    expiringKeys++;
                }

                if (key.budgetLimit || key.dailyBudgetLimit || key.monthlyBudgetLimit) {
                    keysWithBudgetLimits++;
                }

                // Check if over budget
                if (key.budgetLimit && key.usageStats.totalCost > key.budgetLimit) {
                    keysOverBudget++;
                } else if (key.monthlyBudgetLimit && key.usageStats.monthlyCost > key.monthlyBudgetLimit) {
                    keysOverBudget++;
                } else if (key.dailyBudgetLimit && key.usageStats.dailyCost > key.dailyBudgetLimit) {
                    keysOverBudget++;
                }
            }

            return {
                totalKeys,
                activeKeys,
                inactiveKeys,
                expiredKeys,
                expiringKeys,
                keysWithBudgetLimits,
                keysOverBudget
            };
        } catch (error) {
            loggingService.error('Error getting API key stats:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get API key usage analytics
     */
    static async getApiKeyUsage(
        startDate?: Date,
        endDate?: Date
    ): Promise<ApiKeyUsage[]> {
        try {
            const now = new Date();
            const thirtyDaysFromNow = new Date(now);
            thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

            const usageList: ApiKeyUsage[] = [];

            // Get user API keys with usage
            const users = await User.find({ isActive: true })
                .select('email apiKeys')
                .lean();

            for (const user of users) {
                const apiKeys = user.apiKeys || [];
                for (const key of apiKeys) {
                    // Get usage for this key (simplified - would need to track key usage in Usage model)
                    const usage = await Usage.aggregate([
                        {
                            $match: {
                                userId: user._id,
                                createdAt: {
                                    ...(startDate ? { $gte: startDate } : {}),
                                    ...(endDate ? { $lte: endDate } : {})
                                }
                            }
                        },
                        {
                            $group: {
                                _id: null,
                                totalRequests: { $sum: 1 },
                                totalCost: { $sum: '$cost' }
                            }
                        }
                    ]);

                    const stats = usage[0] || { totalRequests: 0, totalCost: 0 };

                    // Calculate daily and monthly costs (simplified)
                    const daysInPeriod = endDate && startDate
                        ? Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
                        : 30;
                    const dailyCost = stats.totalCost / daysInPeriod;
                    const monthlyCost = stats.totalCost * (30 / daysInPeriod);

                    usageList.push({
                        keyId: key.id,
                        keyName: key.name,
                        userId: user._id.toString(),
                        userEmail: user.email,
                        isActive: key.isActive || false,
                        totalRequests: stats.totalRequests,
                        totalCost: stats.totalCost,
                        dailyCost,
                        monthlyCost,
                        lastUsed: key.lastUsed,
                        isOverBudget: false,
                        isExpired: false, // User API keys don't expire
                        isExpiring: false
                    });
                }
            }

            // Get proxy keys with usage
            const proxyKeys = await ProxyKey.find().lean();
            for (const key of proxyKeys) {
                const user = await User.findById(key.userId).select('email').lean();
                
                const usage = await Usage.aggregate([
                    {
                        $match: {
                            userId: key.userId,
                            createdAt: {
                                ...(startDate ? { $gte: startDate } : {}),
                                ...(endDate ? { $lte: endDate } : {})
                            }
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            totalRequests: { $sum: 1 },
                            totalCost: { $sum: '$cost' }
                        }
                    }
                ]);

                const stats = usage[0] || { totalRequests: 0, totalCost: 0 };

                const isExpired = key.expiresAt ? key.expiresAt < now : false;
                const isExpiring = key.expiresAt 
                    ? key.expiresAt > now && key.expiresAt <= thirtyDaysFromNow 
                    : false;

                let isOverBudget = false;
                if (key.budgetLimit && stats.totalCost > key.budgetLimit) {
                    isOverBudget = true;
                } else if (key.monthlyBudgetLimit && key.usageStats.monthlyCost > key.monthlyBudgetLimit) {
                    isOverBudget = true;
                } else if (key.dailyBudgetLimit && key.usageStats.dailyCost > key.dailyBudgetLimit) {
                    isOverBudget = true;
                }

                usageList.push({
                    keyId: key.keyId,
                    keyName: key.name,
                    userId: key.userId.toString(),
                    userEmail: user?.email || 'Unknown',
                    isActive: key.isActive,
                    totalRequests: stats.totalRequests + key.usageStats.totalRequests,
                    totalCost: stats.totalCost + key.usageStats.totalCost,
                    dailyCost: key.usageStats.dailyCost,
                    monthlyCost: key.usageStats.monthlyCost,
                    lastUsed: key.lastUsed,
                    expiresAt: key.expiresAt,
                    budgetLimit: key.budgetLimit,
                    dailyBudgetLimit: key.dailyBudgetLimit,
                    monthlyBudgetLimit: key.monthlyBudgetLimit,
                    isOverBudget,
                    isExpired,
                    isExpiring
                });
            }

            return usageList.sort((a, b) => b.totalCost - a.totalCost);
        } catch (error) {
            loggingService.error('Error getting API key usage:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get top API keys by usage
     */
    static async getTopApiKeys(limit: number = 10): Promise<ApiKeyTopUsage[]> {
        try {
            const usage = await this.getApiKeyUsage();

            const topKeys = usage
                .sort((a, b) => b.totalRequests - a.totalRequests)
                .slice(0, limit)
                .map(key => ({
                    keyId: key.keyId,
                    keyName: key.keyName,
                    userId: key.userId,
                    userEmail: key.userEmail,
                    requests: key.totalRequests,
                    cost: key.totalCost,
                    lastUsed: key.lastUsed
                }));

            return topKeys;
        } catch (error) {
            loggingService.error('Error getting top API keys:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get expiring API keys
     */
    static async getExpiringApiKeys(days: number = 30): Promise<ApiKeyUsage[]> {
        try {
            const now = new Date();
            const futureDate = new Date(now);
            futureDate.setDate(futureDate.getDate() + days);

            const usage = await this.getApiKeyUsage();

            return usage.filter(key => key.isExpiring && !key.isExpired);
        } catch (error) {
            loggingService.error('Error getting expiring API keys:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get API keys over budget
     */
    static async getApiKeysOverBudget(): Promise<ApiKeyUsage[]> {
        try {
            const usage = await this.getApiKeyUsage();

            return usage.filter(key => key.isOverBudget);
        } catch (error) {
            loggingService.error('Error getting API keys over budget:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
}


