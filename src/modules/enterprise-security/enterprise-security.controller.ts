import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  Body,
  HttpStatus,
  HttpCode,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { EnterpriseSecurityService } from './enterprise-security.service';

@Controller('api/enterprise-security')
export class EnterpriseSecurityController {
  constructor(
    private readonly enterpriseSecurityService: EnterpriseSecurityService,
  ) {}

  /**
   * GET /enterprise-security/dashboard
   * Get comprehensive security dashboard
   */
  @Get('dashboard')
  async getSecurityDashboard() {
    const startTime = Date.now();

    const dashboard =
      await this.enterpriseSecurityService.getSecurityDashboard();

    // Get additional security statistics
    const securityStats =
      await this.enterpriseSecurityService.getSecurityStatistics();

    const duration = Date.now() - startTime;

    return {
      success: true,
      data: {
        dashboard,
        statistics: securityStats,
        generated_at: Date.now(),
        performance: {
          generation_time: duration,
          cache_status: 'live',
        },
      },
    };
  }

  /**
   * GET /enterprise-security/compliance-report
   * Get compliance report for specific framework
   */
  @Get('compliance-report')
  async getComplianceReport(
    @Query('framework') framework: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
  ) {
    if (!framework) {
      throw new BadRequestException('Missing required parameter: framework');
    }

    const timeRange = {
      start: startDate
        ? parseInt(startDate, 10)
        : Date.now() - 30 * 24 * 60 * 60 * 1000, // Default 30 days
      end: endDate ? parseInt(endDate, 10) : Date.now(),
    };

    const report =
      await this.enterpriseSecurityService.generateComplianceReport(
        framework,
        timeRange,
      );

    return {
      success: true,
      data: {
        report,
        generated_at: Date.now(),
        performance: {
          generation_time: Date.now() - Date.now(), // Would track actual time
        },
      },
    };
  }

  /**
   * GET /enterprise-security/audit-events
   * Query audit events
   */
  @Get('audit-events')
  async queryAuditEvents(
    @Query()
    query: {
      event_types?: string;
      severity?: string;
      actor_ids?: string;
      risk_level?: string;
      search?: string;
      start_date?: string;
      end_date?: string;
      limit?: string;
      offset?: string;
      sort_by?: string;
      sort_order?: 'asc' | 'desc';
    },
  ) {
    const auditQuery = {
      eventTypes: query.event_types ? [query.event_types] : undefined,
      severity: query.severity ? [query.severity] : undefined,
      actorIds: query.actor_ids ? [query.actor_ids] : undefined,
      timeRange:
        query.start_date && query.end_date
          ? {
              start: parseInt(query.start_date, 10),
              end: parseInt(query.end_date, 10),
            }
          : undefined,
      riskLevel: query.risk_level ? [query.risk_level] : undefined,
      searchText: query.search,
      limit: query.limit ? parseInt(query.limit, 10) : 100,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
      sortBy: query.sort_by || 'timestamp',
      sortOrder: query.sort_order || 'desc',
    };

    const results =
      await this.enterpriseSecurityService.queryAuditEvents(auditQuery);

    return {
      success: true,
      data: {
        events: results.events,
        pagination: {
          total: results.total,
          limit: auditQuery.limit,
          offset: auditQuery.offset,
          has_more: results.hasMore,
        },
        aggregations: results.aggregations,
        performance: {
          query_time: Date.now() - Date.now(), // Would track actual time
        },
      },
    };
  }

