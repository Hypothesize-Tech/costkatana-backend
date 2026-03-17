import { Injectable } from '@nestjs/common';
import {
  PricingClient,
  GetProductsCommand,
  GetProductsCommandInput,
} from '@aws-sdk/client-pricing';
import { LoggerService } from '../../../common/logger/logger.service';
import { StsCredentialService } from './sts-credential.service';

export interface AWSPricingInfo {
  service: string;
  instanceType?: string;
  region: string;
  pricePerHour?: number;
  pricePerGBSecond?: number;
  pricePerRequest?: number;
  /** ECS Fargate vCPU-hour rate */
  pricePerVcpuHour?: number;
  /** ECS Fargate memory GB-hour rate */
  pricePerGBHour?: number;
  /** S3 storage per GB-month */
  pricePerGBMonth?: number;
  currency: string;
  effectiveDate: Date;
  pricingModel?: 'OnDemand' | 'Reserved' | 'Spot';
  termLength?: string; // For reserved instances
  description?: string;
  lastUpdated?: Date;
}

export interface PricingFilters {
  serviceCode: string;
  region?: string;
  instanceType?: string;
  operation?: string;
  productFamily?: string;
}

@Injectable()
export class AwsPricingService {
  private pricingClient: PricingClient;
  private cache = new Map<
    string,
    {
      data: AWSPricingInfo;
      expires: Date;
      accessCount: number;
      lastAccessed: Date;
    }
  >();
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000; // 1 second

  // Configuration constants
  private readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
  private readonly MAX_RESULTS = 100;
  private readonly REQUEST_TIMEOUT = 30000; // 30 seconds

  // Cache metrics tracking
  private cacheHits = 0;
  private cacheMisses = 0;
  private totalRequests = 0;

  // Historical pricing tracking for trends
  private priceHistory = new Map<
    string,
    Array<{ timestamp: Date; price: number }>
  >();

  constructor(
    private readonly stsCredentialService: StsCredentialService,
    private readonly logger: LoggerService,
  ) {
    this.initializePricingClient();
  }

  private async initializePricingClient() {
    try {
      // Use us-east-1 for pricing API (it's a global service)
      // Pricing API doesn't require specific connection, uses standard AWS credentials
      this.pricingClient = new PricingClient({
        region: 'us-east-1',
      });
      this.logger.log('AWS Pricing client initialized successfully');
    } catch (error) {
      this.logger.warn('Failed to initialize AWS Pricing client', { error });
      // Fallback: create client without specific configuration
      this.pricingClient = new PricingClient({ region: 'us-east-1' });
    }
  }

  /**
   * Get EC2 pricing information
   */
  async getEC2Pricing(
    instanceType: string,
    region: string = 'us-east-1',
  ): Promise<AWSPricingInfo | null> {
    try {
      const cacheKey = `ec2-${instanceType}-${region}`;
      const cached = this.getCachedPricing(cacheKey);
      if (cached) return cached;

      const filters: PricingFilters = {
        serviceCode: 'AmazonEC2',
        region,
        instanceType,
      };

      const pricing = await this.getPricing(filters);
      if (pricing) {
        this.setCachedPricing(cacheKey, pricing);
      }

      return pricing;
    } catch (error) {
      this.logger.error('Failed to get EC2 pricing', {
        instanceType,
        region,
        error,
        context: 'AwsPricingService',
      });
      return null;
    }
  }

  /**
   * Get RDS pricing information
   */
  async getRDSPricing(
    dbInstanceClass: string,
    region: string = 'us-east-1',
    engine: string = 'MySQL',
  ): Promise<AWSPricingInfo | null> {
    try {
      const cacheKey = `rds-${dbInstanceClass}-${region}`;
      const cached = this.getCachedPricing(cacheKey);
      if (cached) return cached;

      const filters: PricingFilters = {
        serviceCode: 'AmazonRDS',
        region,
        instanceType: dbInstanceClass,
      };
      const params = await this.getPricingWithEngine(filters, engine);
      if (params) {
        this.setCachedPricing(cacheKey, params);
        return params;
      }
      return null;
    } catch (error) {
      this.logger.error('Failed to get RDS pricing', {
        dbInstanceClass,
        region,
        error,
        context: 'AwsPricingService',
      });
      return null;
    }
  }

  /**
   * Get S3 pricing for a region
   */
  async getS3Pricing(
    region: string = 'us-east-1',
  ): Promise<AWSPricingInfo | null> {
    try {
      const cacheKey = `s3-${region}`;
      const cached = this.getCachedPricing(cacheKey);
      if (cached) return cached;

      const filters: PricingFilters = {
        serviceCode: 'AmazonS3',
        region,
      };
      const pricing = await this.getPricing(filters);
      if (pricing) {
        this.setCachedPricing(cacheKey, pricing);
      }
      return pricing;
    } catch (error) {
      this.logger.error('Failed to get S3 pricing', { region, error });
      return null;
    }
  }

  /**
   * Get DynamoDB pricing for provisioned capacity
   */
  async getDynamoDBPricing(
    region: string = 'us-east-1',
    billingMode: 'PROVISIONED' | 'PAY_PER_REQUEST' = 'PROVISIONED',
  ): Promise<AWSPricingInfo | null> {
    if (billingMode === 'PAY_PER_REQUEST') {
      return null; // Pay-per-request has no hourly rate
    }
    try {
      const cacheKey = `dynamodb-${billingMode}-${region}`;
      const cached = this.getCachedPricing(cacheKey);
      if (cached) return cached;

      const filters: PricingFilters = {
        serviceCode: 'AmazonDynamoDB',
        region,
        productFamily: 'DynamoDB Write Capacity',
      };
      const pricing = await this.getPricing(filters);
      if (pricing) {
        this.setCachedPricing(cacheKey, pricing);
      }
      return pricing;
    } catch (error) {
      this.logger.error('Failed to get DynamoDB pricing', { region, error });
      return null;
    }
  }

  /**
   * Get ECS Fargate pricing for a region
   */
  async getECSFargatePricing(
    region: string = 'us-east-1',
  ): Promise<AWSPricingInfo | null> {
    try {
      const cacheKey = `ecs-fargate-${region}`;
      const cached = this.getCachedPricing(cacheKey);
      if (cached) return cached;

      const filters: PricingFilters = {
        serviceCode: 'AmazonECS',
        region,
      };
      const pricing = await this.getPricing(filters);
      if (pricing) {
        this.setCachedPricing(cacheKey, pricing);
      }
      return pricing;
    } catch (error) {
      this.logger.error('Failed to get ECS pricing', { region, error });
      return null;
    }
  }

  /**
   * Helper to get pricing with engine filter for RDS
   */
  private async getPricingWithEngine(
    filters: PricingFilters,
    engine: string,
  ): Promise<AWSPricingInfo | null> {
    const params: GetProductsCommandInput = {
      ServiceCode: filters.serviceCode,
      Filters: [
        {
          Type: 'TERM_MATCH',
          Field: 'regionCode',
          Value: filters.region || 'us-east-1',
        },
        {
          Type: 'TERM_MATCH',
          Field: 'instanceType',
          Value: filters.instanceType || '',
        },
        { Type: 'TERM_MATCH', Field: 'engine', Value: engine },
      ],
      MaxResults: this.MAX_RESULTS,
    };
    const response = await this.pricingClient.send(
      new GetProductsCommand(params),
    );
    if (!response.PriceList?.length) return null;
    return this.findBestPricingMatch(response.PriceList, filters);
  }

  /**
   * Get Lambda pricing information
   */
  async getLambdaPricing(
    region: string = 'us-east-1',
  ): Promise<AWSPricingInfo | null> {
    try {
      const cacheKey = `lambda-${region}`;
      const cached = this.getCachedPricing(cacheKey);
      if (cached) return cached;

      const filters: PricingFilters = {
        serviceCode: 'AWSLambda',
        region,
        operation: 'Request',
      };

      const pricing = await this.getPricing(filters);
      if (pricing) {
        this.setCachedPricing(cacheKey, pricing);
      }

      return pricing;
    } catch (error) {
      this.logger.error('Failed to get Lambda pricing', {
        region,
        error,
        context: 'AwsPricingService',
      });
      return null;
    }
  }

