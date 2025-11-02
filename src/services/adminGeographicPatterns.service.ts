import { Usage } from '../models/Usage';
import { loggingService } from './logging.service';
import * as geoip from 'geoip-lite';

export interface GeographicUsage {
    country: string;
    region?: string;
    city?: string;
    requests: number;
    cost: number;
    tokens: number;
    users: number;
    avgResponseTime: number;
    errorRate: number;
}

export interface PeakUsageTime {
    hour: number;
    dayOfWeek?: number;
    requests: number;
    cost: number;
    avgResponseTime: number;
}

export interface UsagePattern {
    timeOfDay: number;
    dayOfWeek: number;
    requests: number;
    cost: number;
    avgResponseTime: number;
}

/**
 * Clean and normalize IP address for geolocation lookup
 */
function cleanIPAddress(ipAddress?: string): string | null {
    if (!ipAddress || typeof ipAddress !== 'string') {
        return null;
    }
    
    // Remove port if present (e.g., "192.168.1.1:8080" -> "192.168.1.1")
    let cleanIP = ipAddress.split(':')[0].trim();
    
    // Remove brackets from IPv6 addresses
    cleanIP = cleanIP.replace(/^\[|\]$/g, '');
    
    // Handle localhost variations
    if (cleanIP === '127.0.0.1' || cleanIP === '::1' || cleanIP === 'localhost' || cleanIP === '::ffff:127.0.0.1') {
        return null; // Skip localhost IPs
    }
    
    // Basic IPv4 validation
    if (cleanIP.includes('.')) {
        const parts = cleanIP.split('.');
        if (parts.length === 4) {
            const isValid = parts.every(part => {
                const num = parseInt(part, 10);
                return !isNaN(num) && num >= 0 && num <= 255;
            });
            if (isValid) {
                return cleanIP;
            }
        }
    }
    
    // IPv6 basic check (geoip-lite supports IPv6)
    if (cleanIP.includes(':') && cleanIP.length > 3) {
        return cleanIP;
    }
    
    return null;
}

/**
 * Extract geographic information from IP address using geoip-lite
 */
function extractGeographicInfo(ipAddress?: string): { country: string; region?: string; city?: string } {
    const cleanIP = cleanIPAddress(ipAddress);
    
    if (!cleanIP) {
        return { country: 'Unknown' };
    }
    
    try {
        // Lookup IP using geoip-lite
        const geo = geoip.lookup(cleanIP);
        
        if (!geo) {
            return { country: 'Unknown' };
        }
        
        // geoip-lite returns: { country, region, city, ll: [lat, lon], metro, range, zip, timezone }
        // Note: region can be string or number, metro is a number
        const region = geo.region 
            ? (typeof geo.region === 'string' ? geo.region : String(geo.region))
            : (geo.metro ? String(geo.metro) : undefined);
        
        return {
            country: geo.country || 'Unknown',
            region,
            city: geo.city || undefined
        };
    } catch (error) {
        loggingService.warn('Error looking up IP address:', {
            ip: cleanIP,
            error: error instanceof Error ? error.message : String(error)
        });
        return { country: 'Unknown' };
    }
}