  /**
   * POST /enterprise-security/test-filtering
   * Test content filtering
   */
  @Post('test-filtering')
  @HttpCode(HttpStatus.OK)
  async testContentFiltering(
    @Body() body: { content: string; provider?: string; model?: string },
  ) {
    const { content, provider = 'test', model = 'test' } = body;

    if (!content) {
      throw new BadRequestException('Missing required parameter: content');
    }

    const filterResult =
      await this.enterpriseSecurityService.testContentFiltering(content, {
        provider,
        model,
      });

    return {
      success: true,
      data: {
        filtering: {
          allowed: filterResult.filtering.allowed,
          modified: filterResult.filtering.modified,
          risk_score: filterResult.filtering.riskScore,
          detections: filterResult.filtering.detections.length,
          blocked_reason: filterResult.filtering.blockedReason,
        },
        classification: {
          level: filterResult.classification.classification.level,
          categories: filterResult.classification.classification.categories,
          confidence:
            filterResult.classification.classification.confidenceScore,
          risk_score: filterResult.classification.classification.riskScore,
          compliance_frameworks:
            filterResult.classification.classification.complianceFrameworks,
        },
        compliance: {
          compliant: filterResult.compliance.compliant,
          violations: filterResult.compliance.violations.length,
          allowed_with_conditions:
            filterResult.compliance.allowedWithConditions,
          required_actions: filterResult.compliance.requiredActions,
        },
        overall: {
          security_approved:
            filterResult.filtering.allowed && filterResult.compliance.compliant,
          risk_level: Math.max(
            filterResult.filtering.riskScore,
            filterResult.classification.classification.riskScore,
          ),
          processing_time: Date.now() - Date.now(), // Would track actual time
        },
      },
    };
  }

  /**
   * GET /enterprise-security/alerts
   * Get security alerts
   */
  @Get('alerts')
  async getSecurityAlerts(
    @Query()
    query: {
      severity?: string;
      category?: string;
      limit?: string;
      offset?: string;
    },
  ) {
    const options = {
      severity: query.severity,
      category: query.category,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    };

    const result =
      await this.enterpriseSecurityService.getSecurityAlerts(options);

    return {
      success: true,
      data: {
        alerts: result.alerts,
        pagination: result.pagination,
        summary: result.summary,
        performance: {
          query_time: Date.now() - Date.now(), // Would track actual time
        },
      },
    };
  }

  /**
   * GET /enterprise-security/data-lineage/:dataId
   * Get data lineage for specific data item
   */
  @Get('data-lineage/:dataId')
  async getDataLineage(@Param('dataId') dataId: string) {
    if (!dataId) {
      throw new BadRequestException('Missing required parameter: dataId');
    }

    const lineage = await this.enterpriseSecurityService.getDataLineage(dataId);

    if (!lineage) {
      throw new NotFoundException('Data lineage not found');
    }

    // Get related audit events
    const relatedEvents = await this.enterpriseSecurityService.queryAuditEvents(
      {
        targetIds: [dataId],
        limit: 100,
        sortBy: 'timestamp',
        sortOrder: 'desc',
      },
    );

    return {
      success: true,
      data: {
        lineage,
        related_events: relatedEvents.events,
        summary: {
          transformations: lineage.transformations.length,
          destinations: lineage.destinations.length,
          retention_status: lineage.retentionPolicy.autoDelete
            ? 'managed'
            : 'manual',
          delete_after: new Date(
            lineage.retentionPolicy.deleteAfter,
          ).toISOString(),
        },
        performance: {
          query_time: Date.now() - Date.now(), // Would track actual time
        },
      },
    };
  }

  /**
   * POST /enterprise-security/audit-report
   * Generate comprehensive audit report
   */
  @Post('audit-report')
  @HttpCode(HttpStatus.OK)
  async generateAuditReport(
    @Body()
    body: {
      report_type?: string;
      start_date?: string;
      end_date?: string;
      include_evidence?: boolean;
      include_recommendations?: boolean;
      scope?: string[];
    },
  ) {
    const {
      report_type = 'security_review',
      start_date,
      end_date,
      include_evidence = false,
      include_recommendations = true,
      scope = [],
    } = body;

    const timeRange = {
      start: start_date
        ? parseInt(start_date, 10)
        : Date.now() - 30 * 24 * 60 * 60 * 1000,
      end: end_date ? parseInt(end_date, 10) : Date.now(),
    };

    const parameters = {
      timeRange,
      scope: Array.isArray(scope) ? scope : [scope].filter(Boolean),
      frameworks: ['gdpr', 'hipaa', 'soc2', 'pci_dss'],
      includeEvidence: Boolean(include_evidence),
      includeRecommendations: Boolean(include_recommendations),
    };

    const report = await this.enterpriseSecurityService.generateAuditReport(
      report_type,
      parameters,
      'system', // Would come from authenticated user
    );

    return {
      success: true,
      data: {
        report,
        performance: {
          generation_time: Date.now() - Date.now(), // Would track actual time
          events_processed: report.summary.totalEvents,
        },
      },
    };
  }

