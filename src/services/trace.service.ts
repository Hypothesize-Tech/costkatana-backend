/**
 * Bridge: Re-exports TraceService for legacy Express middleware.
 * For NestJS usage, inject TraceService from TraceModule.
 */
export { TraceService } from '../modules/trace/trace.service';

// Stub for legacy middleware
export const traceService = {
  createSession: async (_req: any, _opts?: any) => ({
    sessionId: '',
    traceId: `trace_${Date.now()}`,
    parentId: undefined,
  }),
  startSpan: async (_sessionId: string, _name: string, _opts?: any) => ({
    spanId: '',
    traceId: `trace_${Date.now()}`,
  }),
  endSpan: async (_spanId: string, _opts?: any) => {},
};
