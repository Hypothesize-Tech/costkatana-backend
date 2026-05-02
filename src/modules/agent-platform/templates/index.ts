import { supportTriageTemplate } from './support-triage.template';

/**
 * All built-in templates. The AgentTemplateService bootstraps these into
 * Mongo on app start, upserting by slug. Add new templates here.
 */
export const BUILTIN_TEMPLATES = [supportTriageTemplate] as const;

export type BuiltinTemplate = (typeof BUILTIN_TEMPLATES)[number];