  /**
   * GET /enterprise-security/ai-audit-records
   * Get AI provider audit records
   */
  @Get('ai-audit-records')
  async getAIProviderAuditRecords(
    @Query()
    query: {
      user_id?: string;
      provider?: string;
      start_date?: string;
      end_date?: string;
      risk_level?: string;
      limit?: string;
      offset?: string;
    },
  ) {
    const auditQuery = {
      userId: query.user_id,
      provider: query.provider,
      timeRange:
        query.start_date && query.end_date
          ? {
              start: parseInt(query.start_date, 10),
              end: parseInt(query.end_date, 10),
            }
          : undefined,
      riskLevel: query.risk_level ? [query.risk_level] : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 100,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    };

    const results =
      await this.enterpriseSecurityService.queryAIProviderAuditRecords(
        auditQuery,
      );

    return {
      success: true,
      data: {
        records: results.records.map(
          (record: {
            requestId: string;
            timestamp: number;
            provider: string;
            model: string;
            userId: unknown;
            security: { riskLevel: string; piiDetected: boolean };
            transmission: { status: string };
            compliance: { gdprApplicable: boolean };
          }) => ({
            request_id: record.requestId,
            timestamp: record.timestamp,
            provider: record.provider,
            model: record.model,
            user_id: record.userId,
            risk_level: record.security.riskLevel,
            pii_detected: record.security.piiDetected,
            transmission_status: record.transmission.status,
            compliance_frameworks: record.compliance.gdprApplicable
              ? ['gdpr']
              : [],
          }),
        ),
        pagination: {
          total: results.total,
          limit: auditQuery.limit,
          offset: auditQuery.offset,
          has_more: results.hasMore,
        },
        performance: {
          query_time: Date.now() - Date.now(), // Would track actual time
        },
      },
    };
  }

  /**
   * GET /enterprise-security/statistics
   * Get comprehensive security statistics
   */
  @Get('statistics')
  async getSecurityStatistics() {
    const statistics =
      await this.enterpriseSecurityService.getSecurityStatistics();

    // Calculate overall security score
    const securityScore = this.calculateOverallSecurityScore(statistics);

    return {
      success: true,
      data: {
        statistics,
        overall: {
          security_score: securityScore,
          status:
            securityScore > 90
              ? 'excellent'
              : securityScore > 75
                ? 'good'
                : securityScore > 60
                  ? 'fair'
                  : 'needs_improvement',
        },
        performance: {
          query_time: Date.now() - Date.now(), // Would track actual time
        },
      },
    };
  }

  // Helper method for security score calculation
  private calculateOverallSecurityScore(statistics: any): number {
    try {
      // Calculate weighted security score based on various metrics
      let score = 100;

      // Audit score impact (20% weight)
      const auditStats = statistics.comprehensive_audit;
      if (auditStats.totalEvents > 0) {
        const anomalyRate = auditStats.anomalousEvents / auditStats.totalEvents;
        score -= anomalyRate * 20;
      }

      // Compliance score impact (30% weight)
      const complianceStats = statistics.compliance_enforcement;
      if (complianceStats.totalChecks > 0) {
        const violationRate =
          complianceStats.violationsDetected / complianceStats.totalChecks;
        score -= violationRate * 30;

        const criticalViolationRate =
          complianceStats.criticalViolations / complianceStats.totalChecks;
        score -= criticalViolationRate * 20; // Additional penalty for critical violations
      }

      // Filter effectiveness (25% weight)
      const filterStats = statistics.pre_transmission_filter;
      if (filterStats.totalRequests > 0) {
        const blockRate =
          filterStats.blockedRequests / filterStats.totalRequests;
        if (blockRate > 0.1) {
          // High block rate indicates security issues
          score -= (blockRate - 0.1) * 25;
        }
      }

      // AI audit score (25% weight)
      const aiAuditStats = statistics.ai_provider_audit;
      if (aiAuditStats.totalRequests > 0) {
        const aiBlockRate =
          aiAuditStats.blockedRequests / aiAuditStats.totalRequests;
        if (aiBlockRate > 0.05) {
          // High AI block rate indicates issues
          score -= (aiBlockRate - 0.05) * 25;
        }
      }

      return Math.max(0, Math.min(100, score));
    } catch {
      return 50; // Default middle score on error
    }
  }
}
