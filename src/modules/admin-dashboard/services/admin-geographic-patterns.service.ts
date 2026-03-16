import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as geoip from 'geoip-lite';
import { Usage, UsageDocument } from '../../../schemas/core/usage.schema';
import { GeographicUsage, PeakUsageTime } from '../interfaces';

@Injectable()
export class AdminGeographicPatternsService {
  private readonly logger = new Logger(AdminGeographicPatternsService.name);

  constructor(
    @InjectModel(Usage.name) private usageModel: Model<UsageDocument>,
  ) {}

  /**
   * Get geographic usage patterns
   */
  async getGeographicUsage(
    startDate?: Date,
    endDate?: Date,
  ): Promise<GeographicUsage[]> {
    try {
      const matchQuery: any = {};

      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = startDate;
        if (endDate) matchQuery.createdAt.$lte = endDate;
      }

      const usageData = await this.usageModel.aggregate([
        {
          $match: matchQuery,
        },
        {
          $group: {
            _id: '$ipAddress',
            totalRequests: { $sum: 1 },
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$totalTokens' },
            uniqueUsers: { $addToSet: '$userId' },
            lastRequest: { $max: '$createdAt' },
          },
        },
        {
          $project: {
            ipAddress: '$_id',
            totalRequests: 1,
            totalCost: 1,
            totalTokens: 1,
            uniqueUsersCount: { $size: '$uniqueUsers' },
            lastRequest: 1,
          },
        },
        {
          $sort: { totalRequests: -1 },
        },
        {
          $limit: 1000, // Limit to prevent excessive processing
        },
      ]);

      const geographicData: GeographicUsage[] = [];
      const countryMap = new Map<
        string,
        {
          country: string;
          countryCode: string;
          requests: number;
          cost: number;
          tokens: number;
          uniqueUsers: number;
          ips: string[];
        }
      >();

      for (const usage of usageData) {
        if (!usage.ipAddress) continue;

        try {
          const geo = geoip.lookup(usage.ipAddress);
          if (!geo) continue;

          const countryKey = geo.country;
          const existing = countryMap.get(countryKey);

          if (existing) {
            existing.requests += usage.totalRequests;
            existing.cost += usage.totalCost;
            existing.tokens += usage.totalTokens;
            existing.uniqueUsers += usage.uniqueUsersCount;
            existing.ips.push(usage.ipAddress);
          } else {
            countryMap.set(countryKey, {
              country: geo.country,
              countryCode: geo.country,
              requests: usage.totalRequests,
              cost: usage.totalCost,
              tokens: usage.totalTokens,
              uniqueUsers: usage.uniqueUsersCount,
              ips: [usage.ipAddress],
            });
          }
        } catch (error) {
          // Skip invalid IP addresses
          this.logger.warn(`Failed to lookup IP ${usage.ipAddress}:`, error);
        }
      }

      // Convert map to array and sort by requests
      const sortedData = Array.from(countryMap.values())
        .sort((a, b) => b.requests - a.requests)
        .map((item) => ({
          country: item.country,
          countryCode: item.countryCode,
          requests: item.requests,
          cost: item.cost,
          tokens: item.tokens,
          uniqueUsers: item.uniqueUsers,
          percentageOfTotal: 0, // Will be calculated below
          avgCostPerRequest: item.requests > 0 ? item.cost / item.requests : 0,
          avgTokensPerRequest:
            item.requests > 0 ? item.tokens / item.requests : 0,
        }));

      // Calculate percentages
      const totalRequests = sortedData.reduce(
        (sum, item) => sum + item.requests,
        0,
      );
      sortedData.forEach((item) => {
        item.percentageOfTotal =
          totalRequests > 0 ? (item.requests / totalRequests) * 100 : 0;
      });

      return sortedData;
    } catch (error) {
      this.logger.error('Error getting geographic usage:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminGeographicPatternsService',
        operation: 'getGeographicUsage',
      });
      throw error;
    }
  }

  /**
   * Get peak usage times by geographic region
   */
  async getPeakUsageTimes(
    countryCode?: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<PeakUsageTime[]> {
    try {
      const matchQuery: any = {};

      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = startDate;
        if (endDate) matchQuery.createdAt.$lte = endDate;
      }

      // Get usage data with IP addresses
      const usageData = await this.usageModel.aggregate([
        {
          $match: matchQuery,
        },
        {
          $project: {
            ipAddress: 1,
            createdAt: 1,
            hour: { $hour: '$createdAt' },
            dayOfWeek: { $dayOfWeek: '$createdAt' },
            cost: 1,
            totalTokens: 1,
          },
        },
        {
          $limit: 50000, // Limit for performance
        },
      ]);

      const hourlyStats = new Map<
        string,
        {
          hour: number;
          requests: number;
          cost: number;
          tokens: number;
          countries: Set<string>;
        }
      >();

      const dailyStats = new Map<
        string,
        {
          day: number;
          requests: number;
          cost: number;
          tokens: number;
          countries: Set<string>;
        }
      >();

      for (const usage of usageData) {
        if (!usage.ipAddress) continue;

        try {
          const geo = geoip.lookup(usage.ipAddress);
          if (!geo) continue;

          // Filter by country if specified
          if (countryCode && geo.country !== countryCode) continue;

          const hourKey = usage.hour.toString();
          const dayKey = usage.dayOfWeek.toString();

          // Hourly stats
          const hourly = hourlyStats.get(hourKey) || {
            hour: usage.hour,
            requests: 0,
            cost: 0,
            tokens: 0,
            countries: new Set(),
          };
          hourly.requests++;
          hourly.cost += usage.cost || 0;
          hourly.tokens += usage.totalTokens || 0;
          hourly.countries.add(geo.country);
          hourlyStats.set(hourKey, hourly);

          // Daily stats
          const daily = dailyStats.get(dayKey) || {
            day: usage.dayOfWeek,
            requests: 0,
            cost: 0,
            tokens: 0,
            countries: new Set(),
          };
          daily.requests++;
          daily.cost += usage.cost || 0;
          daily.tokens += usage.totalTokens || 0;
          daily.countries.add(geo.country);
          dailyStats.set(dayKey, daily);
        } catch (error) {
          this.logger.warn(
            'Skipping invalid IP address in peak usage analysis',
            {
              ipAddress: usage.ipAddress,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }

      const peakTimes: PeakUsageTime[] = [];

      // Find peak hours
      const sortedHourly = Array.from(hourlyStats.values()).sort(
        (a, b) => b.requests - a.requests,
      );

      if (sortedHourly.length > 0) {
        const peakHour = sortedHourly[0];
        peakTimes.push({
          type: 'hourly',
          hour: peakHour.hour,
          value: peakHour.hour,
          requests: peakHour.requests,
          cost: peakHour.cost,
          tokens: peakHour.tokens,
          countryCount: peakHour.countries.size,
          countries: Array.from(peakHour.countries),
        });
      }

      // Find peak days
      const sortedDaily = Array.from(dailyStats.values()).sort(
        (a, b) => b.requests - a.requests,
      );

      if (sortedDaily.length > 0) {
        const peakDay = sortedDaily[0];
        const dayNames = [
          'Sunday',
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
        ];
        peakTimes.push({
          type: 'daily',
          hour: 0,
          value: peakDay.day,
          requests: peakDay.requests,
          cost: peakDay.cost,
          tokens: peakDay.tokens,
          countryCount: peakDay.countries.size,
          countries: Array.from(peakDay.countries),
          dayName: dayNames[peakDay.day - 1], // MongoDB dayOfWeek: 1=Sunday, 7=Saturday
        });
      }

      return peakTimes;
    } catch (error) {
      this.logger.error('Error getting peak usage times:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminGeographicPatternsService',
        operation: 'getPeakUsageTimes',
      });
      throw error;
    }
  }

  /**
   * Get usage patterns by time zone
   */
  async getUsagePatternsByTimezone(
    startDate?: Date,
    endDate?: Date,
  ): Promise<
    Array<{
      timezone: string;
      requests: number;
      cost: number;
      tokens: number;
      countries: string[];
      peakHour: number;
    }>
  > {
    try {
      const matchQuery: any = {};

      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = startDate;
        if (endDate) matchQuery.createdAt.$lte = endDate;
      }

      // Group by hour and IP to determine timezones
      const usageData = await this.usageModel.aggregate([
        {
          $match: matchQuery,
        },
        {
          $project: {
            ipAddress: 1,
            createdAt: 1,
            hour: { $hour: '$createdAt' },
            cost: 1,
            totalTokens: 1,
          },
        },
        {
          $limit: 25000, // Limit for performance
        },
      ]);

      // Group by estimated timezone (simplified - based on common UTC offsets)
      const timezoneMap = new Map<
        string,
        {
          requests: number;
          cost: number;
          tokens: number;
          countries: Set<string>;
          hourStats: Map<number, number>;
        }
      >();

      for (const usage of usageData) {
        if (!usage.ipAddress) continue;

        try {
          const geo = geoip.lookup(usage.ipAddress);
          if (!geo) continue;

          // Estimate timezone based on country (simplified)
          const timezone = this.estimateTimezone(geo.country);

          const existing = timezoneMap.get(timezone) || {
            requests: 0,
            cost: 0,
            tokens: 0,
            countries: new Set(),
            hourStats: new Map(),
          };

          existing.requests++;
          existing.cost += usage.cost || 0;
          existing.tokens += usage.totalTokens || 0;
          existing.countries.add(geo.country);

          // Track requests by hour
          const hourCount = existing.hourStats.get(usage.hour) || 0;
          existing.hourStats.set(usage.hour, hourCount + 1);

          timezoneMap.set(timezone, existing);
        } catch (error) {
          this.logger.warn('Skipping invalid IP address in timezone analysis', {
            ipAddress: usage.ipAddress,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Convert to array and find peak hours
      const patterns = Array.from(timezoneMap.entries()).map(
        ([timezone, data]) => {
          const peakHour =
            Array.from(data.hourStats.entries()).sort(
              (a, b) => b[1] - a[1],
            )[0]?.[0] || 0;

          return {
            timezone,
            requests: data.requests,
            cost: data.cost,
            tokens: data.tokens,
            countries: Array.from(data.countries),
            peakHour,
          };
        },
      );

      return patterns.sort((a, b) => b.requests - a.requests);
    } catch (error) {
      this.logger.error('Error getting usage patterns by timezone:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminGeographicPatternsService',
        operation: 'getUsagePatternsByTimezone',
      });
      throw error;
    }
  }

  /**
   * Estimate timezone based on country (simplified)
   */
  private estimateTimezone(countryCode: string): string {
    // Simplified timezone estimation based on country
    const timezoneMap: Record<string, string> = {
      US: 'America/New_York',
      CA: 'America/Toronto',
      GB: 'Europe/London',
      DE: 'Europe/Berlin',
      FR: 'Europe/Paris',
      JP: 'Asia/Tokyo',
      CN: 'Asia/Shanghai',
      IN: 'Asia/Kolkata',
      AU: 'Australia/Sydney',
      BR: 'America/Sao_Paulo',
      RU: 'Europe/Moscow',
      KR: 'Asia/Seoul',
      SG: 'Asia/Singapore',
      NL: 'Europe/Amsterdam',
      SE: 'Europe/Stockholm',
      NO: 'Europe/Oslo',
      DK: 'Europe/Copenhagen',
      FI: 'Europe/Helsinki',
      PL: 'Europe/Warsaw',
      IT: 'Europe/Rome',
      ES: 'Europe/Madrid',
      PT: 'Europe/Lisbon',
      CH: 'Europe/Zurich',
      AT: 'Europe/Vienna',
      BE: 'Europe/Brussels',
      CZ: 'Europe/Prague',
      HU: 'Europe/Budapest',
      GR: 'Europe/Athens',
      TR: 'Europe/Istanbul',
      ZA: 'Africa/Johannesburg',
      EG: 'Africa/Cairo',
      NG: 'Africa/Lagos',
      KE: 'Africa/Nairobi',
      MX: 'America/Mexico_City',
      AR: 'America/Argentina/Buenos_Aires',
      CO: 'America/Bogota',
      PE: 'America/Lima',
      CL: 'America/Santiago',
      VE: 'America/Caracas',
      EC: 'America/Guayaquil',
      UY: 'America/Montevideo',
      PY: 'America/Asuncion',
      BO: 'America/La_Paz',
      NZ: 'Pacific/Auckland',
      TH: 'Asia/Bangkok',
      MY: 'Asia/Kuala_Lumpur',
      ID: 'Asia/Jakarta',
      PH: 'Asia/Manila',
      VN: 'Asia/Ho_Chi_Minh',
      HK: 'Asia/Hong_Kong',
      TW: 'Asia/Taipei',
      IL: 'Asia/Jerusalem',
      AE: 'Asia/Dubai',
      SA: 'Asia/Riyadh',
      QA: 'Asia/Qatar',
      KW: 'Asia/Kuwait',
      BH: 'Asia/Bahrain',
      OM: 'Asia/Muscat',
    };

    return timezoneMap[countryCode] || 'UTC';
  }

  /**
   * Get regional performance metrics
   */
  async getRegionalPerformance(
    startDate?: Date,
    endDate?: Date,
  ): Promise<
    Array<{
      region: string;
      avgResponseTime: number;
      errorRate: number;
      throughput: number;
      totalRequests: number;
    }>
  > {
    try {
      const matchQuery: any = {};

      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = startDate;
        if (endDate) matchQuery.createdAt.$lte = endDate;
      }

      // Get performance data grouped by IP
      const performanceData = await this.usageModel.aggregate([
        {
          $match: matchQuery,
        },
        {
          $group: {
            _id: '$ipAddress',
            totalRequests: { $sum: 1 },
            avgResponseTime: { $avg: '$responseTime' },
            errorCount: {
              $sum: {
                $cond: [{ $gt: ['$errorCode', 0] }, 1, 0],
              },
            },
            firstRequest: { $min: '$createdAt' },
            lastRequest: { $max: '$createdAt' },
          },
        },
        {
          $project: {
            ipAddress: '$_id',
            totalRequests: 1,
            avgResponseTime: 1,
            errorRate: {
              $cond: [
                { $eq: ['$totalRequests', 0] },
                0,
                {
                  $multiply: [
                    { $divide: ['$errorCount', '$totalRequests'] },
                    100,
                  ],
                },
              ],
            },
            throughput: {
              $cond: [
                { $eq: ['$firstRequest', '$lastRequest'] },
                0,
                {
                  $divide: [
                    '$totalRequests',
                    {
                      $divide: [
                        { $subtract: ['$lastRequest', '$firstRequest'] },
                        1000, // Convert to seconds
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
        {
          $limit: 10000, // Limit for performance
        },
      ]);

      // Group by region
      const regionMap = new Map<
        string,
        {
          totalRequests: number;
          responseTimes: number[];
          errorRates: number[];
          throughputs: number[];
        }
      >();

      for (const data of performanceData) {
        if (!data.ipAddress) continue;

        try {
          const geo = geoip.lookup(data.ipAddress);
          if (!geo) continue;

          // Group by continent/region (simplified)
          const region = this.getRegionFromCountry(geo.country);

          const existing = regionMap.get(region) || {
            totalRequests: 0,
            responseTimes: [],
            errorRates: [],
            throughputs: [],
          };

          existing.totalRequests += data.totalRequests;
          if (data.avgResponseTime) {
            existing.responseTimes.push(data.avgResponseTime);
          }
          existing.errorRates.push(data.errorRate);
          if (data.throughput) {
            existing.throughputs.push(data.throughput);
          }

          regionMap.set(region, existing);
        } catch (error) {
          // Skip invalid IP addresses
        }
      }

      // Calculate averages
      const regionalPerformance = Array.from(regionMap.entries()).map(
        ([region, data]) => {
          const avgResponseTime =
            data.responseTimes.length > 0
              ? data.responseTimes.reduce((sum, time) => sum + time, 0) /
                data.responseTimes.length
              : 0;

          const avgErrorRate =
            data.errorRates.length > 0
              ? data.errorRates.reduce((sum, rate) => sum + rate, 0) /
                data.errorRates.length
              : 0;

          const avgThroughput =
            data.throughputs.length > 0
              ? data.throughputs.reduce(
                  (sum, throughput) => sum + throughput,
                  0,
                ) / data.throughputs.length
              : 0;

          return {
            region,
            avgResponseTime,
            errorRate: avgErrorRate,
            throughput: avgThroughput,
            totalRequests: data.totalRequests,
          };
        },
      );

      return regionalPerformance.sort(
        (a, b) => b.totalRequests - a.totalRequests,
      );
    } catch (error) {
      this.logger.error('Error getting regional performance:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminGeographicPatternsService',
        operation: 'getRegionalPerformance',
      });
      throw error;
    }
  }

  /**
   * Get available geographic regions
   */
  async getGeographicRegions(): Promise<
    Array<{
      region: string;
      countries: string[];
      totalUsers: number;
      totalRequests: number;
      totalCost: number;
    }>
  > {
    try {
      this.logger.log('Getting geographic regions data', {
        component: 'AdminGeographicPatternsService',
        operation: 'getGeographicRegions',
      });

      // Get all usage data from the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const usageData = await this.usageModel
        .aggregate([
          {
            $match: {
              createdAt: { $gte: thirtyDaysAgo },
            },
          },
          {
            $project: {
              ipAddress: 1,
              userId: 1,
              cost: 1,
            },
          },
        ])
        .exec();

      // Group by region
      const regionStats = new Map<
        string,
        {
          countries: Set<string>;
          users: Set<string>;
          requests: number;
          cost: number;
        }
      >();

      for (const usage of usageData) {
        if (!usage.ipAddress) continue;

        try {
          const geo = geoip.lookup(usage.ipAddress);
          if (!geo) continue;

          const region = this.getRegionFromCountry(geo.country);

          const existing = regionStats.get(region) || {
            countries: new Set(),
            users: new Set(),
            requests: 0,
            cost: 0,
          };

          existing.countries.add(geo.country);
          existing.users.add(usage.userId);
          existing.requests += 1;
          existing.cost += usage.cost || 0;

          regionStats.set(region, existing);
        } catch (error) {
          // Skip invalid IP addresses (already logged in other methods)
        }
      }

      // Convert to array and sort by request count
      const regions = Array.from(regionStats.entries()).map(
        ([region, stats]) => ({
          region,
          countries: Array.from(stats.countries).sort(),
          totalUsers: stats.users.size,
          totalRequests: stats.requests,
          totalCost: stats.cost,
        }),
      );

      return regions.sort((a, b) => b.totalRequests - a.totalRequests);
    } catch (error) {
      this.logger.error('Error getting geographic regions:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminGeographicPatternsService',
        operation: 'getGeographicRegions',
      });
      throw error;
    }
  }

  /**
   * Get cost distribution by geographic region
   */
  async getCostDistributionByRegion(
    startDate?: Date,
    endDate?: Date,
  ): Promise<
    Array<{
      region: string;
      totalCost: number;
      percentageOfTotal: number;
      avgCostPerRequest: number;
      requestCount: number;
      topCountries: Array<{
        country: string;
        cost: number;
        percentage: number;
      }>;
    }>
  > {
    try {
      this.logger.log('Getting cost distribution by region', {
        component: 'AdminGeographicPatternsService',
        operation: 'getCostDistributionByRegion',
        startDate,
        endDate,
      });

      const matchQuery: any = {};
      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = startDate;
        if (endDate) matchQuery.createdAt.$lte = endDate;
      }

      // Aggregate cost data by region and country
      const costData = await this.usageModel
        .aggregate([
          {
            $match: matchQuery,
          },
          {
            $project: {
              ipAddress: 1,
              cost: 1,
            },
          },
        ])
        .exec();

      const regionCostMap = new Map<
        string,
        {
          totalCost: number;
          requestCount: number;
          countries: Map<string, number>;
        }
      >();

      let totalGlobalCost = 0;

      for (const usage of costData) {
        if (!usage.ipAddress) continue;

        try {
          const geo = geoip.lookup(usage.ipAddress);
          if (!geo) continue;

          const region = this.getRegionFromCountry(geo.country);
          const cost = usage.cost || 0;

          totalGlobalCost += cost;

          const existing = regionCostMap.get(region) || {
            totalCost: 0,
            requestCount: 0,
            countries: new Map(),
          };

          existing.totalCost += cost;
          existing.requestCount += 1;

          const countryCost = existing.countries.get(geo.country) || 0;
          existing.countries.set(geo.country, countryCost + cost);

          regionCostMap.set(region, existing);
        } catch (error) {
          // Skip invalid IP addresses
        }
      }

      // Convert to array with percentages and top countries
      const costDistribution = Array.from(regionCostMap.entries()).map(
        ([region, data]) => {
          const topCountries = Array.from(data.countries.entries())
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5) // Top 5 countries
            .map(([country, cost]) => ({
              country,
              cost,
              percentage:
                data.totalCost > 0 ? (cost / data.totalCost) * 100 : 0,
            }));

          return {
            region,
            totalCost: data.totalCost,
            percentageOfTotal:
              totalGlobalCost > 0
                ? (data.totalCost / totalGlobalCost) * 100
                : 0,
            avgCostPerRequest:
              data.requestCount > 0 ? data.totalCost / data.requestCount : 0,
            requestCount: data.requestCount,
            topCountries,
          };
        },
      );

      return costDistribution.sort((a, b) => b.totalCost - a.totalCost);
    } catch (error) {
      this.logger.error('Error getting cost distribution by region:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'AdminGeographicPatternsService',
        operation: 'getCostDistributionByRegion',
      });
      throw error;
    }
  }

  /**
   * Get region from country code (simplified)
   */
  private getRegionFromCountry(countryCode: string): string {
    const regionMap: Record<string, string> = {
      // North America
      US: 'North America',
      CA: 'North America',
      MX: 'North America',
      // South America
      BR: 'South America',
      AR: 'South America',
      CO: 'South America',
      PE: 'South America',
      CL: 'South America',
      VE: 'South America',
      EC: 'South America',
      UY: 'South America',
      PY: 'South America',
      BO: 'South America',
      // Europe
      GB: 'Europe',
      DE: 'Europe',
      FR: 'Europe',
      IT: 'Europe',
      ES: 'Europe',
      NL: 'Europe',
      BE: 'Europe',
      CH: 'Europe',
      AT: 'Europe',
      SE: 'Europe',
      NO: 'Europe',
      DK: 'Europe',
      FI: 'Europe',
      PL: 'Europe',
      CZ: 'Europe',
      HU: 'Europe',
      GR: 'Europe',
      PT: 'Europe',
      IE: 'Europe',
      RU: 'Europe',
      // Asia
      JP: 'Asia',
      CN: 'Asia',
      IN: 'Asia',
      KR: 'Asia',
      SG: 'Asia',
      TH: 'Asia',
      MY: 'Asia',
      ID: 'Asia',
      PH: 'Asia',
      VN: 'Asia',
      HK: 'Asia',
      TW: 'Asia',
      IL: 'Asia',
      AE: 'Asia',
      SA: 'Asia',
      QA: 'Asia',
      KW: 'Asia',
      BH: 'Asia',
      OM: 'Asia',
      TR: 'Asia',
      // Oceania
      AU: 'Oceania',
      NZ: 'Oceania',
      // Africa
      ZA: 'Africa',
      EG: 'Africa',
      NG: 'Africa',
      KE: 'Africa',
    };

    return regionMap[countryCode] || 'Other';
  }
}
