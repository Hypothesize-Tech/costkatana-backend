export enum PricingUnit {
    PER_1K_TOKENS = 'PER_1K_TOKENS',
    PER_1M_TOKENS = 'PER_1M_TOKENS',
    PER_REQUEST = 'PER_REQUEST',
    PER_HOUR = 'PER_HOUR',
    PER_IMAGE = 'PER_IMAGE'
}

export interface ModelPricing {
    modelId: string;
    modelName: string;
    provider: string;
    inputPrice: number;
    outputPrice: number;
    unit: PricingUnit;
    contextWindow?: number;
    capabilities?: string[];
    category?: string;
    isLatest?: boolean;
    notes?: string;
}
