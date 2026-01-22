/**
 * ContextManager Unit Tests
 * Tests for conversation context management
 */

import { ContextManager } from '@services/chat/context';
import { EntityExtractor } from '@services/chat/context/EntityExtractor';
import { MessageAnalyzer } from '@services/chat/context/MessageAnalyzer';
import { CoreferenceResolver } from '@services/chat/context/CoreferenceResolver';
import { createMockRecentMessages } from '../../helpers/factories';
import { mockLoggingService } from '../../mocks/services.mock';

// Mock dependencies
jest.mock('@services/chat/context/EntityExtractor');
jest.mock('@services/chat/context/MessageAnalyzer');
jest.mock('@services/chat/context/CoreferenceResolver');
jest.mock('@services/logging.service', () => ({
    loggingService: mockLoggingService
}));

describe('ContextManager', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('buildContext', () => {
        it('should build context from message and history', () => {
            const conversationId = 'test-conv-id';
            const userMessage = 'How do I use TypeScript generics?';
            const recentMessages = createMockRecentMessages(3);

            (EntityExtractor.extractEntities as jest.Mock).mockReturnValue(['TypeScript', 'generics']);
            (MessageAnalyzer.analyzeMessage as jest.Mock).mockReturnValue({
                subject: 'TypeScript',
                intent: 'question',
                domain: 'programming',
                confidence: 0.9
            });
            (MessageAnalyzer.detectLanguageFramework as jest.Mock).mockReturnValue('typescript');

            const context = ContextManager.buildContext(conversationId, userMessage, recentMessages);

            expect(context).toMatchObject({
                conversationId,
                currentSubject: 'TypeScript',
                currentIntent: 'question',
                lastDomain: 'programming',
                languageFramework: 'typescript',
                subjectConfidence: 0.9
            });
            expect(context.lastReferencedEntities).toContain('TypeScript');
            expect(context.timestamp).toBeInstanceOf(Date);
        });

        it('should preserve previous context when available', () => {
            const conversationId = 'test-conv-id';
            
            // First call - establish context
            (EntityExtractor.extractEntities as jest.Mock).mockReturnValue(['React']);
            (MessageAnalyzer.analyzeMessage as jest.Mock).mockReturnValue({
                subject: 'React',
                intent: 'question',
                domain: 'frontend',
                confidence: 0.8
            });
            (MessageAnalyzer.detectLanguageFramework as jest.Mock).mockReturnValue('react');

            const context1 = ContextManager.buildContext(conversationId, 'What is React?', []);

            // Second call - should preserve some previous context
            (EntityExtractor.extractEntities as jest.Mock).mockReturnValue(['hooks']);
            (MessageAnalyzer.analyzeMessage as jest.Mock).mockReturnValue({
                subject: undefined, // No clear subject
                intent: 'question',
                domain: undefined,
                confidence: 0.5
            });
            (MessageAnalyzer.detectLanguageFramework as jest.Mock).mockReturnValue(undefined);

            const context2 = ContextManager.buildContext(conversationId, 'Tell me about hooks', []);

            expect(context2.currentSubject).toBe('React'); // Preserved from context1
            expect(context2.lastDomain).toBe('frontend'); // Preserved from context1
            expect(context2.languageFramework).toBe('react'); // Preserved from context1
            expect(context2.lastReferencedEntities).toContain('hooks');
        });

        it('should limit referenced entities to last 10', () => {
            const conversationId = 'test-conv-id';
            
            // Build context with 5 initial entities
            (EntityExtractor.extractEntities as jest.Mock).mockReturnValue(['e1', 'e2', 'e3', 'e4', 'e5']);
            (MessageAnalyzer.analyzeMessage as jest.Mock).mockReturnValue({
                subject: 'test',
                intent: 'question',
                domain: 'general',
                confidence: 0.8
            });

            ContextManager.buildContext(conversationId, 'message 1', []);

            // Add 7 more entities (total would be 12)
            (EntityExtractor.extractEntities as jest.Mock).mockReturnValue(['e6', 'e7', 'e8', 'e9', 'e10', 'e11', 'e12']);
            
            const context = ContextManager.buildContext(conversationId, 'message 2', []);

            expect(context.lastReferencedEntities).toHaveLength(10);
            expect(context.lastReferencedEntities).not.toContain('e1'); // Oldest should be dropped
            expect(context.lastReferencedEntities).not.toContain('e2');
            expect(context.lastReferencedEntities).toContain('e12'); // Newest should be kept
        });

        it('should log context building', () => {
            const conversationId = 'test-conv-id';
            const userMessage = 'test message';

            (EntityExtractor.extractEntities as jest.Mock).mockReturnValue([]);
            (MessageAnalyzer.analyzeMessage as jest.Mock).mockReturnValue({
                subject: 'test',
                intent: 'query',
                domain: 'general',
                confidence: 0.7
            });

            ContextManager.buildContext(conversationId, userMessage, []);

            expect(mockLoggingService.info).toHaveBeenCalledWith(
                '🔍 Built conversation context',
                expect.objectContaining({
                    conversationId,
                    subject: 'test',
                    domain: 'general',
                    confidence: 0.7
                })
            );
        });
    });

    describe('resolveReferences', () => {
        it('should resolve ambiguous references', async () => {
            const conversationId = 'test-conv-id';
            const message = 'Tell me more about it';
            const recentMessages = createMockRecentMessages(2);

            (CoreferenceResolver.resolve as jest.Mock).mockResolvedValue({
                resolved: true,
                resolvedMessage: 'Tell me more about TypeScript',
                referent: 'TypeScript',
                confidence: 0.85
            });

            const result = await ContextManager.resolveReferences(conversationId, message, recentMessages);

            expect(result.resolved).toBe(true);
            expect(result.resolvedMessage).toContain('TypeScript');
            expect(CoreferenceResolver.resolve).toHaveBeenCalled();
        });

        it('should handle resolution failures gracefully', async () => {
            const conversationId = 'test-conv-id';
            const message = 'Tell me about it';
            const recentMessages = createMockRecentMessages(1);

            (CoreferenceResolver.resolve as jest.Mock).mockResolvedValue({
                resolved: false,
                resolvedMessage: message,
                confidence: 0.2
            });

            const result = await ContextManager.resolveReferences(conversationId, message, recentMessages);

            expect(result.resolved).toBe(false);
            expect(result.resolvedMessage).toBe(message); // Original message preserved
        });
    });

    describe('generateContextPreamble', () => {
        it('should generate context preamble with all fields', () => {
            const conversationId = 'test-conv-id';
            
            (EntityExtractor.extractEntities as jest.Mock).mockReturnValue(['React', 'hooks', 'useState']);
            (MessageAnalyzer.analyzeMessage as jest.Mock).mockReturnValue({
                subject: 'React hooks',
                intent: 'learn',
                domain: 'frontend',
                confidence: 0.95
            });
            (MessageAnalyzer.detectLanguageFramework as jest.Mock).mockReturnValue('react');

            const context = ContextManager.buildContext(conversationId, 'How do React hooks work?', []);
            const preamble = ContextManager.generateContextPreamble(context);

            expect(preamble).toContain('React hooks');
            expect(preamble).toContain('frontend');
            expect(preamble).toContain('react');
            expect(preamble).toContain('React');
            expect(preamble).toContain('hooks');
            expect(preamble).toContain('useState');
        });

        it('should handle minimal context', () => {
            const conversationId = 'test-conv-id';
            
            (EntityExtractor.extractEntities as jest.Mock).mockReturnValue([]);
            (MessageAnalyzer.analyzeMessage as jest.Mock).mockReturnValue({
                subject: undefined,
                intent: 'query',
                domain: undefined,
                confidence: 0.5
            });
            (MessageAnalyzer.detectLanguageFramework as jest.Mock).mockReturnValue(undefined);

            const context = ContextManager.buildContext(conversationId, 'Hello', []);
            const preamble = ContextManager.generateContextPreamble(context);

            expect(preamble).toBeTruthy();
            expect(preamble.length).toBeGreaterThan(0);
        });
    });
});
