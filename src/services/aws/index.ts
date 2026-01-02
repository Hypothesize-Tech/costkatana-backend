// AWS Integration Services - Index
// Enterprise-grade AWS integration with security-first architecture

// Models
export { AWSConnection, encryptExternalId, decryptExternalId } from '../../models/AWSConnection';
export { AWSAuditLog, calculateAuditEntryHash } from '../../models/AWSAuditLog';

// Types
export * from '../../types/awsDsl.types';

// Security Services
export { externalIdService } from './externalId.service';
export { tenantIsolationService } from './tenantIsolation.service';
export { killSwitchService } from './killSwitch.service';
export { internalAccessControlService } from './internalAccessControl.service';

// Credential Management
export { stsCredentialService } from './stsCredential.service';
export { permissionBoundaryService } from './permissionBoundary.service';

// DSL & Execution
export { dslParserService } from './dslParser.service';
export { intentParserService } from './intentParser.service';
export { planGeneratorService } from './planGenerator.service';
export { executionEngineService } from './executionEngine.service';
export { simulationEngineService } from './simulationEngine.service';

// Cost & Audit
export { costAnomalyGuardService } from './costAnomalyGuard.service';
export { auditLoggerService } from './auditLogger.service';
export { auditAnchorService } from './auditAnchor.service';

// AWS Service Providers
export { ec2ServiceProvider } from './providers/ec2.service';
export { s3ServiceProvider } from './providers/s3.service';
export { rdsServiceProvider } from './providers/rds.service';
export { lambdaServiceProvider } from './providers/lambda.service';
export { cloudWatchServiceProvider } from './providers/cloudwatch.service';
