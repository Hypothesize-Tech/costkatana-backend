import crypto from 'crypto';
import {
    DocsPageRating,
    DocsPageFeedback,
    DocsPageView,
    DocsUserPreference,
    IDocsPageRating,
    IDocsPageFeedback,
    IDocsPageView,
} from '../models/docsAnalytics';
import { AIRouterService } from './aiRouter.service';
import { loggingService } from './logging.service';

export interface RatingStats {
    pageId: string;
    totalRatings: number;
    upvotes: number;
    downvotes: number;
    upvotePercentage: number;
    averageStarRating: number | null;
}

export interface PageViewStats {
    pageId: string;
    totalViews: number;
    uniqueSessions: number;
    avgTimeOnPage: number;
    avgScrollDepth: number;
}

export interface ContentRecommendation {
    pageId: string;
    pagePath: string;
    title: string;
    reason: string;
    relevanceScore: number;
}

export class DocsAnalyticsService {
    private static instance: DocsAnalyticsService;

    private constructor() {}

    static getInstance(): DocsAnalyticsService {
        if (!DocsAnalyticsService.instance) {
            DocsAnalyticsService.instance = new DocsAnalyticsService();
        }
        return DocsAnalyticsService.instance;
    }

    /**
     * Hash IP address for privacy
     */
    private hashIP(ip: string): string {
        return crypto.createHash('sha256').update(ip + 'docs-analytics').digest('hex').substring(0, 16);
    }

    // ==================== RATINGS ====================

    async submitRating(data: {
        pageId: string;
        pagePath: string;
        rating: 'up' | 'down';
        starRating?: number;
        sessionId: string;
        ip?: string;
        userAgent?: string;
    }): Promise<IDocsPageRating> {
        const ipHash = data.ip ? this.hashIP(data.ip) : undefined;

        // Upsert to allow changing rating
        const rating = await DocsPageRating.findOneAndUpdate(
            { pageId: data.pageId, sessionId: data.sessionId },
            {
                pageId: data.pageId,
                pagePath: data.pagePath,
                rating: data.rating,
                starRating: data.starRating,
                sessionId: data.sessionId,
                ipHash,
                userAgent: data.userAgent,
            },
            { upsert: true, new: true }
        );

        loggingService.info('Page rating submitted', { pageId: data.pageId, rating: data.rating });
        return rating;
    }

    async getRatingStats(pageId: string): Promise<RatingStats> {
        const ratings = await DocsPageRating.find({ pageId });
        
        const upvotes = ratings.filter(r => r.rating === 'up').length;
        const downvotes = ratings.filter(r => r.rating === 'down').length;
        const totalRatings = ratings.length;
        
        const starRatings = ratings.filter(r => r.starRating).map(r => r.starRating!);
        const averageStarRating = starRatings.length > 0 
            ? starRatings.reduce((a, b) => a + b, 0) / starRatings.length 
            : null;

        return {
            pageId,
            totalRatings,
            upvotes,
            downvotes,
            upvotePercentage: totalRatings > 0 ? (upvotes / totalRatings) * 100 : 0,
            averageStarRating,
        };
    }

    // ==================== FEEDBACK ====================

    async submitFeedback(data: {
        pageId: string;
        pagePath: string;
        feedbackType: 'bug' | 'improvement' | 'question' | 'other';
        message: string;
        email?: string;
        sessionId: string;
        ip?: string;
        userAgent?: string;
    }): Promise<IDocsPageFeedback> {
        const ipHash = data.ip ? this.hashIP(data.ip) : undefined;

        const feedback = await DocsPageFeedback.create({
            pageId: data.pageId,
            pagePath: data.pagePath,
            feedbackType: data.feedbackType,
            message: data.message,
            email: data.email,
            sessionId: data.sessionId,
            ipHash,
            userAgent: data.userAgent,
            status: 'new',
        });

        loggingService.info('Page feedback submitted', { pageId: data.pageId, type: data.feedbackType });
        return feedback;
    }

    async getFeedbackForPage(pageId: string): Promise<IDocsPageFeedback[]> {
        return DocsPageFeedback.find({ pageId }).sort({ createdAt: -1 }).limit(50);
    }

