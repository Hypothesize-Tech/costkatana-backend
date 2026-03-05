/**
 * Organization service stub.
 * Provides organization lookup and security settings; implement fully when needed.
 */
export interface OrganizationSecuritySettings {
    killSwitchActive?: boolean;
}

export interface Organization {
    id: string;
    securitySettings?: OrganizationSecuritySettings;
}

export class OrganizationService {
    private static instance: OrganizationService;

    static getInstance(): OrganizationService {
        if (!OrganizationService.instance) {
            OrganizationService.instance = new OrganizationService();
        }
        return OrganizationService.instance;
    }

    async getOrganizationById(_organizationId: string): Promise<Organization | null> {
        return null;
    }
}
