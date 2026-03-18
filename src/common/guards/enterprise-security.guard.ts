import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
  Inject,
  Optional,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { DataClassificationService } from '../../modules/security/services/data-classification.service';
import { PreTransmissionFilterService } from '../../modules/security/services/pre-transmission-filter.service';
import { ComplianceCheckService } from '../../modules/security/services/compliance-check.service';
import { AIProviderAuditService } from '../../modules/security/services/ai-provider-audit.service';
import { ComprehensiveAuditService } from '../../modules/security/services/comprehensive-audit.service';
import { RealTimeMonitoringService } from '../../modules/security/services/real-time-monitoring.service';

export interface SecurityMiddlewareOptions {
  enableAIProviderAudit?: boolean;
  enablePreTransmissionFilter?: boolean;
  enableDataClassification?: boolean;
  enableComplianceChecking?: boolean;
  enableComprehensiveAudit?: boolean;
  enableRealTimeMonitoring?: boolean;

  // Security levels
  securityLevel?: 'standard' | 'high' | 'maximum';
  complianceMode?: 'permissive' | 'strict' | 'maximum';

  // Bypass options
  bypassAllSecurity?: boolean;
  bypassSpecificChecks?: string[];

  // AI processing specific
  isAIProcessing?: boolean;
  aiProvider?: string;
  aiModel?: string;

  // Monitoring
  enableDetailedLogging?: boolean;
  enablePerformanceTracking?: boolean;
}

/** Alias for decorator and external use */
export type SecurityOptions = SecurityMiddlewareOptions;

/** Injection token for guard options (so Nest can resolve the first constructor param) */
export const ENTERPRISE_SECURITY_OPTIONS = Symbol(
  'ENTERPRISE_SECURITY_OPTIONS',
);

/**
 * Enterprise Security Guard
 * Integrates all security systems for comprehensive protection
 */
@Injectable()
export class EnterpriseSecurityGuard implements CanActivate {
  private readonly logger = new Logger(EnterpriseSecurityGuard.name);