export class AdminGeographicPatternsService {
    /**
     * Get geographic usage patterns
     */
    static async getGeographicUsage(
        startDate?: Date,
        endDate?: Date
    ): Promise<GeographicUsage[]> {
        try {
            const matchStage: any = {};

            if (startDate || endDate) {
                matchStage.createdAt = {};
                if (startDate) matchStage.createdAt.$gte = startDate;
                if (endDate) matchStage.createdAt.$lte = endDate;
            }

            // First, aggregate by IP address
            const ipAggregation = await Usage.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: {
                            ipAddress: { $ifNull: ['$ipAddress', 'Unknown'] }
                        },
                        requests: { $sum: 1 },
                        cost: { $sum: '$cost' },
                        tokens: { $sum: '$totalTokens' },
                        uniqueUsers: { $addToSet: '$userId' },
                        avgResponseTime: { $avg: '$responseTime' },
                        totalErrors: {
                            $sum: {
                                $cond: [{ $or: ['$errorOccurred', { $gt: ['$httpStatusCode', 399] }] }, 1, 0]
                            }
                        }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        ipAddress: '$_id.ipAddress',
                        requests: 1,
                        cost: 1,
                        tokens: 1,
                        uniqueUsers: 1,
                        avgResponseTime: 1,
                        totalErrors: 1
                    }
                }
            ]);

            // Map IP addresses to countries and aggregate
            const countryMap = new Map<string, {
                requests: number;
                cost: number;
                tokens: number;
                users: Set<string>;
                responseTimes: number[];
                errors: number;
            }>();

            for (const item of ipAggregation) {
                const geoInfo = extractGeographicInfo(item.ipAddress);
                const country = geoInfo.country || 'Unknown';
                
                if (!countryMap.has(country)) {
                    countryMap.set(country, {
                        requests: 0,
                        cost: 0,
                        tokens: 0,
                        users: new Set<string>(),
                        responseTimes: [],
                        errors: 0
                    });
                }
                
                const countryData = countryMap.get(country)!;
                countryData.requests += item.requests;
                countryData.cost += item.cost;
                countryData.tokens += item.tokens;
                
                // Add unique users
                if (Array.isArray(item.uniqueUsers)) {
                    item.uniqueUsers.forEach((userId: any) => {
                        const userIdStr = userId?.toString() || '';
                        if (userIdStr) {
                            countryData.users.add(userIdStr);
                        }
                    });
                }
                
                // Calculate average response time
                const avgResponse = item.avgResponseTime || 0;
                if (avgResponse > 0) {
                    // Weight by requests for accurate average
                    for (let i = 0; i < item.requests; i++) {
                        countryData.responseTimes.push(avgResponse);
                    }
                }
                
                countryData.errors += item.totalErrors;
            }

            // Convert map to array and calculate final metrics
            const geographicUsage: GeographicUsage[] = Array.from(countryMap.entries()).map(([country, data]) => {
                const avgResponseTime = data.responseTimes.length > 0
                    ? data.responseTimes.reduce((sum, rt) => sum + rt, 0) / data.responseTimes.length
                    : 0;
                
                // Get region and city for this country (use first IP's geo info as representative)
                // In a more sophisticated implementation, we could track region/city per country
                const representativeGeo = extractGeographicInfo(
                    ipAggregation.find(item => {
                        const geo = extractGeographicInfo(item.ipAddress);
                        return geo.country === country;
                    })?.ipAddress
                );
                
                return {
                    country,
                    region: representativeGeo.region,
                    city: representativeGeo.city,
                    requests: data.requests,
                    cost: data.cost,
                    tokens: data.tokens,
                    users: data.users.size,
                    avgResponseTime,
                    errorRate: data.requests > 0 ? (data.errors / data.requests) * 100 : 0
                };
            });

            return geographicUsage.sort((a, b) => b.requests - a.requests);
        } catch (error) {
            loggingService.error('Error getting geographic usage:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get peak usage times
     */
    static async getPeakUsageTimes(
        startDate?: Date,
        endDate?: Date
    ): Promise<PeakUsageTime[]> {
        try {
            const matchStage: any = {};

            if (startDate || endDate) {
                matchStage.createdAt = {};
                if (startDate) matchStage.createdAt.$gte = startDate;
                if (endDate) matchStage.createdAt.$lte = endDate;
            }

            const aggregation = await Usage.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: {
                            hour: { $hour: '$createdAt' },
                            dayOfWeek: { $dayOfWeek: '$createdAt' }
                        },
                        requests: { $sum: 1 },
                        cost: { $sum: '$cost' },
                        avgResponseTime: { $avg: '$responseTime' }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        hour: '$_id.hour',
                        dayOfWeek: '$_id.dayOfWeek',
                        requests: 1,
                        cost: 1,
                        avgResponseTime: 1
                    }
                },
                { $sort: { requests: -1 } }
            ]);

            return aggregation.map(item => ({
                hour: item.hour,
                dayOfWeek: item.dayOfWeek,
                requests: item.requests,
                cost: item.cost,
                avgResponseTime: item.avgResponseTime || 0
            }));
        } catch (error) {
            loggingService.error('Error getting peak usage times:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get usage patterns by time and day
     */
    static async getUsagePatterns(
        startDate?: Date,
        endDate?: Date
    ): Promise<UsagePattern[]> {
        try {
            const matchStage: any = {};

            if (startDate || endDate) {
                matchStage.createdAt = {};
                if (startDate) matchStage.createdAt.$gte = startDate;
                if (endDate) matchStage.createdAt.$lte = endDate;
            }

            const aggregation = await Usage.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: {
                            timeOfDay: { $hour: '$createdAt' },
                            dayOfWeek: { $dayOfWeek: '$createdAt' }
                        },
                        requests: { $sum: 1 },
                        cost: { $sum: '$cost' },
                        avgResponseTime: { $avg: '$responseTime' }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        timeOfDay: '$_id.timeOfDay',
                        dayOfWeek: '$_id.dayOfWeek',
                        requests: 1,
                        cost: 1,
                        avgResponseTime: 1
                    }
                },
                { $sort: { dayOfWeek: 1, timeOfDay: 1 } }
            ]);

            return aggregation.map(item => ({
                timeOfDay: item.timeOfDay,
                dayOfWeek: item.dayOfWeek,
                requests: item.requests,
                cost: item.cost,
                avgResponseTime: item.avgResponseTime || 0
            }));
        } catch (error) {
            loggingService.error('Error getting usage patterns:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get most active regions
     */
    static async getMostActiveRegions(
        limit: number = 10,
        startDate?: Date,
        endDate?: Date
    ): Promise<GeographicUsage[]> {
        try {
            const geographicUsage = await this.getGeographicUsage(startDate, endDate);

            return geographicUsage
                .sort((a, b) => b.requests - a.requests)
                .slice(0, limit);
        } catch (error) {
            loggingService.error('Error getting most active regions:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get geographic cost distribution
     */
    static async getGeographicCostDistribution(
        startDate?: Date,
        endDate?: Date
    ): Promise<Array<{ country: string; cost: number; percentage: number }>> {
        try {
            const geographicUsage = await this.getGeographicUsage(startDate, endDate);

            const totalCost = geographicUsage.reduce((sum, item) => sum + item.cost, 0);

            return geographicUsage.map(item => ({
                country: item.country,
                cost: item.cost,
                percentage: totalCost > 0 ? (item.cost / totalCost) * 100 : 0
            })).sort((a, b) => b.cost - a.cost);
        } catch (error) {
            loggingService.error('Error getting geographic cost distribution:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
}


