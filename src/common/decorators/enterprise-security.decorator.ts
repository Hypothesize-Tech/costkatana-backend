import { SetMetadata } from '@nestjs/common';
import { SecurityOptions } from '../guards/enterprise-security.guard';

export const ENTERPRISE_SECURITY_KEY = 'enterprise-security';

export function EnterpriseSecurity(options: SecurityOptions = {}) {
  return SetMetadata(ENTERPRISE_SECURITY_KEY, options);
}

export function AISecurity(
  provider: string,
  model: string,
  options: Omit<
    SecurityOptions,
    'isAIProcessing' | 'aiProvider' | 'aiModel'
  > = {},
) {
  return EnterpriseSecurity({
    ...options,
    isAIProcessing: true,
    aiProvider: provider,
    aiModel: model,
    securityLevel: options.securityLevel || 'maximum',
    complianceMode: options.complianceMode || 'strict',
  });
}

export function HighSecurity(options: SecurityOptions = {}) {
  return EnterpriseSecurity({
    ...options,
    securityLevel: 'maximum',
    complianceMode: 'maximum',
    enableDetailedLogging: true,
  });
}

export function StandardSecurity(options: SecurityOptions = {}) {
  return EnterpriseSecurity({
    ...options,
    securityLevel: 'standard',
    complianceMode: 'permissive',
  });
}