    // ==================== PAGE VIEWS ====================

    async trackPageView(data: {
        pageId: string;
        pagePath: string;
        sessionId: string;
        ip?: string;
        userAgent?: string;
        referrer?: string;
        deviceType?: 'desktop' | 'tablet' | 'mobile';
    }): Promise<IDocsPageView> {
        const ipHash = data.ip ? this.hashIP(data.ip) : undefined;

        // Create or update view for this session
        const view = await DocsPageView.findOneAndUpdate(
            { pageId: data.pageId, sessionId: data.sessionId },
            {
                $setOnInsert: {
                    pageId: data.pageId,
                    pagePath: data.pagePath,
                    sessionId: data.sessionId,
                    ipHash,
                    userAgent: data.userAgent,
                    referrer: data.referrer,
                    deviceType: data.deviceType,
                },
            },
            { upsert: true, new: true }
        );

        // Update user preferences
        await this.updateUserPreference(data.sessionId, data.pageId, data.pagePath);

        return view;
    }

    async updatePageViewMetrics(data: {
        pageId: string;
        sessionId: string;
        timeOnPage?: number;
        scrollDepth?: number;
        sectionsViewed?: string[];
    }): Promise<IDocsPageView | null> {
        const updateData: Record<string, any> = {};
        
        if (data.timeOnPage !== undefined) {
            updateData.timeOnPage = data.timeOnPage;
        }
        if (data.scrollDepth !== undefined) {
            updateData.scrollDepth = data.scrollDepth;
        }
        if (data.sectionsViewed) {
            updateData.$addToSet = { sectionsViewed: { $each: data.sectionsViewed } };
        }

        return DocsPageView.findOneAndUpdate(
            { pageId: data.pageId, sessionId: data.sessionId },
            updateData,
            { new: true }
        );
    }

    async getPageViewStats(pageId: string): Promise<PageViewStats> {
        const views = await DocsPageView.find({ pageId });
        
        const uniqueSessions = new Set(views.map(v => v.sessionId)).size;
        const timesOnPage = views.filter(v => v.timeOnPage).map(v => v.timeOnPage!);
        const scrollDepths = views.filter(v => v.scrollDepth).map(v => v.scrollDepth!);

        return {
            pageId,
            totalViews: views.length,
            uniqueSessions,
            avgTimeOnPage: timesOnPage.length > 0 
                ? timesOnPage.reduce((a, b) => a + b, 0) / timesOnPage.length 
                : 0,
            avgScrollDepth: scrollDepths.length > 0 
                ? scrollDepths.reduce((a, b) => a + b, 0) / scrollDepths.length 
                : 0,
        };
    }

    // ==================== USER PREFERENCES ====================

    private async updateUserPreference(sessionId: string, pageId: string, pagePath: string): Promise<void> {
        await DocsUserPreference.findOneAndUpdate(
            { sessionId },
            {
                $setOnInsert: { sessionId },
                $set: { lastActive: new Date() },
                $push: {
                    visitedPages: {
                        $each: [{ pageId, pagePath, visitCount: 1, totalTime: 0, lastVisited: new Date() }],
                        $slice: -100, // Keep last 100 pages
                    },
                },
            },
            { upsert: true }
        );
    }

    async getUserPreference(sessionId: string) {
        return DocsUserPreference.findOne({ sessionId });
    }

    // ==================== RECOMMENDATIONS ====================

    async getRecommendations(sessionId: string): Promise<ContentRecommendation[]> {
        const userPref = await DocsUserPreference.findOne({ sessionId });
        
        if (!userPref || userPref.visitedPages.length === 0) {
            // Return popular pages for new users
            return this.getPopularPages();
        }

        // Get AI-powered recommendations based on user behavior
        return this.generateAIRecommendations(userPref);
    }

