/**
 * Re-exports TraceService for NestJS usage. Inject TraceService from TraceModule.
 * Legacy traceService stub removed - use TraceModule with DI.
 */
export { TraceService } from '../modules/trace/trace.service';
