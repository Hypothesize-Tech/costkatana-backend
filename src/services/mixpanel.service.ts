import mixpanel from 'mixpanel';
import { loggingService } from './logging.service';

interface MixpanelEvent {
    event: string;
    properties: Record<string, any>;
    userId?: string;
    distinctId?: string;
}

interface ApiUsageData {
    userId: string;
    service: string;
    model: string;
    projectId?: string;
    cost: number;
    tokens: number;
    responseTime: number;
    success: boolean;
    endpoint: string;
    method: string;
    statusCode: number;
    requestBody?: any;
    responseSize?: number;
    userAgent?: string;
    ip?: string;
}

interface UserActionData {
    userId: string;
    action: string;
    page: string;
    component: string;
    element: string;
    metadata?: Record<string, any>;
    timestamp: string;
    sessionId?: string;
}

interface PageViewData {
    userId: string;
    page: string;
    pageTitle: string;
    referrer: string;
    userAgent: string;
    ip: string;
    queryParams?: Record<string, any>;
    sessionId?: string;
}

interface ComprehensiveUsageData {
    service: string;
    model: string;
    cost: number;
    tokens: number;
    responseTime: number;
    networkTime: number;
    serverProcessingTime: number;
    dataTransferEfficiency: number;
    potentialSavings: number;
    performanceScore: number;
    clientPlatform: string;
    sdkVersion: string;
    country?: string;
    region?: string;
}

interface FeatureUsageData {
    userId: string;
    feature: string;
    subFeature?: string;
    action: string;
    page: string;
    component: string;
    metadata?: Record<string, any>;
    success?: boolean;
    errorMessage?: string;
}

interface BusinessMetricData {
    userId: string;
    metric: 'revenue' | 'cost_savings' | 'user_acquisition' | 'retention' | 'conversion' | 'engagement' | 'churn' | 'lifetime_value';
    value: number;
    period: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
    comparison?: number;
    page: string;
    component: string;
    metadata?: Record<string, any>;
}

interface MarketingData {
    userId: string;
    campaign: string;
    source: string;
    medium: string;
    term?: string;
    content?: string;
    page: string;
    component: string;
    metadata?: Record<string, any>;
}

interface SalesData {
    userId: string;
    stage: 'lead' | 'qualified' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost';
    value: number;
    probability: number;
    page: string;
    component: string;
    metadata?: Record<string, any>;
}

interface PageAnalyticsData {
    userId: string;
    page: string;
    pageTitle: string;
    timeOnPage: number;
    scrollDepth: number;
    interactions: number;
    bounces: boolean;
    sessionId: string;
    metadata?: Record<string, any>;
}

interface ButtonAnalyticsData {
    userId: string;
    buttonId: string;
    buttonText: string;
    page: string;
    component: string;
    position: string;
    clicks: number;
    sessionId: string;
    metadata?: Record<string, any>;
}

export class MixpanelService {
    private static instance: MixpanelService;
    private client: mixpanel.Mixpanel | null = null;
    private isEnabled: boolean;

    private constructor() {
        const token = process.env.MIXPANEL_TOKEN;
        this.isEnabled = !!token && process.env.NODE_ENV !== 'test';

        if (this.isEnabled && token) {
            this.client = mixpanel.init(token, {
                debug: process.env.NODE_ENV === 'development',
                host: 'api.mixpanel.com'
            });
            loggingService.info('Mixpanel service initialized');
        } else {
            this.client = null;
            loggingService.warn('Mixpanel not configured - analytics tracking disabled');
        }
    }

    public static getInstance(): MixpanelService {
        if (!MixpanelService.instance) {
            MixpanelService.instance = new MixpanelService();
        }
        return MixpanelService.instance;
    }