    private async getPopularPages(): Promise<ContentRecommendation[]> {
        const popularPages = await DocsPageView.aggregate([
            { $group: { _id: '$pageId', pagePath: { $first: '$pagePath' }, count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
        ]);

        return popularPages.map((p, index) => ({
            pageId: p._id,
            pagePath: p.pagePath,
            title: this.extractTitleFromPath(p.pagePath),
            reason: 'Popular among readers',
            relevanceScore: 1 - (index * 0.1),
        }));
    }

    private extractTitleFromPath(path: string): string {
        const segments = path.split('/').filter(Boolean);
        const lastSegment = segments[segments.length - 1] || 'Home';
        return lastSegment
            .replace(/-/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());
    }

    private async generateAIRecommendations(userPref: any): Promise<ContentRecommendation[]> {
        try {
            const visitedPaths = userPref.visitedPages.map((p: any) => p.pagePath).slice(-10);
            
            const prompt = `Based on a user's documentation reading history, suggest 3-5 related pages they might find helpful.

USER'S RECENTLY VISITED PAGES:
${visitedPaths.join('\n')}

AVAILABLE DOCUMENTATION SECTIONS:
- /getting-started (Introduction, Quick Start)
- /features (Gateway, Analytics, Optimization, Cortex, Webhooks, Guardrails, Workflows, Cache, Key Vault)
- /sdk (TypeScript SDK, Python SDK, CLI)
- /api (API Reference)
- /examples (Code Examples)

RESPONSE FORMAT - ONLY JSON:
{
  "recommendations": [
    {
      "pagePath": "/features/optimization",
      "title": "Cost Optimization",
      "reason": "Based on your interest in analytics"
    }
  ]
}`;

            const modelId = process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';
            const response = await AIRouterService.invokeModel(prompt, modelId);
            
            if (response) {
                const jsonMatch = response.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    return parsed.recommendations.map((r: any, index: number) => ({
                        pageId: r.pagePath.replace(/\//g, '-'),
                        pagePath: r.pagePath,
                        title: r.title,
                        reason: r.reason,
                        relevanceScore: 1 - (index * 0.15),
                    }));
                }
            }
        } catch (error) {
            loggingService.error('AI recommendation generation failed', { error });
        }

        // Fallback to popular pages
        return this.getPopularPages();
    }

    /**
     * AI-powered semantic search for documentation
     */
    async aiSearch(query: string): Promise<{
        results: ContentRecommendation[];
        suggestions: string[];
    }> {
        try {
            // Documentation pages available for search
            const availablePages = [
                { path: '/getting-started/introduction', title: 'Introduction', content: 'Learn what Cost Katana is and how it can help optimize your AI costs' },
                { path: '/getting-started/quick-start', title: 'Quick Start', content: 'Get up and running with Cost Katana in minutes' },
                { path: '/getting-started/installation', title: 'Installation', content: 'Detailed installation instructions for all platforms' },
                { path: '/features/dashboard', title: 'Dashboard', content: 'Real-time monitoring and insights dashboard' },
                { path: '/features/usage-tracking', title: 'Usage Tracking', content: 'Track your AI usage across all providers' },
                { path: '/features/analytics', title: 'Cost Analytics', content: 'Advanced cost analysis and reporting' },
                { path: '/features/optimization', title: 'AI Optimization', content: 'Intelligent cost reduction strategies' },
                { path: '/features/predictive-intelligence', title: 'Predictive Intelligence', content: 'AI-powered cost forecasting' },
                { path: '/features/projects', title: 'Projects', content: 'Organize and track projects' },
                { path: '/features/templates', title: 'Prompt Templates', content: 'Reusable optimized prompts' },
                { path: '/features/workflows', title: 'Workflows', content: 'Multi-step operation monitoring' },
                { path: '/features/gateway', title: 'Gateway & Proxy', content: 'Unified API gateway for all providers' },
                { path: '/features/key-vault', title: 'Key Vault', content: 'Secure API key management' },
                { path: '/features/alerts', title: 'Alerts', content: 'Proactive cost monitoring and alerts' },
                { path: '/api', title: 'API Overview', content: 'Complete API documentation' },
                { path: '/api/authentication', title: 'Authentication', content: 'JWT and API key authentication' },
                { path: '/api/usage', title: 'Usage API', content: 'Track AI usage programmatically' },
                { path: '/api/analytics', title: 'Analytics API', content: 'Retrieve analytics data via API' },
                { path: '/integrations/nodejs', title: 'Node.js SDK', content: 'Integrate Cost Katana with Node.js applications' },
                { path: '/integrations/python', title: 'Python SDK', content: 'Integrate Cost Katana with Python applications' },
                { path: '/integrations/cli', title: 'CLI Tool', content: 'Command-line interface for AI cost optimization' },
            ];

            const prompt = `You are an AI assistant helping users search documentation. Analyze the user's search query and return relevant documentation pages.

USER'S SEARCH QUERY: "${query}"

AVAILABLE DOCUMENTATION PAGES:
${availablePages.map((page: { path: string; title: string; content: string }) => `- ${page.path}: ${page.title} - ${page.content}`).join('\n')}

Your task:
1. Find the most relevant pages (3-8 results) based on semantic understanding, not just keyword matching
2. Provide a reason why each page is relevant
3. Suggest 2-3 related search queries the user might want to try

RESPONSE FORMAT - ONLY JSON:
{
  "results": [
    {
      "pagePath": "/features/optimization",
      "title": "AI Optimization",
      "reason": "This page explains how to optimize AI costs, which directly relates to your search",
      "relevanceScore": 0.95
    }
  ],
  "suggestions": ["cost optimization", "reduce AI spending", "prompt optimization"]
}`;

            const modelId = 'amazon.nova-pro-v1:0';
            const response = await AIRouterService.invokeModel(prompt, modelId);
            
            if (response) {
                const jsonMatch = response.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    return {
                        results: parsed.results.map((r: { pagePath: string; title: string; reason: string; relevanceScore?: number }) => ({
                            pageId: r.pagePath.replace(/\//g, '-'),
                            pagePath: r.pagePath,
                            title: r.title,
                            reason: r.reason,
                            relevanceScore: r.relevanceScore || 0.8,
                        })),
                        suggestions: parsed.suggestions || [],
                    };
                }
            }
        } catch (error) {
            loggingService.error('AI search failed', { error, query });
        }

        // Fallback: return empty results with suggestions
        return {
            results: [],
            suggestions: [`${query} tutorial`, `${query} guide`, `how to ${query}`],
        };
    }

    // ==================== CONTENT VERSIONING ====================

    async getPageMeta(pageId: string): Promise<{
        pageId: string;
        lastUpdated: Date | null;
        totalViews: number;
        helpfulnessScore: number;
    }> {
        const [viewStats, ratingStats] = await Promise.all([
            this.getPageViewStats(pageId),
            this.getRatingStats(pageId),
        ]);

        return {
            pageId,
            lastUpdated: null, // Would be populated from git or CMS
            totalViews: viewStats.totalViews,
            helpfulnessScore: ratingStats.upvotePercentage,
        };
    }

    // ==================== ANALYTICS AGGREGATION ====================

    async getOverallStats(): Promise<{
        totalPageViews: number;
        totalRatings: number;
        totalFeedback: number;
        avgHelpfulness: number;
        topPages: Array<{ pageId: string; views: number }>;
    }> {
        const [totalViews, totalRatings, totalFeedback, topPages] = await Promise.all([
            DocsPageView.countDocuments(),
            DocsPageRating.countDocuments(),
            DocsPageFeedback.countDocuments(),
            DocsPageView.aggregate([
                { $group: { _id: '$pageId', views: { $sum: 1 } } },
                { $sort: { views: -1 } },
                { $limit: 10 },
            ]),
        ]);

        const allRatings = await DocsPageRating.find();
        const upvotes = allRatings.filter(r => r.rating === 'up').length;
        const avgHelpfulness = allRatings.length > 0 ? (upvotes / allRatings.length) * 100 : 0;

        return {
            totalPageViews: totalViews,
            totalRatings,
            totalFeedback,
            avgHelpfulness,
            topPages: topPages.map(p => ({ pageId: p._id, views: p.views })),
        };
    }
}

export const docsAnalyticsService = DocsAnalyticsService.getInstance();

