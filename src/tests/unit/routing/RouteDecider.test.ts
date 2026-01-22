/**
 * RouteDecider Unit Tests
 * Tests for routing decision logic
 */

import { RouteDecider } from '@services/chat/routing';
import { AIRouter } from '@services/chat/routing/AIRouter';
import { LegacyRouter } from '@services/chat/routing/LegacyRouter';
import { createMockConversationContext } from '../../helpers/factories';
import { mockLoggingService } from '../../mocks/services.mock';

// Mock dependencies
jest.mock('@services/chat/routing/AIRouter');
jest.mock('@services/chat/routing/LegacyRouter');
jest.mock('@services/logging.service', () => ({
    loggingService: mockLoggingService
}));

describe('RouteDecider', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('decide', () => {
        it('should use AI router by default', async () => {
            const context = createMockConversationContext({
                currentSubject: 'weather',
                lastDomain: 'general'
            });
            const message = 'What is the weather today?';
            const userId = 'test-user-id';

            (AIRouter.route as jest.Mock).mockResolvedValue('web_scraper');

            const route = await RouteDecider.decide(context, message, userId);

            expect(route).toBe('web_scraper');
            expect(AIRouter.route).toHaveBeenCalledWith(context, message, userId, undefined);
            expect(LegacyRouter.route).not.toHaveBeenCalled();
        });

        it('should pass useWebSearch flag to AI router', async () => {
            const context = createMockConversationContext();
            const message = 'search for TypeScript tutorials';
            const userId = 'test-user-id';
            const useWebSearch = true;

            (AIRouter.route as jest.Mock).mockResolvedValue('web_scraper');

            await RouteDecider.decide(context, message, userId, useWebSearch);

            expect(AIRouter.route).toHaveBeenCalledWith(context, message, userId, useWebSearch);
        });

        it('should fallback to legacy router on AI failure', async () => {
            const context = createMockConversationContext();
            const message = 'search google';
            const userId = 'test-user-id';

            (AIRouter.route as jest.Mock).mockRejectedValue(new Error('AI service unavailable'));
            (LegacyRouter.route as jest.Mock).mockReturnValue('web_scraper');

            const route = await RouteDecider.decide(context, message, userId);

            expect(route).toBe('web_scraper');
            expect(AIRouter.route).toHaveBeenCalled();
            expect(LegacyRouter.route).toHaveBeenCalledWith(context, message, undefined);
            expect(mockLoggingService.warn).toHaveBeenCalledWith(
                'Using legacy routing fallback',
                expect.any(Object)
            );
        });

        it('should log AI routing decision with context', async () => {
            const context = createMockConversationContext({
                currentSubject: 'code',
                lastDomain: 'programming',
                subjectConfidence: 0.95,
                currentIntent: 'question'
            });
            const message = 'How do I write a test?';
            const userId = 'test-user-id';

            (AIRouter.route as jest.Mock).mockResolvedValue('knowledge_base');

            await RouteDecider.decide(context, message, userId);

            expect(mockLoggingService.info).toHaveBeenCalledWith(
                '🎯 Route decision (AI)',
                expect.objectContaining({
                    route: 'knowledge_base',
                    subject: 'code',
                    domain: 'programming',
                    confidence: 0.95,
                    intent: 'question'
                })
            );
        });

        it('should log legacy routing decision', async () => {
            const context = createMockConversationContext();
            const message = 'search something';
            const userId = 'test-user-id';

            (AIRouter.route as jest.Mock).mockRejectedValue(new Error('Timeout'));
            (LegacyRouter.route as jest.Mock).mockReturnValue('conversational_flow');

            await RouteDecider.decide(context, message, userId);

            expect(mockLoggingService.info).toHaveBeenCalledWith(
                '🎯 Route decision (Legacy)',
                expect.objectContaining({
                    route: 'conversational_flow'
                })
            );
        });

        it('should handle AI router timeout gracefully', async () => {
            const context = createMockConversationContext();
            const message = 'test message';
            const userId = 'test-user-id';

            (AIRouter.route as jest.Mock).mockImplementation(() => 
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000))
            );
            (LegacyRouter.route as jest.Mock).mockReturnValue('conversational_flow');

            const route = await RouteDecider.decide(context, message, userId);

            expect(route).toBe('conversational_flow');
        });
    });
});