  /**
   * Get generic AWS pricing information with retry logic
   */
  async getPricing(filters: PricingFilters): Promise<AWSPricingInfo | null> {
    let lastError: any = null;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const params: GetProductsCommandInput = {
          ServiceCode: filters.serviceCode,
          Filters: [
            {
              Type: 'TERM_MATCH',
              Field: 'regionCode',
              Value: filters.region || 'us-east-1',
            },
          ],
          MaxResults: this.MAX_RESULTS,
        };

        // Add specific filters based on service type
        this.addServiceSpecificFilters(params, filters);

        this.logger.debug('Fetching pricing from AWS API', {
          attempt,
          serviceCode: filters.serviceCode,
          region: filters.region,
          instanceType: filters.instanceType,
          operation: filters.operation,
          filterCount: params.Filters?.length || 0,
        });

        const command = new GetProductsCommand(params);

        // Add timeout and better error handling to the request
        const response = (await Promise.race([
          this.pricingClient.send(command),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('AWS Pricing API request timeout')),
              this.REQUEST_TIMEOUT,
            ),
          ),
        ])) as any;

        if (!response.PriceList || response.PriceList.length === 0) {
          this.logger.warn('No pricing data returned from AWS API', {
            serviceCode: filters.serviceCode,
            region: filters.region,
            priceListLength: response.PriceList?.length || 0,
          });
          return null;
        }

        // Try to find the best matching pricing data
        const pricingInfo = this.findBestPricingMatch(
          response.PriceList,
          filters,
        );

        if (pricingInfo) {
          this.logger.debug('Successfully retrieved pricing from AWS API', {
            serviceCode: filters.serviceCode,
            region: pricingInfo.region,
            instanceType: pricingInfo.instanceType,
            hasPricePerHour: !!pricingInfo.pricePerHour,
            hasPricePerGBSecond: !!pricingInfo.pricePerGBSecond,
            hasPricePerRequest: !!pricingInfo.pricePerRequest,
          });
          return pricingInfo;
        } else {
          this.logger.warn(
            'Failed to parse any pricing data from AWS response',
            {
              serviceCode: filters.serviceCode,
              responseCount: response.PriceList.length,
            },
          );
          return null;
        }
      } catch (error) {
        lastError = error;
        this.logger.warn(`AWS pricing API attempt ${attempt} failed`, {
          serviceCode: filters.serviceCode,
          region: filters.region,
          attempt,
          maxRetries: this.MAX_RETRIES,
          error: error instanceof Error ? error.message : String(error),
        });

        // Wait before retrying (except on last attempt)
        if (attempt < this.MAX_RETRIES) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.RETRY_DELAY * attempt),
          );
        }
      }
    }

    this.logger.error('All AWS pricing API attempts failed', {
      serviceCode: filters.serviceCode,
      region: filters.region,
      instanceType: filters.instanceType,
      maxRetries: this.MAX_RETRIES,
      finalError:
        lastError instanceof Error ? lastError.message : String(lastError),
    });

    return null;
  }

  /**
   * Add service-specific filters to the pricing request
   */
  private addServiceSpecificFilters(
    params: GetProductsCommandInput,
    filters: PricingFilters,
  ): void {
    // Add specific filters
    if (filters.instanceType) {
      params.Filters!.push({
        Type: 'TERM_MATCH',
        Field: 'instanceType',
        Value: filters.instanceType,
      });
    }

    if (filters.operation) {
      params.Filters!.push({
        Type: 'TERM_MATCH',
        Field: 'operation',
        Value: filters.operation,
      });
    }

    if (filters.productFamily) {
      params.Filters!.push({
        Type: 'TERM_MATCH',
        Field: 'productFamily',
        Value: filters.productFamily,
      });
    }

    // Add additional filters based on service type
    switch (filters.serviceCode) {
      case 'AmazonEC2':
        // EC2 specific filters
        params.Filters!.push({
          Type: 'TERM_MATCH',
          Field: 'tenancy',
          Value: 'Shared', // Default to shared tenancy
        });
        params.Filters!.push({
          Type: 'TERM_MATCH',
          Field: 'operatingSystem',
          Value: 'Linux', // Default to Linux
        });
        break;

      case 'AWSLambda':
        // Lambda doesn't need additional filters typically
        break;

      case 'AmazonRDS':
        params.Filters!.push({
          Type: 'TERM_MATCH',
          Field: 'engine',
          Value: 'MySQL', // Default engine
        });
        break;

      default:
        // Generic service - no additional filters needed
        break;
    }
  }

  /**
   * Find the best matching pricing data from multiple results
   */
  private findBestPricingMatch(
    priceList: any[],
    filters: PricingFilters,
  ): AWSPricingInfo | null {
    for (const priceData of priceList) {
      try {
        const pricingInfo = this.parsePricingData(priceData, filters);
        if (pricingInfo && this.hasValidPricing(pricingInfo)) {
          return pricingInfo;
        }
      } catch (error) {
        this.logger.warn('Failed to parse pricing data from result', {
          serviceCode: filters.serviceCode,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return null;
  }

  /**
   * Check if pricing info has valid pricing data
   */
  private hasValidPricing(pricingInfo: AWSPricingInfo): boolean {
    return !!(
      pricingInfo.pricePerHour ||
      pricingInfo.pricePerGBSecond ||
      pricingInfo.pricePerRequest ||
      pricingInfo.pricePerVcpuHour ||
      pricingInfo.pricePerGBHour ||
      pricingInfo.pricePerGBMonth
    );
  }

  /**
   * Parse AWS pricing API response with production-ready parsing
   */
  private parsePricingData(
    priceData: any,
    filters: PricingFilters,
  ): AWSPricingInfo | null {
    try {
      if (!priceData || !priceData.terms) {
        this.logger.warn('Invalid pricing data structure', {
          hasPriceData: !!priceData,
          hasTerms: !!priceData?.terms,
        });
        return null;
      }

      const pricingInfo: AWSPricingInfo = {
        service: filters.serviceCode,
        region: filters.region || 'us-east-1',
        currency: 'USD',
        effectiveDate: new Date(),
        pricingModel: 'OnDemand',
        lastUpdated: new Date(),
      };

      if (filters.instanceType) {
        pricingInfo.instanceType = filters.instanceType;
      }

      // Extract effective date from pricing data
      if (priceData.effectiveDate) {
        pricingInfo.effectiveDate = new Date(priceData.effectiveDate);
      }

      // Process OnDemand pricing (most common)
      if (priceData.terms.OnDemand) {
        this.parseOnDemandPricing(
          priceData.terms.OnDemand,
          pricingInfo,
          filters,
        );
      }

      // Process Reserved Instance pricing if available
      if (priceData.terms.Reserved) {
        this.parseReservedPricing(
          priceData.terms.Reserved,
          pricingInfo,
          filters,
        );
      }

      // Validate that we extracted some pricing information
      if (
        !pricingInfo.pricePerHour &&
        !pricingInfo.pricePerGBSecond &&
        !pricingInfo.pricePerRequest &&
        !pricingInfo.pricePerVcpuHour &&
        !pricingInfo.pricePerGBHour &&
        !pricingInfo.pricePerGBMonth
      ) {
        this.logger.warn('No pricing information extracted from AWS response', {
          serviceCode: filters.serviceCode,
          instanceType: filters.instanceType,
          region: filters.region,
          availableTerms: Object.keys(priceData.terms),
        });
        return null;
      }

      return pricingInfo;
    } catch (error) {
      this.logger.error('Failed to parse pricing data', {
        error: error instanceof Error ? error.message : String(error),
        serviceCode: filters.serviceCode,
        instanceType: filters.instanceType,
        region: filters.region,
        priceDataKeys: priceData ? Object.keys(priceData) : [],
      });
      return null;
    }
  }

  /**
   * Parse OnDemand pricing terms
   */
  private parseOnDemandPricing(
    onDemandTerms: any,
    pricingInfo: AWSPricingInfo,
    filters: PricingFilters,
  ): void {
    try {
      const termKeys = Object.keys(onDemandTerms);

      for (const termKey of termKeys) {
        const term = onDemandTerms[termKey];

        // Check if this term matches our filters (instance type, etc.)
        if (!this.termMatchesFilters(term, filters)) {
          continue;
        }

        if (term.priceDimensions) {
          this.parsePriceDimensions(term.priceDimensions, pricingInfo, filters);
        }

        // For services like Lambda, we typically only need one matching term
        if (
          pricingInfo.pricePerHour ||
          pricingInfo.pricePerGBSecond ||
          pricingInfo.pricePerRequest
        ) {
          break;
        }
      }
    } catch (error) {
      this.logger.warn('Failed to parse OnDemand pricing', { error });
    }
  }

  /**
   * Parse Reserved Instance pricing terms
   */
  private parseReservedPricing(
    reservedTerms: any,
    pricingInfo: AWSPricingInfo,
    filters: PricingFilters,
  ): void {
    try {
      if (!reservedTerms || Object.keys(reservedTerms).length === 0) {
        return;
      }

      this.logger.debug('Parsing Reserved Instance pricing', {
        serviceCode: filters.serviceCode,
        instanceType: filters.instanceType,
        reservedTermsCount: Object.keys(reservedTerms).length,
      });

      // Find the most favorable Reserved Instance pricing
      let bestReservedPricing: {
        termLength: string;
        paymentOption: string;
        effectiveHourlyRate: number;
        upfrontCost: number;
        monthlyCost: number;
      } | null = null;

      for (const termKey of Object.keys(reservedTerms)) {
        const term = reservedTerms[termKey];

        if (!term.termAttributes || !this.termMatchesFilters(term, filters)) {
          continue;
        }

        const termLength = term.termAttributes?.leaseContractLength || '1yr';
        const paymentOption =
          term.termAttributes?.purchaseOption || 'No Upfront';

        if (term.priceDimensions) {
          const reservedPricing = this.calculateReservedPricing(
            term.priceDimensions,
            termLength,
            paymentOption,
          );

          if (
            reservedPricing &&
            (!bestReservedPricing ||
              reservedPricing.effectiveHourlyRate <
                bestReservedPricing.effectiveHourlyRate)
          ) {
            bestReservedPricing = {
              termLength,
              paymentOption,
              ...reservedPricing,
            };
          }
        }
      }

      if (bestReservedPricing) {
        // Add Reserved Instance information to pricing info
        pricingInfo.pricingModel = 'Reserved';
        pricingInfo.termLength = bestReservedPricing.termLength;
        pricingInfo.description = `Reserved Instance (${bestReservedPricing.termLength}, ${bestReservedPricing.paymentOption})`;

        // Calculate effective hourly rate vs OnDemand
        if (pricingInfo.pricePerHour) {
          const savingsPercent =
            ((pricingInfo.pricePerHour -
              bestReservedPricing.effectiveHourlyRate) /
              pricingInfo.pricePerHour) *
            100;
          this.logger.debug('Reserved Instance pricing calculated', {
            instanceType: filters.instanceType,
            onDemandHourly: pricingInfo.pricePerHour,
            reservedHourly: bestReservedPricing.effectiveHourlyRate,
            savingsPercent: Math.round(savingsPercent * 100) / 100,
            termLength: bestReservedPricing.termLength,
            paymentOption: bestReservedPricing.paymentOption,
          });
        }
      } else {
        this.logger.debug('No suitable Reserved Instance pricing found', {
          serviceCode: filters.serviceCode,
          instanceType: filters.instanceType,
        });
      }
    } catch (error) {
      this.logger.warn('Failed to parse Reserved pricing', {
        error: error instanceof Error ? error.message : String(error),
        serviceCode: filters.serviceCode,
        instanceType: filters.instanceType,
      });
    }
  }

  /**
   * Calculate Reserved Instance pricing from price dimensions
   */
  private calculateReservedPricing(
    priceDimensions: any,
    termLength: string,
    paymentOption: string,
  ): {
    effectiveHourlyRate: number;
    upfrontCost: number;
    monthlyCost: number;
  } | null {
    try {
      let upfrontCost = 0;
      let monthlyCost = 0;
      let hourlyCost = 0;

      // Parse price dimensions
      for (const dimensionKey of Object.keys(priceDimensions)) {
        const dimension = priceDimensions[dimensionKey];

        if (!dimension.pricePerUnit?.USD) {
          continue;
        }

        const price = parseFloat(dimension.pricePerUnit.USD);
        const unit = dimension.unit;
        const description = dimension.description || '';

        // Categorize pricing components
        if (description.toLowerCase().includes('upfront')) {
          upfrontCost = price;
        } else if (unit === 'Hrs') {
          hourlyCost = price;
        } else if (
          unit === 'Quantity' ||
          description.toLowerCase().includes('monthly')
        ) {
          monthlyCost = price;
        }
      }

      // Calculate term length in hours
      const hoursInTerm = this.getHoursInTerm(termLength);

      // Calculate effective hourly rate
      let effectiveHourlyRate = hourlyCost;

      if (upfrontCost > 0) {
        // Add amortized upfront cost
        effectiveHourlyRate += upfrontCost / hoursInTerm;
      }

      if (monthlyCost > 0) {
        // Add monthly cost converted to hourly
        effectiveHourlyRate += (monthlyCost * 12) / hoursInTerm; // Monthly to hourly
      }

      return {
        effectiveHourlyRate,
        upfrontCost,
        monthlyCost,
      };
    } catch (error) {
      this.logger.warn('Failed to calculate Reserved Instance pricing', {
        error,
      });
      return null;
    }
  }

  /**
   * Get total hours in a term length
   */
  private getHoursInTerm(termLength: string): number {
    const termMatch = termLength.match(/(\d+)\s*yr?/i);
    if (!termMatch) {
      return 8760; // Default to 1 year (365.25 * 24)
    }

    const years = parseInt(termMatch[1]);
    return years * 8760; // Hours in a year (accounting for leap years)
  }

  /**
   * Compare OnDemand vs Reserved Instance pricing with detailed analysis
   */
  comparePricingOptions(
    onDemandPricing: AWSPricingInfo,
    reservedPricing?: AWSPricingInfo,
  ): {
    recommended: 'ondemand' | 'reserved';
    savings: number;
    savingsPercentage: number;
    breakEvenMonths: number;
    breakEvenInfo: {
      upfrontCost: number;
      monthlySavings: number;
      breakEvenPoint: number;
    };
    comparison: {
      onDemand: { hourly: number; monthly: number; yearly: number };
      reserved: {
        hourly: number;
        monthly: number;
        yearly: number;
        upfront: number;
        termLength: string;
      };
    };
    recommendation: {
      reason: string;
      confidence: number;
      alternativeScenarios: Array<{
        scenario: string;
        recommended: 'ondemand' | 'reserved';
        savings: number;
      }>;
    };
  } {
    const onDemandHourly = onDemandPricing.pricePerHour || 0;
    const reservedHourly =
      reservedPricing?.pricePerHour || onDemandHourly * 0.7; // Fallback assumption
    const termLength = reservedPricing?.termLength || '1yr';

    // Calculate monthly and yearly costs
    const onDemandMonthly = onDemandHourly * 24 * 30.44; // More accurate monthly calculation
    const onDemandYearly = onDemandHourly * 24 * 365.25;

    // Calculate reserved costs (simplified - in production would use actual RI pricing)
    const reservedMonthly = reservedHourly * 24 * 30.44;
    const reservedYearly = reservedHourly * 24 * 365.25;
    const upfrontCost = this.estimateReservedUpfrontCost(
      onDemandHourly,
      termLength,
    );

    const comparison = {
      onDemand: {
        hourly: onDemandHourly,
        monthly: Math.round(onDemandMonthly * 100) / 100,
        yearly: Math.round(onDemandYearly * 100) / 100,
      },
      reserved: {
        hourly: reservedHourly,
        monthly: Math.round(reservedMonthly * 100) / 100,
        yearly: Math.round(reservedYearly * 100) / 100,
        upfront: upfrontCost,
        termLength,
      },
    };

    // Calculate savings and break-even analysis
    const yearlySavings =
      onDemandYearly - reservedYearly - upfrontCost / parseInt(termLength);
    const savingsPercentage =
      onDemandYearly > 0 ? (yearlySavings / onDemandYearly) * 100 : 0;

    // Calculate break-even point
    const monthlySavings = onDemandMonthly - reservedMonthly;
    const breakEvenMonths =
      upfrontCost > 0 && monthlySavings > 0
        ? Math.ceil(upfrontCost / monthlySavings)
        : 0;

    // Determine recommendation
    let recommended: 'ondemand' | 'reserved';
    let reason: string;
    let confidence: number;

    if (!reservedPricing) {
      recommended = 'ondemand';
      reason = 'No Reserved Instance pricing available';
      confidence = 1.0;
    } else if (breakEvenMonths > parseInt(termLength) * 12) {
      recommended = 'ondemand';
      reason = `Break-even period (${breakEvenMonths} months) exceeds commitment term`;
      confidence = 0.8;
    } else if (savingsPercentage > 20) {
      recommended = 'reserved';
      reason = `Significant savings opportunity (${Math.round(savingsPercentage)}% annual savings)`;
      confidence = 0.9;
    } else if (savingsPercentage > 10) {
      recommended = 'reserved';
      reason = `Moderate savings opportunity (${Math.round(savingsPercentage)}% annual savings)`;
      confidence = 0.7;
    } else {
      recommended = 'ondemand';
      reason = `Minimal savings (${Math.round(savingsPercentage)}% annual savings)`;
      confidence = 0.6;
    }

    // Generate alternative scenarios
    const alternativeScenarios = this.generateAlternativeScenarios(
      onDemandPricing,
      reservedPricing,
    );

    return {
      recommended,
      savings: Math.round(yearlySavings * 100) / 100,
      savingsPercentage: Math.round(savingsPercentage * 100) / 100,
      breakEvenMonths,
      breakEvenInfo: {
        upfrontCost,
        monthlySavings: Math.round(monthlySavings * 100) / 100,
        breakEvenPoint: breakEvenMonths,
      },
      comparison,
      recommendation: {
        reason,
        confidence,
        alternativeScenarios,
      },
    };
  }

  /**
   * Estimate Reserved Instance upfront costs
   */
  private estimateReservedUpfrontCost(
    onDemandHourly: number,
    termLength: string,
  ): number {
    const years = parseInt(termLength) || 1;
    const annualOnDemandCost = onDemandHourly * 24 * 365.25;

    // Simplified upfront cost estimation (in production would use actual AWS pricing)
    const upfrontPercentage = years === 3 ? 0.5 : years === 1 ? 0.3 : 0.1; // 50% for 3yr, 30% for 1yr, 10% for others
    const estimatedDiscount = years === 3 ? 0.4 : years === 1 ? 0.3 : 0.2; // 40% for 3yr, 30% for 1yr, 20% for others

    const discountedAnnualCost = annualOnDemandCost * (1 - estimatedDiscount);
    return Math.round(discountedAnnualCost * upfrontPercentage * 100) / 100;
  }

  /**
   * Generate alternative pricing scenarios for comparison
   */
  private generateAlternativeScenarios(
    onDemandPricing: AWSPricingInfo,
    reservedPricing?: AWSPricingInfo,
  ): Array<{
    scenario: string;
    recommended: 'ondemand' | 'reserved';
    savings: number;
  }> {
    const scenarios = [];
    const onDemandHourly = onDemandPricing.pricePerHour || 0;

    // Scenario 1: High utilization (100% uptime)
    const highUtilSavings = this.calculateScenarioSavings(
      onDemandHourly,
      1.0,
      reservedPricing,
    );
    scenarios.push({
      scenario: '100% utilization (24/7)',
      recommended: (highUtilSavings > 1000 ? 'reserved' : 'ondemand') as
        | 'reserved'
        | 'ondemand',
      savings: highUtilSavings,
    });

    // Scenario 2: Medium utilization (70% uptime)
    const mediumUtilSavings = this.calculateScenarioSavings(
      onDemandHourly,
      0.7,
      reservedPricing,
    );
    scenarios.push({
      scenario: '70% utilization (business hours)',
      recommended: (mediumUtilSavings > 500 ? 'reserved' : 'ondemand') as
        | 'reserved'
        | 'ondemand',
      savings: mediumUtilSavings,
    });

    // Scenario 3: Low utilization (30% uptime)
    const lowUtilSavings = this.calculateScenarioSavings(
      onDemandHourly,
      0.3,
      reservedPricing,
    );
    scenarios.push({
      scenario: '30% utilization (development)',
      recommended: (lowUtilSavings > 100 ? 'reserved' : 'ondemand') as
        | 'reserved'
        | 'ondemand',
      savings: lowUtilSavings,
    });

    return scenarios;
  }

  /**
   * Calculate savings for a specific utilization scenario
   */
  private calculateScenarioSavings(
    onDemandHourly: number,
    utilizationRate: number,
    reservedPricing?: AWSPricingInfo,
  ): number {
    const effectiveOnDemandHourly = onDemandHourly * utilizationRate;
    const reservedHourly =
      reservedPricing?.pricePerHour || onDemandHourly * 0.7;

    const annualOnDemand = effectiveOnDemandHourly * 24 * 365.25;
    const annualReserved = reservedHourly * 24 * 365.25;
    const upfrontCost = reservedPricing
      ? this.estimateReservedUpfrontCost(
          onDemandHourly,
          reservedPricing.termLength || '1yr',
        )
      : 0;

    const yearlySavings = annualOnDemand - annualReserved - upfrontCost / 3; // Amortized over 3 years
    return Math.round(yearlySavings * 100) / 100;
  }

  /**
   * Check if a pricing term matches our filters
   */
  private termMatchesFilters(term: any, filters: PricingFilters): boolean {
    try {
      if (!term || !term.termAttributes) {
        return false;
      }

      const attributes = term.termAttributes;

      // Check service-specific filters
      switch (filters.serviceCode) {
        case 'AmazonEC2':
          return this.matchesEC2Filters(attributes, filters);

        case 'AWSLambda':
          return this.matchesLambdaFilters(attributes, filters);

        case 'AmazonRDS':
          return this.matchesRDSFilters(attributes, filters);

        case 'AmazonS3':
          return this.matchesS3Filters(attributes, filters);

        default:
          // For unknown services, do basic validation
          return this.matchesGenericFilters(attributes, filters);
      }
    } catch (error) {
      this.logger.warn('Error checking term filters', {
        error: error instanceof Error ? error.message : String(error),
        serviceCode: filters.serviceCode,
        instanceType: filters.instanceType,
      });
      return false;
    }
  }

  /**
   * Check EC2-specific term filters
   */
  private matchesEC2Filters(attributes: any, filters: PricingFilters): boolean {
    // Check instance type
    if (filters.instanceType) {
      const termInstanceType =
        attributes.instanceType || attributes.instanceTypeFamily;
      if (
        termInstanceType &&
        !this.instanceTypeMatches(termInstanceType, filters.instanceType)
      ) {
        return false;
      }
    }

    // Check tenancy (shared/dedicated)
    if (
      attributes.tenancy &&
      attributes.tenancy !== 'Shared' &&
      attributes.tenancy !== 'default'
    ) {
      // Skip dedicated host pricing unless specifically requested
      return false;
    }

    // Check operating system (default to Linux)
    if (attributes.operatingSystem) {
      const os = attributes.operatingSystem.toLowerCase();
      if (os.includes('windows') || os.includes('sql')) {
        // Skip Windows/SQL pricing unless specifically requested
        return false;
      }
    }

    // Check license model
    if (
      attributes.licenseModel &&
      attributes.licenseModel !== 'No License required'
    ) {
      // Skip license-required pricing
      return false;
    }

    return true;
  }

  /**
   * Check Lambda-specific term filters
   */
  private matchesLambdaFilters(
    attributes: any,
    filters: PricingFilters,
  ): boolean {
    // Lambda pricing is mostly global, but we can check architecture
    if (attributes.architecture && filters.instanceType) {
      // instanceType might be used to specify architecture (arm64/x86_64)
      const requestedArch = filters.instanceType.toLowerCase();
      const termArch = attributes.architecture.toLowerCase();
      if (
        !termArch.includes(requestedArch) &&
        !requestedArch.includes(termArch)
      ) {
        return false;
      }
    }

    // Check for specific Lambda operations
    if (filters.operation) {
      // Lambda operations might include 'Request', 'Duration', etc.
      if (
        attributes.operation &&
        !attributes.operation.includes(filters.operation)
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check RDS-specific term filters
   */
  private matchesRDSFilters(attributes: any, filters: PricingFilters): boolean {
    // Check instance type
    if (filters.instanceType) {
      const termInstanceType = attributes.instanceType;
      if (termInstanceType && termInstanceType !== filters.instanceType) {
        return false;
      }
    }

    // Check database engine (default to MySQL if not specified)
    if (attributes.databaseEngine) {
      const engine = attributes.databaseEngine.toLowerCase();
      // Allow MySQL by default, filter others unless specifically requested
      if (!engine.includes('mysql') && !engine.includes('aurora')) {
        return false;
      }
    }

    // Check deployment option (Single-AZ by default)
    if (
      attributes.deploymentOption &&
      attributes.deploymentOption !== 'Single-AZ'
    ) {
      // Skip Multi-AZ pricing unless specifically requested
      return false;
    }

    return true;
  }

  /**
   * Check S3-specific term filters
   */
  private matchesS3Filters(attributes: any, filters: PricingFilters): boolean {
    // Check storage class (default to Standard)
    if (
      attributes.storageClass &&
      attributes.storageClass !== 'General Purpose'
    ) {
      // Skip other storage classes unless specifically requested
      return false;
    }

    // Check region
    if (
      attributes.regionCode &&
      filters.region &&
      attributes.regionCode !== filters.region
    ) {
      return false;
    }

    return true;
  }

  /**
   * Check generic term filters for unknown services
   */
  private matchesGenericFilters(
    attributes: any,
    filters: PricingFilters,
  ): boolean {
    // Basic validation - ensure term has required attributes
    if (
      filters.instanceType &&
      attributes.instanceType &&
      attributes.instanceType !== filters.instanceType
    ) {
      return false;
    }

    if (
      filters.region &&
      attributes.regionCode &&
      attributes.regionCode !== filters.region
    ) {
      return false;
    }

    return true;
  }

  /**
   * Check if instance types match (with some flexibility)
   */
  private instanceTypeMatches(
    termInstanceType: string,
    requestedInstanceType: string,
  ): boolean {
    // Exact match
    if (termInstanceType === requestedInstanceType) {
      return true;
    }

    // Family match (e.g., "t3" matches "t3.micro")
    const termFamily = termInstanceType.split('.')[0];
    const requestedFamily = requestedInstanceType.split('.')[0];

    if (termFamily === requestedFamily) {
      return true;
    }

    // Size match within family (e.g., "micro" matches "t3.micro")
    const termSize = termInstanceType.split('.')[1];
    const requestedSize = requestedInstanceType.split('.')[1];

    if (termSize && requestedSize && termSize === requestedSize) {
      // Check if the family is compatible
      return this.areInstanceFamiliesCompatible(termFamily, requestedFamily);
    }

    return false;
  }

  /**
   * Check if instance families are compatible
   */
  private areInstanceFamiliesCompatible(
    family1: string,
    family2: string,
  ): boolean {
    // Some families are interchangeable or similar
    const compatibleFamilies: Record<string, string[]> = {
      t3: ['t3', 't3a', 't2'],
      t4g: ['t4g', 't3', 't3a'],
      m5: ['m5', 'm5a', 'm4'],
      m6g: ['m6g', 'm5', 'm5a'],
      c5: ['c5', 'c5a', 'c4'],
      c6g: ['c6g', 'c5', 'c5a'],
      r5: ['r5', 'r5a', 'r4'],
      r6g: ['r6g', 'r5', 'r5a'],
    };

    return (
      compatibleFamilies[family1]?.includes(family2) ||
      compatibleFamilies[family2]?.includes(family1) ||
      false
    );
  }

  /**
   * Parse price dimensions from a pricing term
   */
  private parsePriceDimensions(
    priceDimensions: any,
    pricingInfo: AWSPricingInfo,
    filters: PricingFilters,
  ): void {
    try {
      const dimensionKeys = Object.keys(priceDimensions);

      for (const dimensionKey of dimensionKeys) {
        const dimension = priceDimensions[dimensionKey];

        if (!dimension || !dimension.pricePerUnit) {
          continue;
        }

        const priceUSD = dimension.pricePerUnit.USD;
        if (!priceUSD || isNaN(parseFloat(priceUSD))) {
          continue;
        }

        const price = parseFloat(priceUSD);
        const unit = dimension.unit;
        const description = dimension.description || '';

        // Parse based on unit and service type
        switch (filters.serviceCode) {
          case 'AmazonEC2':
            this.parseEC2Pricing(price, unit, description, pricingInfo);
            break;
          case 'AWSLambda':
            this.parseLambdaPricing(price, unit, description, pricingInfo);
            break;
          case 'AmazonECS':
            this.parseECSPricing(price, unit, description, pricingInfo);
            break;
          case 'AmazonS3':
            this.parseS3Pricing(price, unit, description, pricingInfo);
            break;
          case 'AmazonRDS':
          case 'AmazonDynamoDB':
          default:
            this.parseGenericPricing(price, unit, description, pricingInfo);
            break;
        }
      }
    } catch (error) {
      this.logger.warn('Failed to parse price dimensions', { error });
    }
  }

  /**
   * Parse EC2-specific pricing
   */
  private parseEC2Pricing(
    price: number,
    unit: string,
    description: string,
    pricingInfo: AWSPricingInfo,
  ): void {
    switch (unit) {
      case 'Hrs':
        if (!pricingInfo.pricePerHour || price < pricingInfo.pricePerHour) {
          pricingInfo.pricePerHour = price;
        }
        break;
      case 'Hrs (Windows)':
        // Windows pricing - could add separate field if needed
        if (!pricingInfo.pricePerHour || price < pricingInfo.pricePerHour) {
          pricingInfo.pricePerHour = price;
        }
        break;
      default:
        this.logger.debug('Unrecognized EC2 pricing unit', {
          unit,
          price,
          description,
        });
        break;
    }
  }

  /**
   * Parse Lambda-specific pricing
   */
  private parseLambdaPricing(
    price: number,
    unit: string,
    description: string,
    pricingInfo: AWSPricingInfo,
  ): void {
    switch (unit) {
      case 'GB-Seconds':
        pricingInfo.pricePerGBSecond = price;
        break;
      case 'Requests':
        pricingInfo.pricePerRequest = price;
        break;
      case 'Lambda-GB-Second':
        pricingInfo.pricePerGBSecond = price;
        break;
      case 'Lambda-Request':
        pricingInfo.pricePerRequest = price;
        break;
      default:
        this.logger.debug('Unrecognized Lambda pricing unit', {
          unit,
          price,
          description,
        });
        break;
    }
  }

  /**
   * Parse ECS Fargate pricing (vCPU-hours and GB-hours)
   */
  private parseECSPricing(
    price: number,
    unit: string,
    _description: string,
    pricingInfo: AWSPricingInfo,
  ): void {
    switch (unit) {
      case 'vCPU-Hours':
      case 'vCPU-Hour':
        pricingInfo.pricePerVcpuHour = price;
        break;
      case 'GB-Hours':
      case 'GB-Hour':
        pricingInfo.pricePerGBHour = price;
        break;
      case 'Hrs':
      case 'Hours':
        if (!pricingInfo.pricePerVcpuHour) pricingInfo.pricePerVcpuHour = price;
        break;
      default:
        break;
    }
  }

  /**
   * Parse S3 storage pricing
   */
  private parseS3Pricing(
    price: number,
    unit: string,
    _description: string,
    pricingInfo: AWSPricingInfo,
  ): void {
    switch (unit) {
      case 'GB-Mo':
      case 'GB-Month':
        pricingInfo.pricePerGBMonth = price;
        break;
      case 'GB':
        if (!pricingInfo.pricePerGBMonth) pricingInfo.pricePerGBMonth = price;
        break;
      default:
        break;
    }
  }

  /**
   * Parse generic service pricing
   */
  private parseGenericPricing(
    price: number,
    unit: string,
    description: string,
    pricingInfo: AWSPricingInfo,
  ): void {
    switch (unit) {
      case 'Hrs':
      case 'Hours':
        pricingInfo.pricePerHour = price;
        break;
      case 'Requests':
        pricingInfo.pricePerRequest = price;
        break;
      case 'GB-Seconds':
      case 'GB-Sec':
        pricingInfo.pricePerGBSecond = price;
        break;
      case 'GB':
        // Could be storage pricing - add separate field if needed
        break;
      default:
        this.logger.debug('Unrecognized pricing unit', {
          service: pricingInfo.service,
          unit,
          price,
          description,
        });
        break;
    }
  }

  /**
   * Get cached pricing information with metrics tracking
   */
  private getCachedPricing(key: string): AWSPricingInfo | null {
    this.totalRequests++;
    const cached = this.cache.get(key);

    if (cached) {
      if (cached.expires > new Date()) {
        this.cacheHits++;
        cached.accessCount++;
        cached.lastAccessed = new Date();

        this.logger.debug('Pricing cache hit', {
          key,
          expiresAt: cached.expires,
          accessCount: cached.accessCount,
          context: 'AwsPricingService',
        });

        return cached.data;
      } else {
        // Remove expired cache
        this.cache.delete(key);
        this.cacheMisses++;
        this.logger.debug('Pricing cache expired and removed', {
          key,
          context: 'AwsPricingService',
        });
      }
    } else {
      this.cacheMisses++;
    }

    return null;
  }

  /**
   * Set cached pricing information with historical tracking
   */
  private setCachedPricing(key: string, data: AWSPricingInfo): void {
    const expires = new Date();
    expires.setTime(expires.getTime() + this.CACHE_TTL);

    const now = new Date();
    const cacheEntry = {
      data,
      expires,
      accessCount: 0,
      lastAccessed: now,
    };

    this.cache.set(key, cacheEntry);

    // Track historical pricing data
    this.trackPriceHistory(key, data, now);

    this.logger.debug('Pricing cached', {
      key,
      service: data.service,
      instanceType: data.instanceType,
      pricePerHour: data.pricePerHour,
      expiresAt: expires,
    });
  }

  /**
   * Track historical pricing data for trend analysis
   */
  private trackPriceHistory(
    key: string,
    data: AWSPricingInfo,
    timestamp: Date,
  ): void {
    if (!this.priceHistory.has(key)) {
      this.priceHistory.set(key, []);
    }

    const history = this.priceHistory.get(key)!;
    const price =
      data.pricePerHour || data.pricePerGBSecond || data.pricePerRequest || 0;

    if (price > 0) {
      history.push({ timestamp, price });

      // Keep only last 90 days of history to prevent memory bloat
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const filteredHistory = history.filter(
        (entry) => entry.timestamp >= ninetyDaysAgo,
      );
      this.priceHistory.set(key, filteredHistory);
    }
  }

  /**
   * Get pricing for multiple services/regions in batch with comprehensive tracking
   */
  async getBulkPricing(
    requests: PricingFilters[],
  ): Promise<Map<string, AWSPricingInfo | null>> {
    const results = new Map<string, AWSPricingInfo | null>();
    const startTime = Date.now();
    let successfulRequests = 0;
    let failedRequests = 0;
    let cacheHits = 0;
    let cacheMisses = 0;
    let apiRequests = 0;

    this.logger.log(
      `Starting bulk pricing request for ${requests.length} items`,
      {
        batchSize: requests.length,
        services: [...new Set(requests.map((r) => r.serviceCode))],
        regions: [...new Set(requests.map((r) => r.region))],
      },
    );

    // Process in batches to avoid overwhelming the API
    const batchSize = 5;
    for (let i = 0; i < requests.length; i += batchSize) {
      const batch = requests.slice(i, i + batchSize);
      const batchPromises = batch.map(async (filters) => {
        const cacheKey = this.generateCacheKey(filters);
        const batchStartTime = Date.now();
        let wasCacheHit = false;

        try {
          // Check cache first
          const cachedPricing = this.getCachedPricing(cacheKey);
          if (cachedPricing) {
            cacheHits++;
            successfulRequests++;
            results.set(cacheKey, cachedPricing);
            wasCacheHit = true;

            this.logger.debug('Bulk pricing cache hit', {
              cacheKey,
              serviceCode: filters.serviceCode,
              region: filters.region,
              duration: Date.now() - batchStartTime,
            });

            return {
              cacheKey,
              success: true,
              duration: Date.now() - batchStartTime,
              wasCacheHit: true,
            };
          }

          // Cache miss - fetch from API
          cacheMisses++;
          apiRequests++;
          const pricing = await this.getPricing(filters);
          const duration = Date.now() - batchStartTime;

          if (pricing) {
            successfulRequests++;
            results.set(cacheKey, pricing);
            this.logger.debug('Bulk pricing API request successful', {
              cacheKey,
              serviceCode: filters.serviceCode,
              region: filters.region,
              duration,
              pricePerHour: pricing.pricePerHour,
            });
          } else {
            failedRequests++;
            results.set(cacheKey, null);
            this.logger.warn('Bulk pricing API request returned no data', {
              cacheKey,
              filters,
              duration,
            });
          }

          return { cacheKey, success: !!pricing, duration, wasCacheHit: false };
        } catch (error) {
          failedRequests++;
          const duration = Date.now() - batchStartTime;
          results.set(cacheKey, null);

          this.logger.error('Failed to get pricing in bulk request', {
            cacheKey,
            filters,
            duration,
            wasCacheHit,
            error: error instanceof Error ? error.message : String(error),
          });

          return {
            cacheKey,
            success: false,
            duration,
            wasCacheHit,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);

      // Log batch progress
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(requests.length / batchSize);
      const batchSuccessful = batchResults.filter(
        (r) => r.status === 'fulfilled' && r.value.success,
      ).length;
      const batchCacheHits = batchResults.filter(
        (r) => r.status === 'fulfilled' && r.value.wasCacheHit,
      ).length;

      this.logger.debug(
        `Bulk pricing batch ${batchNumber}/${totalBatches} completed`,
        {
          batchSize: batch.length,
          successful: batchSuccessful,
          cacheHits: batchCacheHits,
          apiRequests: batch.length - batchCacheHits,
          batchDuration: Date.now() - startTime,
        },
      );

      // Rate limiting delay between batches (except for last batch)
      if (i + batchSize < requests.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    const totalDuration = Date.now() - startTime;
    const successRate =
      requests.length > 0 ? (successfulRequests / requests.length) * 100 : 0;
    const cacheHitRate =
      successfulRequests + failedRequests > 0
        ? (cacheHits / (successfulRequests + failedRequests)) * 100
        : 0;

    this.logger.log(`Completed bulk pricing request`, {
      totalRequests: requests.length,
      successfulRequests,
      failedRequests,
      successRate: Math.round(successRate * 100) / 100,
      totalDuration,
      averageDuration: Math.round(totalDuration / requests.length),
      cacheHits,
      cacheMisses,
      apiRequests,
      cacheHitRate: Math.round(cacheHitRate * 100) / 100,
      resultsCount: results.size,
      efficiency:
        cacheHits > 0
          ? Math.round((cacheHits / (cacheHits + apiRequests)) * 100)
          : 0,
    });

    return results;
  }

  /**
   * Compare pricing across regions for the same service
   */
  async compareRegionalPricing(
    serviceCode: string,
    instanceType?: string,
    regions: string[] = ['us-east-1', 'eu-west-1', 'ap-southeast-1'],
  ): Promise<AWSPricingInfo[]> {
    const requests: PricingFilters[] = regions.map((region) => ({
      serviceCode,
      region,
      instanceType,
    }));

    const results = await this.getBulkPricing(requests);
    const pricingData: AWSPricingInfo[] = [];

    for (const [cacheKey, pricing] of results) {
      if (pricing) {
        pricingData.push(pricing);
      }
    }

    this.logger.log(
      `Regional pricing comparison completed for ${serviceCode}`,
      {
        instanceType,
        regionsRequested: regions.length,
        regionsFound: pricingData.length,
      },
    );

    return pricingData;
  }

  /**
   * Get cost estimation for a specific usage pattern
   */
  calculateEstimatedCost(
    pricingInfo: AWSPricingInfo,
    usage: {
      hoursPerMonth?: number;
      gbSecondsPerMonth?: number;
      requestsPerMonth?: number;
    },
  ): { estimatedCost: number; breakdown: Record<string, number> } {
    const breakdown: Record<string, number> = {};
    let totalCost = 0;

    if (usage.hoursPerMonth && pricingInfo.pricePerHour) {
      const hourlyCost = usage.hoursPerMonth * pricingInfo.pricePerHour;
      breakdown.hourly = hourlyCost;
      totalCost += hourlyCost;
    }

    if (usage.gbSecondsPerMonth && pricingInfo.pricePerGBSecond) {
      const gbSecondCost =
        usage.gbSecondsPerMonth * pricingInfo.pricePerGBSecond;
      breakdown.gbSecond = gbSecondCost;
      totalCost += gbSecondCost;
    }

    if (usage.requestsPerMonth && pricingInfo.pricePerRequest) {
      const requestCost = usage.requestsPerMonth * pricingInfo.pricePerRequest;
      breakdown.requests = requestCost;
      totalCost += requestCost;
    }

    return {
      estimatedCost: Math.round(totalCost * 100) / 100, // Round to 2 decimal places
      breakdown,
    };
  }

  /**
   * Generate cache key for pricing requests
   */
  private generateCacheKey(filters: PricingFilters): string {
    return `${filters.serviceCode}:${filters.region || 'global'}:${filters.instanceType || 'default'}:${filters.operation || 'default'}`;
  }

  /**
   * Get fallback pricing when API is unavailable
   */
  /**
   * Get current fallback pricing from cache or compute updated values
   * Updated with latest AWS pricing as of 2024
   */
  getFallbackPricing(
    service: string,
    instanceType?: string,
    region: string = 'us-east-1',
  ): AWSPricingInfo {
    const cacheKey = `fallback-${service}-${instanceType || 'default'}-${region}`;
    const cached = this.getCachedPricing(cacheKey);

    if (cached) {
      return cached;
    }

    // Compute updated fallback pricing based on current AWS pricing (as of late 2024)
    const fallback = this.computeUpdatedFallbackPricing(
      service,
      instanceType,
      region,
    );

    // Cache the fallback pricing for 24 hours
    const pricingInfo: AWSPricingInfo = {
      service,
      region,
      currency: 'USD',
      effectiveDate: new Date(),
      pricingModel: 'OnDemand',
      description: 'Updated fallback pricing (API unavailable)',
      lastUpdated: new Date(),
      ...fallback,
    };

    this.setCachedPricing(cacheKey, pricingInfo);
    return pricingInfo;
  }

  /**
   * Compute updated fallback pricing with current AWS rates
   */
  private computeUpdatedFallbackPricing(
    service: string,
    instanceType?: string,
    region: string = 'us-east-1',
  ): Partial<AWSPricingInfo> {
    const regionMultipliers: Record<string, number> = {
      'us-east-1': 1.0, // Virginia (baseline)
      'us-west-2': 1.0, // Oregon
      'eu-west-1': 1.1, // Ireland
      'eu-central-1': 1.05, // Frankfurt
      'ap-southeast-1': 1.15, // Singapore
      'ap-northeast-1': 1.2, // Tokyo
    };

    const regionMultiplier = regionMultipliers[region] || 1.0;

    switch (service) {
      case 'AmazonEC2':
        return {
          service: 'AmazonEC2',
          instanceType,
          pricePerHour:
            this.getUpdatedEC2FallbackPrice(instanceType) * regionMultiplier,
        };

      case 'AWSLambda':
        // Updated Lambda pricing (Dec 2024)
        return {
          service: 'AWSLambda',
          pricePerRequest: 0.2 / 1000000, // $0.20 per 1M requests
          pricePerGBSecond: 0.0000166667 * regionMultiplier, // ~$0.00001667 per GB-second
        };

      case 'AmazonRDS':
        // Updated RDS pricing
        return {
          service: 'AmazonRDS',
          pricePerHour:
            this.getUpdatedRDSFallbackPrice(instanceType) * regionMultiplier,
        };

      case 'AmazonS3':
        // Updated S3 pricing (Standard storage)
        return {
          service: 'AmazonS3',
          pricePerGBMonth: 0.023 * regionMultiplier,
          pricePerGBSecond: (0.023 / (30 * 24 * 3600)) * regionMultiplier,
        };

      case 'AmazonECS':
        // Updated ECS/Fargate pricing (vCPU + memory)
        return {
          service: 'AmazonECS',
          pricePerVcpuHour: 0.04048 * regionMultiplier,
          pricePerGBHour: 0.004445 * regionMultiplier,
        };

      case 'AmazonDynamoDB':
        // Provisioned write capacity unit per hour
        return {
          service: 'AmazonDynamoDB',
          pricePerHour: 0.00065 * regionMultiplier, // per WCU-hour
        };

      default:
        return {
          service,
          description: `Generic pricing for ${service}`,
        };
    }
  }

  /**
   * Get updated EC2 fallback pricing based on instance type (2024 pricing)
   */
  private getUpdatedEC2FallbackPrice(instanceType?: string): number {
    if (!instanceType) return 0.0106; // t3.micro updated price

    // Updated EC2 pricing as of late 2024
    const instancePricing: Record<string, number> = {
      // T3 instances - updated pricing
      't3.micro': 0.0106,
      't3.small': 0.0212,
      't3.medium': 0.0424,
      't3.large': 0.0848,
      't3.xlarge': 0.1696,
      't3.2xlarge': 0.3392,

      // T4g instances (Graviton) - updated pricing
      't4g.micro': 0.0085,
      't4g.small': 0.017,
      't4g.medium': 0.034,
      't4g.large': 0.068,
      't4g.xlarge': 0.136,
      't4g.2xlarge': 0.272,

      // M5 instances - updated pricing
      'm5.large': 0.096,
      'm5.xlarge': 0.192,
      'm5.2xlarge': 0.384,
      'm5.4xlarge': 0.768,
      'm5.8xlarge': 1.536,
      'm5.12xlarge': 2.304,
      'm5.16xlarge': 3.072,
      'm5.24xlarge': 4.608,

      // M6g instances (Graviton2) - updated pricing
      'm6g.medium': 0.0384,
      'm6g.large': 0.0768,
      'm6g.xlarge': 0.1536,
      'm6g.2xlarge': 0.3072,
      'm6g.4xlarge': 0.6144,
      'm6g.8xlarge': 1.2288,
      'm6g.12xlarge': 1.8432,
      'm6g.16xlarge': 2.4576,

      // C5 instances - updated pricing
      'c5.large': 0.085,
      'c5.xlarge': 0.17,
      'c5.2xlarge': 0.34,
      'c5.4xlarge': 0.68,
      'c5.9xlarge': 1.53,
      'c5.12xlarge': 2.04,
      'c5.18xlarge': 3.06,
      'c5.24xlarge': 4.08,

      // C6g instances (Graviton2) - updated pricing
      'c6g.medium': 0.034,
      'c6g.large': 0.068,
      'c6g.xlarge': 0.136,
      'c6g.2xlarge': 0.272,
      'c6g.4xlarge': 0.544,
      'c6g.8xlarge': 1.088,
      'c6g.12xlarge': 1.632,
      'c6g.16xlarge': 2.176,

      // R5 instances - updated pricing
      'r5.large': 0.126,
      'r5.xlarge': 0.252,
      'r5.2xlarge': 0.504,
      'r5.4xlarge': 1.008,
      'r5.8xlarge': 2.016,
      'r5.12xlarge': 3.024,
      'r5.16xlarge': 4.032,
      'r5.24xlarge': 6.048,

      // R6g instances (Graviton2) - updated pricing
      'r6g.medium': 0.0398,
      'r6g.large': 0.0796,
      'r6g.xlarge': 0.1592,
      'r6g.2xlarge': 0.3184,
      'r6g.4xlarge': 0.6368,
      'r6g.8xlarge': 1.2736,
      'r6g.12xlarge': 1.9104,
      'r6g.16xlarge': 2.5472,

      // I3 instances (storage optimized) - updated pricing
      'i3.large': 0.312,
      'i3.xlarge': 0.624,
      'i3.2xlarge': 1.248,
      'i3.4xlarge': 2.496,
      'i3.8xlarge': 4.992,
      'i3.16xlarge': 9.984,

      // T3a instances (AMD) - updated pricing
      't3a.micro': 0.0094,
      't3a.small': 0.0188,
      't3a.medium': 0.0376,
      't3a.large': 0.0752,
      't3a.xlarge': 0.1504,
      't3a.2xlarge': 0.3008,
    };

    // Try exact match first
    if (instancePricing[instanceType]) {
      return instancePricing[instanceType];
    }

    // Try family matching with size-based scaling
    const [family, size] = instanceType.split('.');
    const sizeMultipliers: Record<string, number> = {
      micro: 0.0625, // 1/16
      small: 0.125, // 1/8
      medium: 0.25, // 1/4
      large: 0.5, // 1/2
      xlarge: 1.0, // baseline
      '2xlarge': 2.0,
      '3xlarge': 3.0,
      '4xlarge': 4.0,
      '6xlarge': 6.0,
      '8xlarge': 8.0,
      '9xlarge': 9.0,
      '12xlarge': 12.0,
      '16xlarge': 16.0,
      '18xlarge': 18.0,
      '24xlarge': 24.0,
    };

    const sizeMultiplier = sizeMultipliers[size] || 1.0;

    switch (family) {
      case 't3':
        return 0.0106 * sizeMultiplier;
      case 't4g':
        return 0.0085 * sizeMultiplier;
      case 't3a':
        return 0.0094 * sizeMultiplier;
      case 'm5':
        return 0.096 * sizeMultiplier;
      case 'm6g':
        return 0.0384 * sizeMultiplier;
      case 'c5':
        return 0.085 * sizeMultiplier;
      case 'c6g':
        return 0.034 * sizeMultiplier;
      case 'r5':
        return 0.126 * sizeMultiplier;
      case 'r6g':
        return 0.0398 * sizeMultiplier;
      case 'i3':
        return 0.312 * sizeMultiplier;
      case 'm6i':
        return 0.096 * sizeMultiplier; // Similar to m5
      case 'c6i':
        return 0.085 * sizeMultiplier; // Similar to c5
      case 'r6i':
        return 0.126 * sizeMultiplier; // Similar to r5
      default:
        return 0.0106; // Default to t3.micro pricing
    }
  }

  /**
   * Get updated RDS fallback pricing
   */
  private getUpdatedRDSFallbackPrice(instanceType?: string): number {
    if (!instanceType) return 0.017; // db.t3.micro default

    // Updated RDS pricing as of late 2024
    const rdsPricing: Record<string, number> = {
      // T3 instances
      'db.t3.micro': 0.017,
      'db.t3.small': 0.034,
      'db.t3.medium': 0.068,
      'db.t3.large': 0.136,
      'db.t3.xlarge': 0.272,
      'db.t3.2xlarge': 0.544,

      // T4g instances (Graviton)
      'db.t4g.micro': 0.0134,
      'db.t4g.small': 0.0268,
      'db.t4g.medium': 0.0536,
      'db.t4g.large': 0.1072,
      'db.t4g.xlarge': 0.2144,

      // M5 instances
      'db.m5.large': 0.142,
      'db.m5.xlarge': 0.284,
      'db.m5.2xlarge': 0.568,
      'db.m5.4xlarge': 1.136,
      'db.m5.8xlarge': 2.272,
      'db.m5.12xlarge': 3.408,
      'db.m5.16xlarge': 4.544,
      'db.m5.24xlarge': 6.816,

      // M6g instances (Graviton2)
      'db.m6g.large': 0.135,
      'db.m6g.xlarge': 0.27,
      'db.m6g.2xlarge': 0.54,
      'db.m6g.4xlarge': 1.08,
      'db.m6g.8xlarge': 2.16,
      'db.m6g.12xlarge': 3.24,
      'db.m6g.16xlarge': 4.32,

      // R5 instances
      'db.r5.large': 0.222,
      'db.r5.xlarge': 0.444,
      'db.r5.2xlarge': 0.888,
      'db.r5.4xlarge': 1.776,
      'db.r5.8xlarge': 3.552,
      'db.r5.12xlarge': 5.328,
      'db.r5.16xlarge': 7.104,
      'db.r5.24xlarge': 10.656,

      // R6g instances (Graviton2)
      'db.r6g.large': 0.209,
      'db.r6g.xlarge': 0.418,
      'db.r6g.2xlarge': 0.836,
      'db.r6g.4xlarge': 1.672,
      'db.r6g.8xlarge': 3.344,
      'db.r6g.12xlarge': 5.016,
      'db.r6g.16xlarge': 6.688,
    };

    return rdsPricing[instanceType] || 0.017; // Default to t3.micro
  }

  /**
   * Clear pricing cache and reset metrics (useful for testing or forced refresh)
   */
  clearCache(): void {
    this.cache.clear();
    this.priceHistory.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.totalRequests = 0;
    this.logger.log('Pricing cache and metrics cleared');
  }

  /**
   * Get cache statistics with real metrics
   */
  getCacheStats(): {
    size: number;
    entries: string[];
    hitRate: number;
    totalRequests: number;
    cacheHits: number;
    cacheMisses: number;
  } {
    const hitRate =
      this.totalRequests > 0 ? (this.cacheHits / this.totalRequests) * 100 : 0;

    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
      totalRequests: this.totalRequests,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      hitRate: Math.round(hitRate * 100) / 100, // Round to 2 decimal places
    };
  }

  /**
   * Health check for the pricing service
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    clientInitialized: boolean;
    cacheSize: number;
    lastApiCall?: Date;
    errors: string[];
  }> {
    const errors: string[] = [];
    let clientInitialized = false;
    let lastApiCall: Date | undefined;

    try {
      clientInitialized = !!this.pricingClient;
      if (!clientInitialized) {
        errors.push('Pricing client not initialized');
      }

      // Try a simple pricing call to test connectivity
      const testPricing = await this.getEC2Pricing('t3.micro', 'us-east-1');
      if (testPricing) {
        lastApiCall = new Date();
      } else {
        errors.push('Failed to fetch test pricing data');
      }
    } catch (error) {
      errors.push(
        `Health check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      healthy: errors.length === 0 && clientInitialized,
      clientInitialized,
      cacheSize: this.cache.size,
      lastApiCall,
      errors,
    };
  }

  /**
   * Get service status and configuration info
   */
  getServiceStatus(): {
    cacheSize: number;
    cacheEntries: string[];
    clientConfigured: boolean;
    fallbackPricingAvailable: boolean;
    supportedServices: string[];
    cacheHitRate: number;
    lastPricingUpdate?: Date;
    totalRequests: number;
    cacheHits: number;
    cacheMisses: number;
  } {
    const cacheStats = this.getCacheStats();

    return {
      cacheSize: cacheStats.size,
      cacheEntries: cacheStats.entries,
      clientConfigured: !!this.pricingClient,
      fallbackPricingAvailable: true,
      supportedServices: [
        'AmazonEC2',
        'AWSLambda',
        'AmazonRDS',
        'AmazonS3',
        'AmazonElastiCache',
        'AmazonES',
      ],
      cacheHitRate: cacheStats.hitRate,
      lastPricingUpdate: this.getLastPricingUpdate(),
      totalRequests: cacheStats.totalRequests,
      cacheHits: cacheStats.cacheHits,
      cacheMisses: cacheStats.cacheMisses,
    };
  }

  /**
   * Get the last time pricing was updated from API
   */
  private getLastPricingUpdate(): Date | undefined {
    if (this.cache.size === 0) return undefined;

    let latestUpdate: Date | undefined;

    for (const [, cached] of this.cache) {
      if (!latestUpdate || cached.data.lastUpdated! > latestUpdate) {
        latestUpdate = cached.data.lastUpdated;
      }
    }

    return latestUpdate;
  }

  /**
   * Monitor pricing changes over time using historical data
   */
  async getPricingTrends(
    serviceCode: string,
    instanceType: string,
    region: string,
    days: number = 30,
  ): Promise<{
    currentPrice: number;
    averagePrice: number;
    priceChanges: Array<{ date: Date; price: number }>;
    trend: 'increasing' | 'decreasing' | 'stable';
    volatility: number;
    dataPoints: number;
    confidence: number;
  }> {
    const cacheKey = this.generateCacheKey({
      serviceCode,
      region,
      instanceType,
    });

    // Get current pricing
    let currentPricing: AWSPricingInfo | null = null;
    if (serviceCode === 'AmazonEC2') {
      currentPricing = await this.getEC2Pricing(instanceType, region);
    } else if (serviceCode === 'AWSLambda') {
      currentPricing = await this.getLambdaPricing(region);
    }

    const currentPrice =
      currentPricing?.pricePerHour ||
      currentPricing?.pricePerGBSecond ||
      currentPricing?.pricePerRequest ||
      0;

    // Get historical data from cache
    const history = this.priceHistory.get(cacheKey) || [];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const relevantHistory = history.filter(
      (entry) => entry.timestamp >= cutoffDate,
    );

    // If we don't have enough historical data, return current price as baseline
    if (relevantHistory.length < 2) {
      return {
        currentPrice,
        averagePrice: currentPrice,
        priceChanges: [{ date: new Date(), price: currentPrice }],
        trend: 'stable',
        volatility: 0,
        dataPoints: 1,
        confidence: 0.1, // Low confidence with limited data
      };
    }

    // Sort by date and calculate trends
    const sortedHistory = relevantHistory.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
    const prices = sortedHistory.map((h) => h.price);
    const priceChanges = sortedHistory.map((h) => ({
      date: h.timestamp,
      price: h.price,
    }));

    // Calculate average price
    const averagePrice =
      prices.reduce((sum, price) => sum + price, 0) / prices.length;

    // Determine trend using linear regression
    const trend = this.calculateTrend(sortedHistory);

    // Calculate volatility (coefficient of variation)
    const variance =
      prices.reduce(
        (sum, price) => sum + Math.pow(price - averagePrice, 2),
        0,
      ) / prices.length;
    const stdDev = Math.sqrt(variance);
    const volatility = averagePrice > 0 ? (stdDev / averagePrice) * 100 : 0; // Percentage

    // Calculate confidence based on data points and recency
    const confidence = this.calculateConfidence(sortedHistory, days);

    this.logger.debug('Pricing trends calculated', {
      serviceCode,
      instanceType,
      region,
      dataPoints: sortedHistory.length,
      currentPrice,
      averagePrice,
      trend,
      volatility: Math.round(volatility * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
    });

    return {
      currentPrice,
      averagePrice: Math.round(averagePrice * 10000) / 10000, // Round to 4 decimal places
      priceChanges,
      trend,
      volatility: Math.round(volatility * 100) / 100,
      dataPoints: sortedHistory.length,
      confidence: Math.round(confidence * 100) / 100,
    };
  }

  /**
   * Calculate trend using linear regression
   */
  private calculateTrend(
    history: Array<{ timestamp: Date; price: number }>,
  ): 'increasing' | 'decreasing' | 'stable' {
    if (history.length < 2) return 'stable';

    const n = history.length;
    const timestamps = history.map((h) => h.timestamp.getTime());
    const prices = history.map((h) => h.price);

    // Calculate means
    const meanTimestamp = timestamps.reduce((sum, t) => sum + t, 0) / n;
    const meanPrice = prices.reduce((sum, p) => sum + p, 0) / n;

    // Calculate slope
    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      const timestampDiff = timestamps[i] - meanTimestamp;
      const priceDiff = prices[i] - meanPrice;
      numerator += timestampDiff * priceDiff;
      denominator += timestampDiff * timestampDiff;
    }

    if (denominator === 0) return 'stable';

    const slope = numerator / denominator;
    const slopeThreshold = meanPrice * 0.001; // 0.1% change threshold

    if (slope > slopeThreshold) return 'increasing';
    if (slope < -slopeThreshold) return 'decreasing';
    return 'stable';
  }

  /**
   * Calculate confidence score based on data quality and recency
   */
  private calculateConfidence(
    history: Array<{ timestamp: Date; price: number }>,
    requestedDays: number,
  ): number {
    if (history.length === 0) return 0;

    const now = new Date();
    const oldestData = history[0].timestamp;
    const newestData = history[history.length - 1].timestamp;

    // Data coverage (how much of the requested period we have data for)
    const dataSpanDays =
      (newestData.getTime() - oldestData.getTime()) / (1000 * 60 * 60 * 24);
    const coverageRatio = Math.min(dataSpanDays / requestedDays, 1);

    // Data density (how many data points per day)
    const densityRatio = history.length / Math.max(dataSpanDays, 1);

    // Recency factor (how recent is the newest data)
    const hoursSinceLatest =
      (now.getTime() - newestData.getTime()) / (1000 * 60 * 60);
    const recencyScore = Math.max(0, 1 - hoursSinceLatest / 24); // Decay over 24 hours

    // Combine factors with weights
    const confidence =
      coverageRatio * 0.4 +
      Math.min(densityRatio, 2) * 0.3 +
      recencyScore * 0.3;

    return Math.min(confidence, 1.0);
  }

  /**
   * Get pricing alerts for significant changes using historical data
   */
  async getPricingAlerts(
    threshold: number = 0.05,
    services?: string[],
    regions?: string[],
    instanceTypes?: string[],
  ): Promise<
    Array<{
      service: string;
      instanceType: string;
      region: string;
      currentPrice: number;
      baselinePrice: number;
      priceChange: number;
      percentageChange: number;
      severity: 'low' | 'medium' | 'high';
      trend: 'increasing' | 'decreasing' | 'stable';
      confidence: number;
      detectedAt: Date;
    }>
  > {
    const alerts: Array<{
      service: string;
      instanceType: string;
      region: string;
      currentPrice: number;
      baselinePrice: number;
      priceChange: number;
      percentageChange: number;
      severity: 'low' | 'medium' | 'high';
      trend: 'increasing' | 'decreasing' | 'stable';
      confidence: number;
      detectedAt: Date;
    }> = [];

    // Default service configurations to check
    const servicesToCheck = services || ['AmazonEC2', 'AWSLambda'];
    const regionsToCheck = regions || [
      'us-east-1',
      'eu-west-1',
      'ap-southeast-1',
    ];
    const instanceTypesToCheck = instanceTypes || [
      't3.micro',
      't3.small',
      't3.medium',
      'm5.large',
    ];

    for (const service of servicesToCheck) {
      for (const region of regionsToCheck) {
        for (const instanceType of instanceTypesToCheck) {
          try {
            // Get current pricing
            let currentPricing: AWSPricingInfo | null = null;
            if (service === 'AmazonEC2') {
              currentPricing = await this.getEC2Pricing(instanceType, region);
            } else if (service === 'AWSLambda') {
              currentPricing = await this.getLambdaPricing(region);
            }

            if (!currentPricing) continue;

            const currentPrice =
              currentPricing.pricePerHour ||
              currentPricing.pricePerGBSecond ||
              currentPricing.pricePerRequest ||
              0;
            if (currentPrice === 0) continue;

            // Get historical trends to establish baseline
            const trends = await this.getPricingTrends(
              service,
              instanceType,
              region,
              30,
            );

            if (trends.dataPoints < 3) continue; // Need minimum historical data

            // Calculate baseline price (weighted average of recent prices, excluding outliers)
            const baselinePrice = this.calculateBaselinePrice(
              trends.priceChanges,
            );

            if (baselinePrice === 0) continue;

            // Calculate price change
            const priceChange = currentPrice - baselinePrice;
            const percentageChange = priceChange / baselinePrice;

            // Only alert if change exceeds threshold
            if (Math.abs(percentageChange) < threshold) continue;

            // Determine severity
            let severity: 'low' | 'medium' | 'high';
            const absPercentage = Math.abs(percentageChange);

            if (absPercentage > 0.15)
              severity = 'high'; // >15% change
            else if (absPercentage > 0.08)
              severity = 'medium'; // >8% change
            else severity = 'low'; // >5% change (threshold)

            // Determine trend direction
            const trend = priceChange > 0 ? 'increasing' : 'decreasing';

            alerts.push({
              service,
              instanceType,
              region,
              currentPrice,
              baselinePrice,
              priceChange,
              percentageChange,
              severity,
              trend,
              confidence: trends.confidence,
              detectedAt: new Date(),
            });

            this.logger.warn('Pricing alert detected', {
              service,
              instanceType,
              region,
              currentPrice,
              baselinePrice,
              percentageChange: Math.round(percentageChange * 10000) / 100,
              severity,
              confidence: trends.confidence,
            });
          } catch (error) {
            this.logger.error('Failed to check pricing alerts', {
              service,
              instanceType,
              region,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }

    // Sort alerts by severity and magnitude
    alerts.sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      const severityDiff =
        severityOrder[b.severity] - severityOrder[a.severity];
      if (severityDiff !== 0) return severityDiff;

      // If same severity, sort by percentage change magnitude
      return Math.abs(b.percentageChange) - Math.abs(a.percentageChange);
    });

    this.logger.info(
      `Pricing alerts generated: ${alerts.length} alerts found`,
      {
        servicesChecked: servicesToCheck.length,
        regionsChecked: regionsToCheck.length,
        instanceTypesChecked: instanceTypesToCheck.length,
        threshold,
      },
    );

    return alerts;
  }

  /**
   * Calculate baseline price from historical data, excluding outliers
   */
  private calculateBaselinePrice(
    priceHistory: Array<{ date: Date; price: number }>,
  ): number {
    if (priceHistory.length === 0) return 0;

    const prices = priceHistory.map((h) => h.price).sort((a, b) => a - b);
    const n = prices.length;

    // Remove outliers using interquartile range method
    const q1Index = Math.floor(n * 0.25);
    const q3Index = Math.floor(n * 0.75);
    const q1 = prices[q1Index];
    const q3 = prices[q3Index];
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    const filteredPrices = prices.filter(
      (price) => price >= lowerBound && price <= upperBound,
    );

    if (filteredPrices.length === 0) {
      // Fallback to median if all points are outliers
      return prices[Math.floor(n / 2)];
    }

    // Calculate weighted average (more recent prices have higher weight)
    let weightedSum = 0;
    let totalWeight = 0;

    filteredPrices.forEach((price, index) => {
      const weight = index + 1; // Linear weight increase
      weightedSum += price * weight;
      totalWeight += weight;
    });

    return weightedSum / totalWeight;
  }

  /**
   * Validate pricing data integrity
   */
  validatePricingData(pricing: AWSPricingInfo): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!pricing.service) errors.push('Missing service');
    if (!pricing.region) errors.push('Missing region');
    if (!pricing.currency) errors.push('Missing currency');
    if (!pricing.effectiveDate) errors.push('Missing effective date');

    // Check that at least one pricing field is present
    const hasPricing =
      pricing.pricePerHour ||
      pricing.pricePerGBSecond ||
      pricing.pricePerRequest;
    if (!hasPricing) errors.push('No pricing information found');

    // Validate pricing values
    if (pricing.pricePerHour && pricing.pricePerHour < 0)
      errors.push('Invalid price per hour');
    if (pricing.pricePerGBSecond && pricing.pricePerGBSecond < 0)
      errors.push('Invalid price per GB-second');
    if (pricing.pricePerRequest && pricing.pricePerRequest < 0)
      errors.push('Invalid price per request');

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
