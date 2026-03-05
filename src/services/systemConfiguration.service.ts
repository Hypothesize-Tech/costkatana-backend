/**
 * System configuration service stub.
 * Provides runtime feature flags and config; implement fully when needed.
 */
export class SystemConfigurationService {
    private static instance: SystemConfigurationService;

    static getInstance(): SystemConfigurationService {
        if (!SystemConfigurationService.instance) {
            SystemConfigurationService.instance = new SystemConfigurationService();
        }
        return SystemConfigurationService.instance;
    }

    async getBooleanConfig(key: string, defaultValue: boolean): Promise<boolean> {
        return defaultValue;
    }
}