    /**
     * Track a custom event with detailed context
     */
    public track(event: string, properties: Record<string, any> = {}, userId?: string): void {
        if (!this.isEnabled || !this.client) {
            loggingService.debug('Mixpanel tracking disabled, event:', { value:  { event  } });
            return;
        }

        try {
            const eventData: MixpanelEvent = {
                event,
                properties: {
                    ...properties,
                    timestamp: new Date().toISOString(),
                    environment: process.env.NODE_ENV || 'development',
                    version: process.env.npm_package_version || '1.0.0',
                    server_host: process.env.VITE_API_URL || 'unknown',
                    deployment_id: process.env.DEPLOYMENT_ID || 'unknown'
                },
                userId,
                distinctId: userId
            };

            // The correct signature is: track(event: string, properties: any, callback?: Callback)
            // userId should be set as 'distinct_id' in properties, not as the callback
            const trackProps = {
                ...eventData.properties,
                ...(userId ? { distinct_id: userId } : {})
            };
            this.client.track(event, trackProps);
            loggingService.debug('Mixpanel event tracked:', { value:  { event, properties  } });
        } catch (error) {
            loggingService.error('Error tracking Mixpanel event:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Track specific API usage with detailed context
     */
    public trackApiUsage(data: ApiUsageData): void {
        this.track('API Usage', {
            ...data,
            event_type: 'api_usage',
            cost_category: this.getCostCategory(data.cost),
            token_category: this.getTokenCategory(data.tokens),
            performance_category: this.getPerformanceCategory(data.responseTime),
            endpoint_category: this.getEndpointCategory(data.endpoint),
            method_category: this.getMethodCategory(data.method),
            success_category: data.success ? 'success' : 'failure',
            response_category: this.getResponseCategory(data.statusCode)
        }, data.userId);

        // Increment user usage metrics
        this.incrementUserProperty(data.userId, 'total_api_calls', 1);
        this.incrementUserProperty(data.userId, 'total_cost', data.cost);
        this.incrementUserProperty(data.userId, 'total_tokens', data.tokens);
        
        // Track endpoint-specific metrics
        this.incrementUserProperty(data.userId, `endpoint_${data.endpoint.replace(/\//g, '_')}_calls`, 1);
    }

    /**
     * Track specific user actions with detailed context
     */
    public trackUserAction(data: UserActionData): void {
        this.track('User Action', {
            ...data,
            event_type: 'user_action',
            action_category: this.getActionCategory(data.action),
            page_category: this.getPageCategory(data.page),
            component_category: this.getComponentCategory(data.component)
        }, data.userId);
    }

    /**
     * Track page views with detailed context
     */
    public trackPageView(data: PageViewData): void {
        this.track('Page View', {
            ...data,
            event_type: 'page_view',
            page_category: this.getPageCategory(data.page),
            referrer_category: this.getReferrerCategory(data.referrer)
        }, data.userId);
    }

    /**
     * Track comprehensive usage with enhanced analytics
     */
    public trackComprehensiveUsage(userId: string, data: ComprehensiveUsageData): void {
        this.track('Comprehensive API Usage', {
            ...data,
            event_type: 'comprehensive_usage',
            
            // Performance categorization
            performance_category: this.categorizePerformance(data.performanceScore),
            network_efficiency_category: this.categorizeNetworkEfficiency(data.dataTransferEfficiency),
            cost_category: this.categorizeCost(data.cost),
            
            // Optimization potential
            has_optimization_opportunity: data.potentialSavings > 0,
            optimization_category: this.categorizeOptimizationPotential(data.potentialSavings, data.cost),
            
            // Technology stack
            client_type: this.categorizeClientPlatform(data.clientPlatform),
            geographic_region: data.region,
            
            // Performance metrics rounded for better grouping
            response_time_bucket: this.categorizeResponseTime(data.responseTime),
            network_time_bucket: this.categorizeResponseTime(data.networkTime),
            
            timestamp: new Date().toISOString()
        }, userId);
    }

    /**
     * Track feature usage with detailed context
     */
    public trackFeatureUsage(data: FeatureUsageData): void {
        this.track('Feature Usage', {
            ...data,
            event_type: 'feature_usage',
            feature_category: this.getFeatureCategory(data.feature),
            action_category: this.getActionCategory(data.action),
            page_category: this.getPageCategory(data.page),
            component_category: this.getComponentCategory(data.component)
        }, data.userId);

        // Increment feature usage counter
        this.incrementUserProperty(data.userId, `feature_${data.feature}_usage`, 1);
    }

    /**
     * Track business metrics for marketing and sales analysis
     */
    public trackBusinessMetric(data: BusinessMetricData): void {
        this.track('Business Metric', {
            ...data,
            event_type: 'business_metric',
            business_category: this.getBusinessCategory(data.metric),
            change_percentage: data.comparison 
                ? ((data.value - data.comparison) / data.comparison * 100).toFixed(2)
                : null,
            page_category: this.getPageCategory(data.page),
            component_category: this.getComponentCategory(data.component)
        }, data.userId);

        // Track business-specific user properties
        this.incrementUserProperty(data.userId, `business_${data.metric}`, data.value);
    }

    /**
     * Track marketing data for campaign analysis
     */
    public trackMarketingData(data: MarketingData): void {
        this.track('Marketing Event', {
            ...data,
            event_type: 'marketing',
            marketing_category: this.getMarketingCategory(data.campaign),
            source_category: this.getSourceCategory(data.source),
            medium_category: this.getMediumCategory(data.medium),
            page_category: this.getPageCategory(data.page),
            component_category: this.getComponentCategory(data.component)
        }, data.userId);

        // Track marketing-specific user properties
        this.setUserProfile(data.userId, {
            $campaign: data.campaign,
            $source: data.source,
            $medium: data.medium,
            $term: data.term,
            $content: data.content
        });
    }

    /**
     * Track sales data for pipeline analysis
     */
    public trackSalesData(data: SalesData): void {
        this.track('Sales Event', {
            ...data,
            event_type: 'sales',
            sales_category: this.getSalesCategory(data.stage),
            stage_category: this.getStageCategory(data.stage),
            page_category: this.getPageCategory(data.page),
            component_category: this.getComponentCategory(data.component)
        }, data.userId);

        // Track sales-specific user properties
        this.incrementUserProperty(data.userId, `sales_${data.stage}_value`, data.value);
        this.setUserProfile(data.userId, {
            sales_stage: data.stage,
            sales_probability: data.probability
        });
    }

    /**
     * Track detailed page analytics for UX analysis
     */
    public trackPageAnalytics(data: PageAnalyticsData): void {
        this.track('Page Analytics', {
            ...data,
            event_type: 'page_analytics',
            page_category: this.getPageCategory(data.page),
            engagement_category: this.getEngagementCategory(data.timeOnPage, data.interactions),
            bounce_category: data.bounces ? 'bounce' : 'engaged'
        }, data.userId);

        // Track page-specific metrics
        this.incrementUserProperty(data.userId, `page_${data.page.replace(/\//g, '_')}_views`, 1);
        this.incrementUserProperty(data.userId, `page_${data.page.replace(/\//g, '_')}_time`, data.timeOnPage);
    }

    /**
     * Track detailed button analytics for UX analysis
     */
    public trackButtonAnalytics(data: ButtonAnalyticsData): void {
        this.track('Button Analytics', {
            ...data,
            event_type: 'button_analytics',
            page_category: this.getPageCategory(data.page),
            component_category: this.getComponentCategory(data.component),
            button_category: this.getButtonCategory(data.buttonId),
            position_category: this.getPositionCategory(data.position)
        }, data.userId);

        // Track button-specific metrics
        this.incrementUserProperty(data.userId, `button_${data.buttonId}_clicks`, data.clicks);
    }

    /**
     * Track authentication events with detailed context
     */
    public trackAuthEvent(event: 'login' | 'logout' | 'register' | 'password_reset' | 'email_verification', data: {
        userId: string;
        method: string;
        source: string;
        userAgent: string;
        ip: string;
        success: boolean;
        errorMessage?: string;
        metadata?: Record<string, any>;
    }): void {
        this.track(`Authentication ${event}`, {
            ...data,
            event_type: 'authentication',
            auth_method: data.method,
            auth_source: data.source,
            success_category: data.success ? 'success' : 'failure'
        }, data.userId);
    }

    /**
     * Track optimization events with detailed context
     */
    public trackOptimization(data: {
        userId: string;
        projectId?: string;
        optimizationType: 'prompt_compression' | 'model_switch' | 'caching' | 'batching' | 'cost_analysis' | 'usage_optimization';
        originalCost: number;
        optimizedCost: number;
        savings: number;
        success: boolean;
        page: string;
        component: string;
        metadata?: Record<string, any>;
    }): void {
        this.track('Optimization Applied', {
            ...data,
            event_type: 'optimization',
            savings_percentage: ((data.savings / data.originalCost) * 100).toFixed(2),
            roi: data.savings > 0 ? 'positive' : 'negative',
            optimization_category: this.getOptimizationCategory(data.optimizationType)
        }, data.userId);

        // Track savings
        this.incrementUserProperty(data.userId, 'total_optimization_savings', data.savings);
        this.incrementUserProperty(data.userId, `optimization_${data.optimizationType}_count`, 1);
    }

    /**
     * Track project events with detailed context
     */
    public trackProjectEvent(event: 'created' | 'updated' | 'deleted' | 'archived' | 'shared' | 'exported', data: {
        userId: string;
        projectId: string;
        projectName: string;
        department?: string;
        team?: string;
        page: string;
        component: string;
        metadata?: Record<string, any>;
    }): void {
        this.track(`Project ${event}`, {
            ...data,
            event_type: 'project_management',
            project_category: this.getProjectCategory(data.projectName),
            page_category: this.getPageCategory(data.page),
            component_category: this.getComponentCategory(data.component)
        }, data.userId);
    }

    /**
     * Track analytics events with detailed context
     */
    public trackAnalyticsEvent(event: 'dashboard_viewed' | 'report_generated' | 'export_requested' | 'filter_applied' | 'chart_interacted' | 'data_refreshed', data: {
        userId: string;
        projectId?: string;
        reportType?: string;
        dateRange?: string;
        filters?: Record<string, any>;
        page: string;
        component: string;
        metadata?: Record<string, any>;
    }): void {
        this.track(`Analytics ${event}`, {
            ...data,
            event_type: 'analytics',
            analytics_category: this.getAnalyticsCategory(event),
            page_category: this.getPageCategory(data.page),
            component_category: this.getComponentCategory(data.component)
        }, data.userId);
    }

    /**
     * Track error events with detailed context
     */
    public trackError(data: {
        userId?: string;
        error: string;
        errorCode?: string;
        endpoint?: string;
        service?: string;
        severity: 'low' | 'medium' | 'high' | 'critical';
        page?: string;
        component?: string;
        userAgent?: string;
        ip?: string;
        metadata?: Record<string, any>;
    }): void {
        this.track('Error Occurred', {
            ...data,
            event_type: 'error',
            error_category: this.getErrorCategory(data.error),
            severity_category: data.severity,
            timestamp: new Date().toISOString()
        }, data.userId);
    }

    /**
     * Track performance metrics with detailed context
     */
    public trackPerformance(data: {
        userId?: string;
        metric: string;
        value: number;
        unit: string;
        page?: string;
        component?: string;
        context?: Record<string, any>;
    }): void {
        this.track('Performance Metric', {
            ...data,
            event_type: 'performance',
            performance_category: this.getPerformanceCategory(data.value),
            page_category: data.page ? this.getPageCategory(data.page) : undefined,
            component_category: data.component ? this.getComponentCategory(data.component) : undefined
        }, data.userId);
    }

    /**
     * Set user profile properties with detailed context
     */
    public setUserProfile(userId: string, properties: Record<string, any>): void {
        if (!this.isEnabled || !this.client) {
            loggingService.debug('Mixpanel tracking disabled, user profile update skipped');
            return;
        }

        try {
            this.client.people.set(userId, {
                ...properties,
                $last_seen: new Date().toISOString(),
                $updated: new Date().toISOString()
            });
            loggingService.debug('Mixpanel user profile updated:', { value:  { userId, properties  } });
        } catch (error) {
            loggingService.error('Error updating Mixpanel user profile:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Increment user profile properties
     */
    public incrementUserProperty(userId: string, property: string, value: number = 1): void {
        if (!this.isEnabled || !this.client) {
            return;
        }

        try {
            this.client.people.increment(userId, property, value);
            loggingService.debug('Mixpanel user property incremented:', { value:  { userId, property, value  } });
        } catch (error) {
            loggingService.error('Error incrementing Mixpanel user property:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Helper functions for categorization
     */
    private getCostCategory(cost: number): string {
        if (cost < 0.01) return 'micro';
        if (cost < 0.1) return 'small';
        if (cost < 1) return 'medium';
        if (cost < 10) return 'large';
        return 'xlarge';
    }

    private getTokenCategory(tokens: number): string {
        if (tokens < 100) return 'small';
        if (tokens < 1000) return 'medium';
        if (tokens < 10000) return 'large';
        return 'xlarge';
    }

    private getPerformanceCategory(responseTime: number): string {
        if (responseTime < 1000) return 'fast';
        if (responseTime < 3000) return 'normal';
        if (responseTime < 10000) return 'slow';
        return 'very_slow';
    }

    private getEndpointCategory(endpoint: string): string {
        if (endpoint.includes('/auth')) return 'authentication';
        if (endpoint.includes('/analytics')) return 'analytics';
        if (endpoint.includes('/projects')) return 'projects';
        if (endpoint.includes('/usage')) return 'usage';
        if (endpoint.includes('/optimization')) return 'optimization';
        if (endpoint.includes('/chat')) return 'chat';
        if (endpoint.includes('/intelligence')) return 'intelligence';
        if (endpoint.includes('/api-keys')) return 'api_keys';
        if (endpoint.includes('/settings')) return 'settings';
        return 'other';
    }

    private getMethodCategory(method: string): string {
        switch (method.toUpperCase()) {
            case 'GET': return 'read';
            case 'POST': return 'create';
            case 'PUT': return 'update';
            case 'PATCH': return 'update';
            case 'DELETE': return 'delete';
            default: return 'other';
        }
    }

    private getResponseCategory(statusCode: number): string {
        if (statusCode >= 200 && statusCode < 300) return 'success';
        if (statusCode >= 300 && statusCode < 400) return 'redirect';
        if (statusCode >= 400 && statusCode < 500) return 'client_error';
        if (statusCode >= 500) return 'server_error';
        return 'unknown';
    }

    private getPageCategory(page: string): string {
        if (page.includes('/dashboard')) return 'dashboard';
        if (page.includes('/analytics')) return 'analytics';
        if (page.includes('/projects')) return 'projects';
        if (page.includes('/optimization')) return 'optimization';
        if (page.includes('/chat')) return 'chat';
        if (page.includes('/intelligence')) return 'intelligence';
        if (page.includes('/settings')) return 'settings';
        if (page.includes('/profile')) return 'profile';
        if (page.includes('/api-keys')) return 'api_keys';
        if (page.includes('/usage')) return 'usage';
        return 'other';
    }
    
    /**
     * Helper methods for comprehensive usage tracking
     */
    private categorizePerformance(score: number): string {
        if (score >= 90) return 'excellent';
        if (score >= 70) return 'good';
        if (score >= 50) return 'fair';
        if (score >= 30) return 'poor';
        return 'very_poor';
    }
    
    private categorizeNetworkEfficiency(efficiency: number): string {
        if (efficiency >= 1000000) return 'high'; // > 1MB/s
        if (efficiency >= 100000) return 'medium'; // > 100KB/s
        if (efficiency >= 10000) return 'low'; // > 10KB/s
        return 'very_low';
    }
    
    private categorizeCost(cost: number): string {
        if (cost >= 1.0) return 'high';
        if (cost >= 0.1) return 'medium';
        if (cost >= 0.01) return 'low';
        return 'minimal';
    }
    
    private categorizeOptimizationPotential(savings: number, totalCost: number): string {
        const savingsRatio = totalCost > 0 ? savings / totalCost : 0;
        if (savingsRatio >= 0.5) return 'high_potential';
        if (savingsRatio >= 0.2) return 'medium_potential';
        if (savingsRatio >= 0.05) return 'low_potential';
        return 'minimal_potential';
    }
    
    private categorizeClientPlatform(platform: string): string {
        if (platform.includes('Node.js')) return 'server';
        if (platform.includes('Browser')) return 'browser';
        if (platform.includes('React Native')) return 'mobile';
        return 'other';
    }
    
    /**
     * Track alerts
     */
    public trackAlert(data: {
        alertType: string;
        severity: string;
        threshold: number;
        currentValue: number;
        userId?: string;
        projectId?: string;
    }): void {
        this.track('Performance Alert', {
            ...data,
            event_type: 'performance_alert',
            alert_category: this.categorizeAlertType(data.alertType),
            severity_level: data.severity,
            threshold_exceeded_ratio: data.currentValue / data.threshold,
            timestamp: new Date().toISOString()
        }, data.userId || 'system');
    }

    private categorizeResponseTime(timeMs: number): string {
        if (timeMs < 500) return 'fast';
        if (timeMs < 1000) return 'medium';
        if (timeMs < 3000) return 'slow';
        if (timeMs < 10000) return 'very_slow';
        return 'extremely_slow';
    }
    
    private categorizeAlertType(alertType: string): string {
        if (alertType.includes('performance')) return 'performance';
        if (alertType.includes('cost')) return 'cost';
        if (alertType.includes('error')) return 'error';
        if (alertType.includes('optimization')) return 'optimization';
        return 'other';
    }

    private getComponentCategory(component: string): string {
        if (component.includes('chart')) return 'visualization';
        if (component.includes('table')) return 'data_table';
        if (component.includes('form')) return 'form';
        if (component.includes('modal')) return 'modal';
        if (component.includes('button')) return 'button';
        if (component.includes('card')) return 'card';
        if (component.includes('filter')) return 'filter';
        if (component.includes('search')) return 'search';
        if (component.includes('navigation')) return 'navigation';
        return 'other';
    }

    private getActionCategory(action: string): string {
        if (action.includes('click')) return 'click';
        if (action.includes('submit')) return 'submit';
        if (action.includes('change')) return 'change';
        if (action.includes('scroll')) return 'scroll';
        if (action.includes('hover')) return 'hover';
        if (action.includes('focus')) return 'focus';
        if (action.includes('blur')) return 'blur';
        if (action.includes('load')) return 'load';
        if (action.includes('unload')) return 'unload';
        return 'other';
    }

    private getFeatureCategory(feature: string): string {
        if (feature.includes('optimization')) return 'optimization';
        if (feature.includes('analytics')) return 'analytics';
        if (feature.includes('chat')) return 'chat';
        if (feature.includes('export')) return 'export';
        if (feature.includes('import')) return 'import';
        if (feature.includes('filter')) return 'filter';
        if (feature.includes('search')) return 'search';
        if (feature.includes('chart')) return 'visualization';
        if (feature.includes('table')) return 'data_display';
        return 'other';
    }

    private getOptimizationCategory(type: string): string {
        if (type.includes('prompt')) return 'prompt_optimization';
        if (type.includes('model')) return 'model_optimization';
        if (type.includes('cost')) return 'cost_optimization';
        if (type.includes('usage')) return 'usage_optimization';
        return 'other';
    }

    private getProjectCategory(projectName: string): string {
        if (projectName.toLowerCase().includes('test')) return 'test';
        if (projectName.toLowerCase().includes('demo')) return 'demo';
        if (projectName.toLowerCase().includes('production')) return 'production';
        if (projectName.toLowerCase().includes('staging')) return 'staging';
        return 'development';
    }

    private getAnalyticsCategory(event: string): string {
        if (event.includes('dashboard')) return 'dashboard';
        if (event.includes('report')) return 'reporting';
        if (event.includes('export')) return 'export';
        if (event.includes('filter')) return 'filtering';
        if (event.includes('chart')) return 'visualization';
        if (event.includes('data')) return 'data_management';
        return 'other';
    }

    private getErrorCategory(error: string): string {
        if (error.toLowerCase().includes('network')) return 'network';
        if (error.toLowerCase().includes('timeout')) return 'timeout';
        if (error.toLowerCase().includes('validation')) return 'validation';
        if (error.toLowerCase().includes('authentication')) return 'authentication';
        if (error.toLowerCase().includes('authorization')) return 'authorization';
        if (error.toLowerCase().includes('not found')) return 'not_found';
        if (error.toLowerCase().includes('server')) return 'server';
        return 'other';
    }

    private getBusinessCategory(metric: string): string {
        if (metric.includes('revenue')) return 'revenue';
        if (metric.includes('cost')) return 'cost_management';
        if (metric.includes('acquisition')) return 'user_acquisition';
        if (metric.includes('retention')) return 'retention';
        if (metric.includes('conversion')) return 'conversion';
        if (metric.includes('engagement')) return 'engagement';
        if (metric.includes('churn')) return 'churn';
        if (metric.includes('lifetime')) return 'lifetime_value';
        return 'other';
    }

    private getMarketingCategory(campaign: string): string {
        if (campaign.includes('email')) return 'email';
        if (campaign.includes('social')) return 'social';
        if (campaign.includes('search')) return 'search';
        if (campaign.includes('display')) return 'display';
        if (campaign.includes('content')) return 'content';
        return 'other';
    }

    private getSourceCategory(source: string): string {
        if (source.includes('google')) return 'google';
        if (source.includes('facebook')) return 'facebook';
        if (source.includes('twitter')) return 'twitter';
        if (source.includes('linkedin')) return 'linkedin';
        if (source.includes('direct')) return 'direct';
        return 'other';
    }

    private getMediumCategory(medium: string): string {
        if (medium.includes('cpc')) return 'paid_search';
        if (medium.includes('cpm')) return 'paid_social';
        if (medium.includes('email')) return 'email';
        if (medium.includes('organic')) return 'organic';
        if (medium.includes('referral')) return 'referral';
        return 'other';
    }

    private getSalesCategory(stage: string): string {
        if (stage.includes('lead')) return 'lead_generation';
        if (stage.includes('qualified')) return 'lead_qualification';
        if (stage.includes('proposal')) return 'proposal';
        if (stage.includes('negotiation')) return 'negotiation';
        if (stage.includes('closed')) return 'closed';
        return 'other';
    }

    private getStageCategory(stage: string): string {
        if (stage.includes('lead')) return 'early';
        if (stage.includes('qualified')) return 'early';
        if (stage.includes('proposal')) return 'middle';
        if (stage.includes('negotiation')) return 'late';
        if (stage.includes('closed')) return 'closed';
        return 'other';
    }

    private getEngagementCategory(timeOnPage: number, interactions: number): string {
        if (timeOnPage > 300 && interactions > 5) return 'high';
        if (timeOnPage > 60 && interactions > 2) return 'medium';
        return 'low';
    }

    private getButtonCategory(buttonId: string): string {
        if (buttonId.includes('primary')) return 'primary';
        if (buttonId.includes('secondary')) return 'secondary';
        if (buttonId.includes('cta')) return 'cta';
        if (buttonId.includes('submit')) return 'submit';
        return 'other';
    }

    private getPositionCategory(position: string): string {
        if (position.includes('header')) return 'header';
        if (position.includes('sidebar')) return 'sidebar';
        if (position.includes('footer')) return 'footer';
        if (position.includes('modal')) return 'modal';
        return 'content';
    }

    private getReferrerCategory(referrer: string): string {
        if (!referrer || referrer === '') return 'direct';
        if (referrer.includes('google')) return 'google';
        if (referrer.includes('bing')) return 'bing';
        if (referrer.includes('github')) return 'github';
        if (referrer.includes('stackoverflow')) return 'stackoverflow';
        if (referrer.includes('medium')) return 'medium';
        if (referrer.includes('linkedin')) return 'linkedin';
        return 'other';
    }

    /**
     * Flush events to Mixpanel
     */
    public flush(): void {
        if (this.isEnabled && this.client && typeof (this.client as any).flush === 'function') {
            // The mixpanel-node client does not always expose flush, but if it does, call it
            (this.client as any).flush();
            loggingService.debug('Mixpanel events flushed');
        }
    }

    /**
     * Check if Mixpanel is enabled
     */
    public isTrackingEnabled(): boolean {
        return this.isEnabled;
    }

    /**
     * ===== GROUP ANALYTICS (B2B) =====
     */

    /**
     * Create a group profile (company, team, project)
     */
    public createGroupProfile(
        groupKey: string,
        groupId: string,
        properties: {
            name: string;
            created_at?: Date;
            plan?: string;
            total_members?: number;
            industry?: string;
            company_size?: string;
            total_spend?: number;
            monthly_api_calls?: number;
            [key: string]: any;
        }
    ): void {
        if (!this.isEnabled || !this.client) {
            return;
        }

        try {
            const profileData: Record<string, any> = {
                $name: properties.name,
                $created: properties.created_at ? properties.created_at.toISOString() : new Date().toISOString()
            };

            if (properties.plan) profileData.plan = properties.plan;
            if (properties.total_members !== undefined) profileData.total_members = properties.total_members;
            if (properties.industry) profileData.industry = properties.industry;
            if (properties.company_size) profileData.company_size = properties.company_size;
            if (properties.total_spend !== undefined) profileData.total_spend = properties.total_spend;
            if (properties.monthly_api_calls !== undefined) profileData.monthly_api_calls = properties.monthly_api_calls;

            // Add additional properties
            Object.keys(properties).forEach(key => {
                if (!['name', 'created_at', 'plan', 'total_members', 'industry', 'company_size', 'total_spend', 'monthly_api_calls'].includes(key)) {
                    profileData[key] = properties[key];
                }
            });

            // Note: mixpanel-node doesn't have full group support like browser SDK
            // This tracks it as an event with group context
            this.track('Group Profile Created', {
                group_key: groupKey,
                group_id: groupId,
                ...profileData,
                event_type: 'group_management'
            });

            loggingService.debug('Group profile created:', { value: { groupKey, groupId } });
        } catch (error) {
            loggingService.error('Error creating group profile:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Update group profile
     */
    public updateGroupProfile(
        groupKey: string,
        groupId: string,
        properties: Record<string, any>
    ): void {
        if (!this.isEnabled || !this.client) {
            return;
        }

        try {
            this.track('Group Profile Updated', {
                group_key: groupKey,
                group_id: groupId,
                ...properties,
                event_type: 'group_management',
                timestamp: new Date().toISOString()
            });

            loggingService.debug('Group profile updated:', { value: { groupKey, groupId } });
        } catch (error) {
            loggingService.error('Error updating group profile:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Track group-level usage
     */
    public trackGroupUsage(
        groupKey: string,
        groupId: string,
        usage: {
            api_calls: number;
            total_cost: number;
            total_tokens: number;
            cost_savings?: number;
        }
    ): void {
        if (!this.isEnabled || !this.client) {
            return;
        }

        try {
            this.track('Group Usage Tracked', {
                group_key: groupKey,
                group_id: groupId,
                ...usage,
                event_type: 'group_analytics',
                timestamp: new Date().toISOString()
            });

            loggingService.debug('Group usage tracked:', { value: { groupKey, groupId, usage } });
        } catch (error) {
            loggingService.error('Error tracking group usage:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * ===== REVENUE TRACKING =====
     */

    /**
     * Track server-side revenue (secure)
     */
    public trackServerSideRevenue(
        userId: string,
        amount: number,
        properties: {
            plan: string;
            billing_cycle: 'monthly' | 'annual';
            transaction_id: string;
            currency?: string;
        }
    ): void {
        if (!this.isEnabled || !this.client) {
            return;
        }

        try {
            // Track charge to user profile
            this.client.people.track_charge(userId, amount, {
                $time: new Date().toISOString(),
                plan: properties.plan,
                billing_cycle: properties.billing_cycle,
                transaction_id: properties.transaction_id,
                currency: properties.currency || 'USD'
            });

            // Also track as event
            this.track('Revenue Tracked', {
                amount,
                plan: properties.plan,
                billing_cycle: properties.billing_cycle,
                transaction_id: properties.transaction_id,
                currency: properties.currency || 'USD',
                event_type: 'revenue',
                timestamp: new Date().toISOString()
            }, userId);

            loggingService.debug('Server-side revenue tracked:', { value: { userId, amount } });
        } catch (error) {
            loggingService.error('Error tracking server-side revenue:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Track subscription revenue
     */
    public trackSubscriptionRevenue(
        userId: string,
        amount: number,
        properties: {
            plan: string;
            billing_cycle: 'monthly' | 'annual';
            subscription_id: string;
            is_renewal?: boolean;
        }
    ): void {
        if (!this.isEnabled || !this.client) {
            return;
        }

        try {
            this.client.people.track_charge(userId, amount, {
                $time: new Date().toISOString(),
                plan: properties.plan,
                billing_cycle: properties.billing_cycle,
                subscription_id: properties.subscription_id,
                is_renewal: properties.is_renewal || false
            });

            this.track('Subscription Revenue', {
                amount,
                plan: properties.plan,
                billing_cycle: properties.billing_cycle,
                subscription_id: properties.subscription_id,
                is_renewal: properties.is_renewal || false,
                event_type: 'revenue',
                timestamp: new Date().toISOString()
            }, userId);

            // Update LTV
            this.calculateLTV(userId, amount);

            loggingService.debug('Subscription revenue tracked:', { value: { userId, amount } });
        } catch (error) {
            loggingService.error('Error tracking subscription revenue:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Calculate and update lifetime value
     */
    public calculateLTV(userId: string, additionalRevenue: number): void {
        if (!this.isEnabled || !this.client) {
            return;
        }

        try {
            // Increment total revenue in user profile
            this.client.people.increment(userId, 'lifetime_value', additionalRevenue);
            this.client.people.increment(userId, 'total_revenue', additionalRevenue);

            loggingService.debug('LTV calculated:', { value: { userId, additionalRevenue } });
        } catch (error) {
            loggingService.error('Error calculating LTV:', { error: error instanceof Error ? error.message : String(error) });
        }
    }
}

// Export singleton instance
export const mixpanelService = MixpanelService.getInstance();