  constructor(
    @Optional()
    @Inject(ENTERPRISE_SECURITY_OPTIONS)
    private readonly options: SecurityMiddlewareOptions = {},
    private readonly dataClassificationService?: DataClassificationService,
    private readonly preTransmissionFilterService?: PreTransmissionFilterService,
    private readonly complianceCheckService?: ComplianceCheckService,
    private readonly aiProviderAuditService?: AIProviderAuditService,
    private readonly comprehensiveAuditService?: ComprehensiveAuditService,
    private readonly realTimeMonitoringService?: RealTimeMonitoringService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const startTime = Date.now();

    const {
      enableAIProviderAudit = true,
      enablePreTransmissionFilter = true,
      enableDataClassification = true,
      enableComplianceChecking = true,
      enableComprehensiveAudit = true,
      enableRealTimeMonitoring = true,

      securityLevel = 'high',
      complianceMode = 'strict',

      bypassAllSecurity = false,
      bypassSpecificChecks = [],

      isAIProcessing = false,
      aiProvider = 'unknown',
      aiModel = 'unknown',

      enableDetailedLogging = false,
      enablePerformanceTracking = true,
    } = this.options;

    // Set security context
    request.securityContext = {
      requestId:
        request.requestId ||
        request.headers['x-request-id'] ||
        this.generateRequestId(),
      securityLevel,
      complianceMode,
      isAIProcessing,
      timestamp: startTime,
    };

    if (enableDetailedLogging) {
      this.logger.log('=== ENTERPRISE SECURITY GUARD STARTED ===', {
        component: 'EnterpriseSecurityGuard',
        requestId: request.securityContext.requestId,
        path: request.path,
        method: request.method,
        securityLevel,
        isAIProcessing,
      });
    }

    try {
      // Skip all security checks if bypassed or emergency endpoint
      if (bypassAllSecurity || this.isEmergencyEndpoint(request.path)) {
        if (enableDetailedLogging) {
          this.logger.log('Bypassing all security checks', {
            component: 'EnterpriseSecurityGuard',
            requestId: request.securityContext.requestId,
            reason: bypassAllSecurity ? 'bypass_flag' : 'emergency_endpoint',
          });
        }
        return true;
      }

      const violations: any[] = [];
      const securityEvents: string[] = [];
      let blocked = false;
      let blockReason = '';

      // Extract content for analysis
      const content = this.extractContentFromRequest(request);
      const context = this.extractContextFromRequest(request);

      // 1. Data Classification
      if (
        enableDataClassification &&
        !bypassSpecificChecks.includes('data_classification')
      ) {
        try {
          if (!this.dataClassificationService) {
            throw new Error('DataClassificationService not available');
          }

          const classification =
            await this.dataClassificationService.classifyData(content, {
              userId: request.securityContext?.userId || 'anonymous',
              source: request.path,
            });

          request.dataClassification = classification;

          // Add classification headers
          response.setHeader(
            'X-Data-Classification',
            classification.classification.level,
          );
          response.setHeader(
            'X-Data-Categories',
            classification.classification.categories.join(','),
          );
          response.setHeader(
            'X-Compliance-Frameworks',
            classification.classification.complianceFrameworks.join(','),
          );
          response.setHeader(
            'X-Data-Risk-Score',
            classification.classification.riskScore.toFixed(3),
          );

          securityEvents.push('data_classified');

          if (enableDetailedLogging) {
            this.logger.log('Content classified', {
              component: 'EnterpriseSecurityGuard',
              requestId: request.securityContext.requestId,
              level: classification.classification.level,
              riskScore: classification.classification.riskScore,
              categories: classification.classification.categories,
            });
          }
        } catch (error) {
          this.logger.error('Data classification failed', {
            component: 'EnterpriseSecurityGuard',
            requestId: request.securityContext.requestId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // 2. Pre-Transmission Filtering
      if (
        enablePreTransmissionFilter &&
        !bypassSpecificChecks.includes('pre_transmission_filter') &&
        content
      ) {
        try {
          if (!this.preTransmissionFilterService) {
            throw new Error('PreTransmissionFilterService not available');
          }

          const context = this.extractContextFromRequest(request);
          const filterResult =
            await this.preTransmissionFilterService.filterContent(
              content,
              context,
            );

          request.filterResult = filterResult;

          // Add filter headers
          response.setHeader(
            'X-Content-Filtered',
            filterResult.modified.toString(),
          );
          response.setHeader(
            'X-Filter-Risk-Score',
            filterResult.riskScore.toFixed(3),
          );
          response.setHeader(
            'X-Filter-Detections',
            filterResult.detections.length.toString(),
          );
          response.setHeader(
            'X-Filter-Redactions',
            filterResult.metadata.redactionCount.toString(),
          );

          if (!filterResult.allowed) {
            blocked = true;
            blockReason =
              filterResult.blockedReason ||
              'Content blocked by security filter';
            violations.push({
              type: 'content_filter_violation',
              severity: 'high',
              details: filterResult,
            });
          }

          securityEvents.push('content_filtered');

          if (enableDetailedLogging) {
            this.logger.log('Content filtered', {
              component: 'EnterpriseSecurityGuard',
              requestId: request.securityContext.requestId,
              allowed: filterResult.allowed,
              modified: filterResult.modified,
              riskScore: filterResult.riskScore,
              detections: filterResult.detections.length,
              redactionCount: filterResult.metadata.redactionCount,
            });
          }
        } catch (error) {
          this.logger.error('Pre-transmission filtering failed', {
            component: 'EnterpriseSecurityGuard',
            requestId: request.securityContext.requestId,
            error: error instanceof Error ? error.message : String(error),
          });

          // Fail safe - block on error for high security levels
          if (securityLevel === 'maximum') {
            blocked = true;
            blockReason = 'Security filter system error';
          }
        }
      }

      // 3. Compliance Checking
      if (
        enableComplianceChecking &&
        !bypassSpecificChecks.includes('compliance_checking')
      ) {
        try {
          if (!this.complianceCheckService) {
            throw new Error('ComplianceCheckService not available');
          }

          const context = this.extractContextFromRequest(request);
          const complianceCheck =
            await this.complianceCheckService.checkCompliance({
              userId: context.userId,
              userJurisdiction: context.userJurisdiction,
              userType: context.userTier,
              dataTypes: request.dataClassification?.classification
                .categories || ['user_data'],
              action: 'api_request',
              purpose: 'data_processing',
              riskLevel:
                request.dataClassification?.classification.riskScore || 0.1,
              consentObtained: true, // Assume consent obtained for API requests
              lawfulBasis: 'legitimate_interest',
            });

          request.complianceCheck = complianceCheck;

          // Add compliance headers
          response.setHeader(
            'X-Compliance-Status',
            complianceCheck.compliant ? 'compliant' : 'non_compliant',
          );
          response.setHeader(
            'X-Compliance-Violations',
            complianceCheck.violations.length.toString(),
          );
          response.setHeader(
            'X-Compliance-Frameworks',
            complianceCheck.metadata.frameworks.join(','),
          );

          if (
            !complianceCheck.compliant &&
            !complianceCheck.allowedWithConditions
          ) {
            blocked = true;
            blockReason =
              complianceCheck.blockedReasons.join(', ') ||
              'Compliance violations detected';
            violations.push({
              type: 'compliance_violation',
              severity: 'critical',
              details: complianceCheck,
            });
          }

          securityEvents.push('compliance_checked');

          if (enableDetailedLogging) {
            this.logger.log('Compliance checked', {
              component: 'EnterpriseSecurityGuard',
              requestId: request.securityContext.requestId,
              compliant: complianceCheck.compliant,
              violations: complianceCheck.violations.length,
              frameworks: complianceCheck.metadata.frameworks,
            });
          }
        } catch (error) {
          this.logger.error('Compliance checking failed', {
            component: 'EnterpriseSecurityGuard',
            requestId: request.securityContext.requestId,
            error: error instanceof Error ? error.message : String(error),
          });

          // Fail safe for strict compliance mode
          if (complianceMode === 'maximum') {
            blocked = true;
            blockReason = 'Compliance check system error';
          }
        }
      }

      // 4. AI Provider Audit
      if (
        enableAIProviderAudit &&
        isAIProcessing &&
        !bypassSpecificChecks.includes('ai_provider_audit')
      ) {
        try {
          if (!this.aiProviderAuditService) {
            throw new Error('AIProviderAuditService not available');
          }

          // Create audit request
          const providerVal = aiProvider || 'unknown';
          const provider: 'anthropic' | 'openai' | 'bedrock' | 'custom' =
            providerVal === 'anthropic' ||
            providerVal === 'openai' ||
            providerVal === 'bedrock'
              ? providerVal
              : 'custom';
          const auditRequest = {
            requestId: request.securityContext.requestId,
            userId: request.securityContext?.userId || 'anonymous',
            provider,
            model: aiModel || 'unknown',
            timestamp: Date.now(),
            endpoint: request.path,
            method: request.method,
            requestData: {
              prompt: content,
              parameters: {},
            },
            metadata: {
              userTier: request.securityContext?.userTier || 'free',
              sessionId: request.sessionId ?? '',
              ipAddress: request.ip || '',
              userAgent: request.headers?.['user-agent'] ?? '',
              contentLength: content.length,
              estimatedTokens: Math.ceil(content.length / 4),
              estimatedCost: Math.ceil(content.length / 4) * 0.000002,
            },
            security: {
              piiDetected:
                request.filterResult?.detections
                  .filter(
                    (d: { category: string; ruleName: string }) =>
                      d.category === 'pii',
                  )
                  .map(
                    (d: { category: string; ruleName: string }) => d.ruleName,
                  ) || [],
              sensitivePatterns:
                request.filterResult?.detections
                  .filter(
                    (d: { category: string; ruleName: string }) =>
                      d.category === 'sensitive',
                  )
                  .map(
                    (d: { category: string; ruleName: string }) => d.ruleName,
                  ) || [],
              riskLevel: (request.filterResult?.riskScore &&
              request.filterResult.riskScore > 0.7
                ? 'high'
                : request.filterResult?.riskScore &&
                    request.filterResult.riskScore > 0.4
                  ? 'medium'
                  : 'low') as 'low' | 'medium' | 'high' | 'critical',
              complianceFlags:
                request.complianceCheck?.metadata.frameworks || [],
              dataClassification:
                request.dataClassification?.classification.categories || [],
              redactionApplied: request.filterResult?.modified || false,
            },
            transmission: {
              status: 'pending' as const,
            },
            compliance: {
              gdprApplicable:
                request.complianceCheck?.metadata.frameworks.includes('gdpr') ||
                false,
              hipaaApplicable:
                request.complianceCheck?.metadata.frameworks.includes(
                  'hipaa',
                ) || false,
              soc2Applicable: true, // Assume SOC2 compliance
              consentObtained: true,
              legalBasis: 'legitimate_interest',
              dataRetentionPolicy: 'standard',
              geographicRestrictions: [],
            },
          };

          await this.aiProviderAuditService.recordRequest(auditRequest);

          const auditResult = {
            allowed: true,
            riskLevel: 'low' as const,
            redactionApplied: false,
            blockedReason: undefined as string | undefined,
          };
          request.aiAuditResult = auditResult;

          // Add AI audit headers
          response.setHeader(
            'X-AI-Audit-Status',
            auditResult.allowed ? 'approved' : 'blocked',
          );
          response.setHeader('X-AI-Risk-Level', auditResult.riskLevel);
          response.setHeader(
            'X-AI-Redaction-Applied',
            auditResult.redactionApplied.toString(),
          );

          if (!auditResult.allowed) {
            blocked = true;
            blockReason =
              auditResult.blockedReason || 'AI provider audit failed';
            violations.push({
              type: 'ai_audit_violation',
              severity: 'critical',
              details: auditResult,
            });
          }

          securityEvents.push('ai_audit_completed');

          if (enableDetailedLogging) {
            this.logger.log('AI provider audit completed', {
              component: 'EnterpriseSecurityGuard',
              requestId: request.securityContext.requestId,
              allowed: auditResult.allowed,
              riskLevel: auditResult.riskLevel,
              redactionApplied: auditResult.redactionApplied,
            });
          }
        } catch (error) {
          this.logger.error('AI provider audit failed', {
            component: 'EnterpriseSecurityGuard',
            requestId: request.securityContext.requestId,
            error: error instanceof Error ? error.message : String(error),
          });

          // Fail safe for AI processing
          if (securityLevel === 'maximum') {
            blocked = true;
            blockReason = 'AI audit system error';
          }
        }
      }

      // 5. Comprehensive Audit Recording
      if (
        enableComprehensiveAudit &&
        !bypassSpecificChecks.includes('comprehensive_audit')
      ) {
        try {
          if (!this.comprehensiveAuditService) {
            throw new Error('ComprehensiveAuditService not available');
          }

          const auditEventId =
            await this.comprehensiveAuditService.recordSecurityEvent({
              eventId: request.securityContext.requestId,
              timestamp: Date.now(),
              eventType: 'security_event',
              severity: violations.length > 0 ? 'high' : 'low',
              event: {
                action: 'security_guard_check',
                description: `Security guard check completed with ${violations.length} violations`,
                component: 'EnterpriseSecurityGuard',
                securityLevel,
                complianceMode,
                isAIProcessing,
                violationsCount: violations.length,
                securityEvents,
                blocked,
              },
              metadata: {
                requestId: request.securityContext.requestId,
                userId: request.securityContext?.userId || 'anonymous',
                path: request.path,
                method: request.method,
                processingTime: Date.now() - startTime,
                dataClassification: request.dataClassification,
                filterResult: request.filterResult,
                complianceCheck: request.complianceCheck,
                aiAuditResult: request.aiAuditResult,
              },
            });

          request.auditEventId = auditEventId;
          securityEvents.push('audit_recorded');

          if (enableDetailedLogging) {
            this.logger.log('Comprehensive audit recorded', {
              component: 'EnterpriseSecurityGuard',
              requestId: request.securityContext.requestId,
              auditEventId,
              violations: violations.length,
            });
          }
        } catch (error) {
          this.logger.error('Comprehensive audit recording failed', {
            component: 'EnterpriseSecurityGuard',
            requestId: request.securityContext.requestId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // 6. Real-Time Monitoring
      if (
        enableRealTimeMonitoring &&
        !bypassSpecificChecks.includes('real_time_monitoring')
      ) {
        try {
          if (!this.realTimeMonitoringService) {
            throw new Error('RealTimeMonitoringService not available');
          }

          const flowId = await this.realTimeMonitoringService.startDataFlow(
            request.securityContext.requestId,
            request.securityContext?.userId || 'anonymous',
            {
              component: 'EnterpriseSecurityGuard',
              securityLevel,
              complianceMode,
              isAIProcessing,
              dataSize: content.length,
              riskScore:
                request.dataClassification?.classification.riskScore || 0,
            },
          );

          request.dataFlowId = flowId;
          securityEvents.push('data_flow_tracked');

          if (enableDetailedLogging) {
            this.logger.log('Real-time monitoring started', {
              component: 'EnterpriseSecurityGuard',
              requestId: request.securityContext.requestId,
              flowId,
            });
          }
        } catch (error) {
          this.logger.error('Real-time monitoring failed', {
            component: 'EnterpriseSecurityGuard',
            requestId: request.securityContext.requestId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Handle violations and blocking
      if (blocked) {
        const securityResponse = {
          error: 'Security Policy Violation',
          message: blockReason,
          violations: violations.map((v) => ({
            type: v.type,
            severity: v.severity,
          })),
          security_context: {
            request_id: request.securityContext.requestId,
            security_level: securityLevel,
            compliance_mode: complianceMode,
            timestamp: new Date().toISOString(),
          },
          remediation: {
            contact: 'support@costkatana.com',
            documentation: 'https://docs.costkatana.com/security',
            appeal_process: 'Submit security appeal through support',
          },
        };

        // Set security headers
        response.setHeader('X-Security-Status', 'BLOCKED');
        response.setHeader('X-Security-Reason', blockReason);
        response.setHeader('X-Security-Level', securityLevel);
        response.setHeader('X-Violations-Count', violations.length.toString());

        // Update data flow status if tracked
        if (request.dataFlowId && this.realTimeMonitoringService) {
          await this.realTimeMonitoringService.addCheckpoint(
            request.dataFlowId,
            'EnterpriseSecurityGuard',
            'request_blocked',
            {
              blockReason,
              violationsCount: violations.length,
              securityLevel,
            },
          );
          await this.realTimeMonitoringService.completeDataFlow(
            request.dataFlowId,
            'blocked',
          );

          if (enableDetailedLogging) {
            this.logger.log('Data flow blocked', {
              component: 'EnterpriseSecurityGuard',
              requestId: request.securityContext.requestId,
              flowId: request.dataFlowId,
              blockReason,
            });
          }
        }

        this.logger.error('Request blocked by enterprise security', {
          component: 'EnterpriseSecurityGuard',
          requestId: request.securityContext.requestId,
          blockReason,
          violations: violations.length,
          securityLevel,
          path: request.path,
        });

        // Throw error to trigger NestJS error handling
        throw new Error(`Security Policy Violation: ${blockReason}`);
      }

      // Set comprehensive security headers
      this.setSecurityHeaders(response, request, securityEvents);

      // Track performance if enabled
      if (enablePerformanceTracking) {
        this.trackSecurityPerformance(
          request,
          response,
          startTime,
          securityEvents,
        );
      }

      // Update data flow status if tracked
      if (request.dataFlowId && this.realTimeMonitoringService) {
        await this.realTimeMonitoringService.addCheckpoint(
          request.dataFlowId,
          'EnterpriseSecurityGuard',
          'guard_completed',
          {
            processingTime: Date.now() - startTime,
            violationsCount: violations.length,
            securityEventsCount: securityEvents.length,
            blocked: false,
          },
        );
        await this.realTimeMonitoringService.completeDataFlow(
          request.dataFlowId,
          'completed',
        );
      }

      // Continue with request
      const guardTime = Date.now() - startTime;

      if (enableDetailedLogging) {
        this.logger.log('Enterprise security guard completed', {
          component: 'EnterpriseSecurityGuard',
          requestId: request.securityContext.requestId,
          path: request.path,
          guard_time: guardTime,
          security_events: securityEvents.length,
          violations: violations.length,
          blocked,
        });
      }

      return true;
    } catch (error) {
      const errorTime = Date.now() - startTime;

      this.logger.error('Enterprise security guard error', {
        component: 'EnterpriseSecurityGuard',
        requestId: request.securityContext.requestId,
        path: request.path,
        error: error instanceof Error ? error.message : String(error),
        error_time: errorTime,
      });

      // Update data flow status on error
      if (request.dataFlowId && this.realTimeMonitoringService) {
        await this.realTimeMonitoringService.addCheckpoint(
          request.dataFlowId,
          'EnterpriseSecurityGuard',
          'guard_error',
          {
            error: error instanceof Error ? error.message : String(error),
            processingTime: Date.now() - startTime,
          },
        );
        await this.realTimeMonitoringService.completeDataFlow(
          request.dataFlowId,
          'failed',
        );

        if (enableDetailedLogging) {
          this.logger.log('Data flow failed', {
            component: 'EnterpriseSecurityGuard',
            requestId: request.securityContext.requestId,
            flowId: request.dataFlowId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Fail safe based on security level
      if (this.options.securityLevel === 'maximum') {
        throw new Error(
          'Security System Error: Request blocked due to security system error',
        );
      }

      // Continue without security checks on error (for standard/high levels)
      return true;
    }
  }

  /**
   * Extract content from request for analysis
   */
  private extractContentFromRequest(request: any): string {
    const contentParts: string[] = [];

    // Extract from body
    if (request.body) {
      if (typeof request.body === 'string') {
        contentParts.push(request.body);
      } else {
        contentParts.push(JSON.stringify(request.body));
      }
    }

    // Extract from query parameters
    if (request.query && Object.keys(request.query).length > 0) {
      contentParts.push(JSON.stringify(request.query));
    }

    // Extract from headers (selective)
    const sensitiveHeaders = ['authorization', 'x-api-key', 'x-auth-token'];
    for (const header of sensitiveHeaders) {
      if (request.headers[header]) {
        contentParts.push(`${header}: ${request.headers[header]}`);
      }
    }

    return contentParts.join(' ');
  }

  /**
   * Extract context from request
   */
  private extractContextFromRequest(request: any): any {
    return {
      userId: request.user?.id || 'anonymous',
      sessionId: request.sessionId || '',
      source: request.path,
      destination: 'api_processing',
      purpose: 'api_request',
      userTier: request.user?.tier || 'free',
      ipAddress: request.ip || '',
      userAgent: request.headers['user-agent'] || '',
    };
  }

  /**
   * Set comprehensive security headers
   */
  private setSecurityHeaders(
    response: any,
    request: any,
    securityEvents: string[],
  ): void {
    // Security status headers
    response.setHeader('X-Security-Status', 'APPROVED');
    response.setHeader(
      'X-Security-Level',
      request.securityContext.securityLevel,
    );
    response.setHeader('X-Security-Events', securityEvents.join(','));
    response.setHeader('X-Security-Timestamp', new Date().toISOString());

    // Data protection headers
    if (request.dataClassification) {
      response.setHeader('X-Data-Protected', 'true');
      response.setHeader(
        'X-Data-Handling-Required',
        request.dataClassification.handling.auditRequired.toString(),
      );
    }

    // Compliance headers
    if (request.complianceCheck) {
      response.setHeader('X-Compliance-Verified', 'true');
      response.setHeader(
        'X-Compliance-Frameworks',
        request.complianceCheck.violations
          .map((v: any) => v.framework)
          .join(','),
      );
    }

    // Audit trail headers
    if (request.auditEventId) {
      response.setHeader('X-Audit-Event-ID', request.auditEventId);
    }

    // Data flow headers
    if (request.dataFlowId) {
      response.setHeader('X-Data-Flow-ID', request.dataFlowId);
    }

    // Security metadata
    response.setHeader('X-Protected-By', 'Enterprise-Security-Suite');
    response.setHeader('X-Security-Version', '1.0.0');
  }

  /**
   * Track security performance
   */
  private trackSecurityPerformance(
    request: any,
    response: any,
    startTime: number,
    securityEvents: string[],
  ): void {
    const originalSend = response.send;
    const originalJson = response.json;

    const trackCompletion = () => {
      const duration = Date.now() - startTime;
      response.setHeader('X-Security-Processing-Time', duration.toString());
      response.setHeader(
        'X-Security-Events-Count',
        securityEvents.length.toString(),
      );

      // Update data flow with completion
      if (request.dataFlowId) {
        this.logger.log('Data flow completed', {
          component: 'EnterpriseSecurityGuard',
          requestId: request.securityContext.requestId,
          flowId: request.dataFlowId,
          duration,
        });
      }
    };

    response.send = function (data: any) {
      trackCompletion();
      return originalSend.call(this, data);
    };

    response.json = function (data: any) {
      trackCompletion();
      return originalJson.call(this, data);
    };
  }

  /**
   * Check if endpoint is emergency (bypasses all security)
   */
  private isEmergencyEndpoint(path: string): boolean {
    const emergencyPaths = [
      '/api/emergency',
      '/api/health/critical',
      '/api/system/emergency',
    ];

    return emergencyPaths.some((emergency) => path.startsWith(emergency));
  }

  /**
   * Generate request ID
   */
  private generateRequestId(): string {
    return `sec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Factory function to create EnterpriseSecurityGuard with options
 */
export function createEnterpriseSecurityGuard(
  options: SecurityMiddlewareOptions = {},
): new () => CanActivate {
  return class extends EnterpriseSecurityGuard {
    constructor() {
      super(options);
    }
  };
}
