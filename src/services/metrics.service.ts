/**
 * Metrics service stub for grounding and other metrics.
 * Implement with DataDog/Mixpanel/etc. when needed.
 */
export class MetricsService {
    private static instance: MetricsService;

    static getInstance(): MetricsService {
        if (!MetricsService.instance) {
            MetricsService.instance = new MetricsService();
        }
        return MetricsService.instance;
    }

    async trackGroundingDecision(_logData: Record<string, unknown>): Promise<void> {
        // Stub: implement when metrics backend is configured
    }

    async incrementCounter(_name: string, _tags?: Record<string, string>): Promise<void> {
        // Stub
    }

    async recordGauge(_name: string, _value: number, _tags?: Record<string, string>): Promise<void> {
        // Stub
    }
}
