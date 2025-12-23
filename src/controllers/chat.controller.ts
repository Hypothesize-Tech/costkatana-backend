import { Request, Response } from 'express';
import { loggingService } from '../services/logging.service';
import { ChatService } from '../services/chat.service';
import { LLMSecurityService } from '../services/llmSecurity.service';
import { v4 as uuidv4 } from 'uuid';
import { extractLinkMetadata } from '../utils/linkMetadata';

export interface AuthenticatedRequest extends Request {
    userId?: string;
}

/**
 * Send a message to a specific AWS Bedrock model
 */
export const sendMessage = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const userId = req.userId;
    const { 
        message, 
        modelId, 
        conversationId, 
        temperature = 0.7, 
        maxTokens = 8000, 
        documentIds, 
        githubContext,
        templateId,
        templateVariables 
    } = req.body;

    try {
        loggingService.info('Chat message request initiated', {
            userId,
            modelId,
            conversationId: conversationId || 'new',
            messageLength: message?.length || 0,
            hasTemplate: !!templateId,
            hasVariables: !!templateVariables,
            temperature,
            maxTokens,
            requestId: req.headers['x-request-id'] as string
        });

        if (!userId) {
            loggingService.warn('Chat message request failed - no user authentication', {
                requestId: req.headers['x-request-id'] as string
            });

            res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
            return;
        }

        // Validate that either message or templateId is provided
        if (!message && !templateId) {
            loggingService.warn('Chat message request failed - neither message nor templateId provided', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(400).json({
                success: false,
                message: 'Either message or templateId must be provided'
            });
            return;
        }

        if (!modelId) {
            loggingService.warn('Chat message request failed - missing modelId', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(400).json({
                success: false,
                message: 'modelId is required'
            });
            return;
        }

        // SECURITY CHECK: Comprehensive threat detection before processing message
        // This checks for all 15 threat categories including HTML content
        if (message) {
            try {
                const requestId = req.headers['x-request-id'] as string || 
                                 `chat_${Date.now()}_${uuidv4()}`;
                
                // Extract IP address and user agent for logging
                const ipAddress = req.ip || 
                                req.headers['x-forwarded-for']?.toString().split(',')[0] || 
                                req.socket.remoteAddress || 
                                'unknown';
                const userAgent = req.headers['user-agent'] || 'unknown';

                // Estimate cost for this request (rough estimate: ~$0.01 per 1000 tokens)
                // message is guaranteed to be defined here due to the if (message) check above
                const messageLength = message ? message.length : 0;
                const estimatedTokens = Math.ceil(messageLength / 4) + (maxTokens || 1000);
                const estimatedCost = estimatedTokens * 0.00001; // Rough estimate

                // Perform comprehensive security check
                const securityCheck = await LLMSecurityService.performSecurityCheck(
                    message,
                    requestId,
                    userId,
                    {
                        estimatedCost,
                        provenanceSource: 'chat-api',
                        ipAddress,
                        userAgent,
                        source: 'chat-api'
                    }
                );

                // If threat detected, block the request
                if (securityCheck.result.isBlocked) {
                    loggingService.warn('Chat message blocked by security', {
                        requestId,
                        userId,
                        modelId,
                        threatCategory: securityCheck.result.threatCategory,
                        confidence: securityCheck.result.confidence,
                        stage: securityCheck.result.stage,
                        reason: securityCheck.result.reason
                    });

                    res.status(403).json({
                        success: false,
                        message: securityCheck.result.reason || 'Message blocked by security system',
                        error: 'SECURITY_BLOCK',
                        threatCategory: securityCheck.result.threatCategory,
                        confidence: securityCheck.result.confidence,
                        stage: securityCheck.result.stage
                    });
                    return;
                }

                loggingService.debug('Chat message security check passed', {
                    requestId,
                    userId,
                    modelId,
                    messageLength: message.length
                });

            } catch (error: any) {
                // Log security check failures but allow request to proceed (fail-open)
                loggingService.error('Chat message security check failed, allowing request', {
                    error: error instanceof Error ? error.message : String(error),
                    userId,
                    modelId,
                    messageLength: message?.length || 0
                });
                // Continue to process the message if security check fails
            }
        }

        // AUTO-DETECT AND EXTRACT METADATA FOR LINKS IN MESSAGE (non-blocking)
        let enrichedMessage = message;
        if (message) {
            try {
                const urlPattern = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;
                const detectedUrls = message.match(urlPattern);

                if (detectedUrls && detectedUrls.length > 0) {
                    loggingService.debug('Detected URLs in message, extracting metadata', {
                        userId,
                        urlCount: detectedUrls.length,
                        urls: detectedUrls
                    });

                    // Extract metadata for all detected URLs with timeout (don't block message sending)
                    const metadataPromises = detectedUrls.map(async (url: string) => {
                        try {
                            // Use Promise.race with timeout to prevent blocking
                            const timeoutPromise = new Promise<{ url: string; metadata: import('../utils/linkMetadata').LinkMetadata | null }>((resolve) => 
                                setTimeout(() => resolve({ url, metadata: null }), 2000)
                            );
                            const fetchPromise = extractLinkMetadata(url).then(metadata => ({ url, metadata }));
                            return await Promise.race([fetchPromise, timeoutPromise]);
                        } catch (error) {
                            // Fallback to just URL if metadata extraction fails
                            loggingService.debug('Link metadata extraction failed', {
                                url,
                                error: error instanceof Error ? error.message : String(error)
                            });
                            return { url, metadata: null };
                        }
                    });

                    // Wait for metadata extraction (with timeout) but don't block if it takes too long
                    type UrlWithMetadata = { url: string; metadata: import('../utils/linkMetadata').LinkMetadata | null };
                    const urlsWithMetadata = await Promise.race([
                        Promise.all(metadataPromises),
                        new Promise<UrlWithMetadata[]>((resolve) => 
                            setTimeout(() => resolve(detectedUrls.map((url: string) => ({ url, metadata: null }))), 2500)
                        )
                    ]);

                    // Build link context to prepend at the beginning of the message
                    // This ensures the AI sees the instructions FIRST before any other content
                    let linkContextPrefix = '';
                    const linkDescriptions: string[] = [];
                    
                    urlsWithMetadata.forEach(({ url, metadata }) => {
                        if (metadata?.title) {
                            // Consistent format for all public links with explicit instructions
                            const linkType = metadata.type === 'repository' ? 'Repository' : 
                                          metadata.type === 'video' ? 'Video' : 
                                          metadata.siteName ?? 'Link';
                            
                            // Build comprehensive link info with scraped content
                            let linkInfo = `📎 **ATTACHED PUBLIC LINK - ${linkType}:**\n**Title:** ${metadata.title}\n**URL:** ${url}`;
                            
                            if (metadata.description) {
                                linkInfo += `\n**Description:** ${metadata.description.substring(0, 300)}${metadata.description.length > 300 ? '...' : ''}`;
                            }
                            
                            // Add AI-generated summary if available (from Puppeteer + AI scraping)
                            if (metadata.summary) {
                                linkInfo += `\n\n**📊 AI SUMMARY:**\n${metadata.summary}`;
                            }
                            
                            // Add structured data if extracted by AI
                            if (metadata.structuredData) {
                                linkInfo += `\n\n**📋 STRUCTURED DATA EXTRACTED:**\n${JSON.stringify(metadata.structuredData, null, 2).substring(0, 1000)}`;
                            }
                            
                            // Add full content if available
                            if (metadata.fullContent && metadata.fullContent.length > 100) {
                                const contentPreview = metadata.fullContent.substring(0, 5000);
                                linkInfo += `\n\n**📄 FULL PAGE CONTENT:**\n${contentPreview}${metadata.fullContent.length > 5000 ? '...\n[Content truncated for length]' : ''}`;
                            }
                            
                            // Add code blocks if available
                            if (metadata.codeBlocks && metadata.codeBlocks.length > 0) {
                                linkInfo += `\n\n**CODE BLOCKS FOUND (${metadata.codeBlocks.length}):**`;
                                metadata.codeBlocks.slice(0, 3).forEach((block: { language?: string; code: string }, idx: number) => {
                                    const lang = block.language ? ` (${block.language})` : '';
                                    linkInfo += `\n\n**Code Block ${idx + 1}${lang}:**\n\`\`\`${block.language ?? ''}\n${block.code.substring(0, 1000)}\n\`\`\``;
                                });
                                if (metadata.codeBlocks.length > 3) {
                                    linkInfo += `\n... and ${metadata.codeBlocks.length - 3} more code blocks`;
                                }
                            }
                            
                            // Add images info if available
                            if (metadata.images && metadata.images.length > 0) {
                                linkInfo += `\n\n**🖼️ IMAGES FOUND:** ${metadata.images.length} images on this page`;
                            }
                            
                            // Add scraping method info for transparency
                            if (metadata.scrapingMethod) {
                                const methodLabel = metadata.scrapingMethod === 'puppeteer-ai' 
                                    ? '🤖 Advanced AI Scraping (Puppeteer + AI Analysis + Vector Storage)'
                                    : '⚡ Fast Scraping (Axios + Cheerio)';
                                linkInfo += `\n\n**Method:** ${methodLabel}`;
                            }
                            
                            linkDescriptions.push(linkInfo);
                            
                            // Remove URL from message (will be replaced with just the link info)
                            enrichedMessage = enrichedMessage.replace(url, `[LINK_${linkDescriptions.length}]`);
                            
                            loggingService.debug('Link metadata extracted and added to message', {
                                url,
                                title: metadata.title,
                                siteName: metadata.siteName,
                                type: metadata.type,
                                hasFullContent: !!metadata.fullContent,
                                codeBlocksCount: metadata.codeBlocks?.length || 0,
                                imagesCount: metadata.images?.length || 0,
                                scrapingMethod: metadata.scrapingMethod,
                                hasSummary: !!metadata.summary,
                                hasStructuredData: !!metadata.structuredData,
                                relevanceScore: metadata.relevanceScore
                            });
                        } else {
                            // For links without metadata - still provide explicit context
                            const linkInfo = `📎 **ATTACHED PUBLIC LINK:**\n**URL:** ${url}`;
                            linkDescriptions.push(linkInfo);
                            
                            // Remove URL from message
                            enrichedMessage = enrichedMessage.replace(url, `[LINK_${linkDescriptions.length}]`);
                        }
                    });
                    
                    // Prepend all link information at the VERY BEGINNING with strong instructions
                    if (linkDescriptions.length > 0) {
                        linkContextPrefix = `\n\n⚠️ **IMPORTANT: USER IS ASKING ABOUT THE LINK(S) BELOW** ⚠️\n\n${linkDescriptions.join('\n\n')}\n\n**🚨 CRITICAL INSTRUCTIONS - READ CAREFULLY:**\n1. The user's question is SPECIFICALLY about the link(s) shown above\n2. You MUST provide a comprehensive summary based on:\n   - The full page content provided above\n   - Any code blocks extracted from the page\n   - Images and other media found on the page\n   - The overall structure and purpose of the content\n3. COMPLETELY IGNORE and DO NOT mention:\n   - Any Google Drive files\n   - Any other documents or files\n   - Any previous conversation context about other topics\n   - Anything not directly related to the link(s) above\n4. Your summary should cover:\n   - What the page/repository/content is about\n   - Key sections or components\n   - Any code, technical details, or implementations mentioned\n   - The purpose and functionality\n5. Be thorough and detailed in your analysis of the scraped content\n\n**User's question:**\n`;
                        
                        // Replace link placeholders back with just the URL
                        linkDescriptions.forEach((_, index) => {
                            const url = urlsWithMetadata[index]?.url || '';
                            enrichedMessage = enrichedMessage.replace(`[LINK_${index + 1}]`, url);
                        });
                        
                        // Prepend the link context at the beginning
                        enrichedMessage = linkContextPrefix + enrichedMessage;
                    }
                }
            } catch (error) {
                // Log error but continue with original message if metadata extraction fails
                loggingService.error('Failed to extract link metadata in chat controller', {
                    error: error instanceof Error ? error.message : String(error),
                    userId,
                    messageLength: message?.length || 0
                });
                // Continue with original message
            }
        }

        const result = await ChatService.sendMessage({
            userId,
            message: enrichedMessage, // Enriched message with instructions for AI
            originalMessage: message, // Original user message for storage/display
            modelId,
            conversationId,
            temperature,
            maxTokens,
            documentIds,
            githubContext,
            templateId,
            templateVariables,
            req
        });

        const duration = Date.now() - startTime;

        loggingService.info('Chat message sent successfully', {
            userId,
            modelId,
            conversationId: conversationId || 'new',
            duration,
            messageLength: message?.length || 0,
            responseLength: result.response?.length || 0,
            requestId: req.headers['x-request-id'] as string
        });

        // Log business event
        loggingService.logBusiness({
            event: 'chat_message_sent',
            category: 'chat_management',
            value: duration,
            metadata: {
                userId,
                modelId,
                conversationId: conversationId || 'new',
                messageLength: message?.length || 0,
                responseLength: result.response?.length || 0,
                temperature,
                maxTokens
            }
        });

        res.json({
            success: true,
            data: result
        });

    } catch (error: any) {
        const duration = Date.now() - startTime;
        
        loggingService.error('Chat message failed', {
            userId,
            modelId,
            conversationId: conversationId || 'new',
            error: error.message || 'Unknown error',
            stack: error.stack,
            duration,
            requestId: req.headers['x-request-id'] as string
        });

        res.status(500).json({
            success: false,
            message: 'Failed to send message',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get conversation history
 */
export const getConversationHistory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const userId = req.userId;
    const { conversationId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    try {
        loggingService.info('Conversation history request initiated', {
            userId,
            conversationId,
            limit,
            offset,
            requestId: req.headers['x-request-id'] as string
        });

        if (!userId) {
            loggingService.warn('Conversation history request failed - no user authentication', {
                requestId: req.headers['x-request-id'] as string
            });

            res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
            return;
        }

        if (!conversationId) {
            loggingService.warn('Conversation history request failed - missing conversation ID', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(400).json({
                success: false,
                message: 'Conversation ID is required'
            });
            return;
        }

        const history = await ChatService.getConversationHistory(
            conversationId, 
            userId, 
            limit, 
            offset
        );

        const duration = Date.now() - startTime;

        loggingService.info('Conversation history retrieved successfully', {
            userId,
            conversationId,
            duration,
            limit,
            offset,
            historyLength: history.messages?.length || 0,
            totalMessages: history.total || 0,
            requestId: req.headers['x-request-id'] as string
        });

        // Log business event
        loggingService.logBusiness({
            event: 'conversation_history_retrieved',
            category: 'chat_management',
            value: duration,
            metadata: {
                userId,
                conversationId,
                limit,
                offset,
                historyLength: history.messages?.length || 0,
                totalMessages: history.total || 0
            }
        });

        res.json({
            success: true,
            data: history
        });

    } catch (error: any) {
        const duration = Date.now() - startTime;
        
        loggingService.error('Conversation history retrieval failed', {
            userId,
            conversationId,
            limit,
            offset,
            error: error.message || 'Unknown error',
            stack: error.stack,
            duration,
            requestId: req.headers['x-request-id'] as string
        });

        res.status(500).json({
            success: false,
            message: 'Failed to get conversation history',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get all conversations for a user
 */
export const getUserConversations = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const userId = req.userId;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const includeArchived = req.query.includeArchived === 'true';

    try {
        loggingService.info('User conversations request initiated', {
            userId,
            limit,
            offset,
            includeArchived,
            requestId: req.headers['x-request-id'] as string
        });

        if (!userId) {
            loggingService.warn('User conversations request failed - no user authentication', {
                requestId: req.headers['x-request-id'] as string
            });

            res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
            return;
        }

        const conversations = await ChatService.getUserConversations(
            userId, 
            limit, 
            offset,
            includeArchived
        );

        const duration = Date.now() - startTime;

        loggingService.info('User conversations retrieved successfully', {
            userId,
            duration,
            limit,
            offset,
            includeArchived,
            conversationsCount: conversations.conversations?.length || 0,
            totalConversations: conversations.total || 0,
            requestId: req.headers['x-request-id'] as string
        });

        // Log business event
        loggingService.logBusiness({
            event: 'user_conversations_retrieved',
            category: 'chat_management',
            value: duration,
            metadata: {
                userId,
                limit,
                offset,
                includeArchived,
                conversationsCount: conversations.conversations?.length || 0,
                totalConversations: conversations.total || 0
            }
        });

        res.json({
            success: true,
            data: conversations
        });

    } catch (error: any) {
        const duration = Date.now() - startTime;
        
        loggingService.error('User conversations retrieval failed', {
            userId,
            limit,
            offset,
            includeArchived,
            error: error.message || 'Unknown error',
            stack: error.stack,
            duration,
            requestId: req.headers['x-request-id'] as string
        });

        res.status(500).json({
            success: false,
            message: 'Failed to get conversations',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Create a new conversation
 */
export const createConversation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const userId = req.userId;
    const { title, modelId } = req.body;

    try {
        loggingService.info('Conversation creation request initiated', {
            userId,
            title: title || `Chat with ${modelId}`,
            modelId,
            requestId: req.headers['x-request-id'] as string
        });

        if (!userId) {
            loggingService.warn('Conversation creation request failed - no user authentication', {
                requestId: req.headers['x-request-id'] as string
            });

            res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
            return;
        }

        if (!modelId) {
            loggingService.warn('Conversation creation request failed - missing model ID', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(400).json({
                success: false,
                message: 'Model ID is required'
            });
            return;
        }

        const conversation: any = await ChatService.createConversation({
            userId,
            title: title || `Chat with ${modelId}`,
            modelId
        });

        const duration = Date.now() - startTime;

        loggingService.info('Conversation created successfully', {
            userId,
            conversationId: conversation.id,
            title: title || `Chat with ${modelId}`,
            modelId,
            duration,
            requestId: req.headers['x-request-id'] as string
        });

        // Log business event
        loggingService.logBusiness({
            event: 'conversation_created',
            category: 'chat_management',
            value: duration,
            metadata: {
                userId,
                conversationId: conversation.id,
                title: title || `Chat with ${modelId}`,
                modelId
            }
        });

        res.json({
            success: true,
            data: conversation
        });

    } catch (error: any) {
        const duration = Date.now() - startTime;
        
        loggingService.error('Conversation creation failed', {
            userId,
            title: title || `Chat with ${modelId}`,
            modelId,
            error: error.message || 'Unknown error',
            stack: error.stack,
            duration,
            requestId: req.headers['x-request-id'] as string
        });

        res.status(500).json({
            success: false,
            message: 'Failed to create conversation',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Update conversation GitHub context
 */
export const updateConversationGitHubContext = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.userId;
    const { conversationId } = req.params;
    const { githubContext } = req.body;

    try {
        if (!userId) {
            res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
            return;
        }

        if (!conversationId) {
            res.status(400).json({
                success: false,
                message: 'Conversation ID is required'
            });
            return;
        }

        if (!githubContext || !(githubContext as { connectionId?: string; repositoryId?: number }).connectionId || !(githubContext as { connectionId?: string; repositoryId?: number }).repositoryId) {
            res.status(400).json({
                success: false,
                message: 'Valid GitHub context is required'
            });
            return;
        }

        const { Conversation } = await import('../models');
        const { GitHubConnection } = await import('../models');

        // Verify conversation ownership
        const conversation = await Conversation.findOne({
            _id: conversationId,
            userId: userId
        });

        if (!conversation) {
            res.status(404).json({
                success: false,
                message: 'Conversation not found or access denied'
            });
            return;
        }

        const githubCtx = githubContext as { connectionId: string; repositoryId: number; repositoryName?: string; repositoryFullName?: string };
        
        // Verify GitHub connection exists and belongs to user
        const connection = await GitHubConnection.findOne({
            _id: githubCtx.connectionId,
            userId: userId,
            isActive: true
        });

        if (!connection) {
            res.status(404).json({
                success: false,
                message: 'GitHub connection not found or inactive'
            });
            return;
        }

        // Update conversation with GitHub context
        await Conversation.findByIdAndUpdate(conversationId, {
            githubContext: {
                connectionId: connection._id,
                repositoryId: githubCtx.repositoryId,
                repositoryName: githubCtx.repositoryName,
                repositoryFullName: githubCtx.repositoryFullName
            }
        });

        loggingService.info('Conversation GitHub context updated', {
            userId,
            conversationId,
            repository: githubCtx.repositoryFullName
        });

        res.json({
            success: true,
            message: 'GitHub context updated successfully'
        });

    } catch (error: any) {
        loggingService.error('Failed to update conversation GitHub context', {
            userId,
            conversationId,
            error: error.message
        });

        res.status(500).json({
            success: false,
            message: 'Failed to update GitHub context',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Delete a conversation
 */
export const deleteConversation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const userId = req.userId;
    const { conversationId } = req.params;

    try {
        loggingService.info('Conversation deletion request initiated', {
            userId,
            conversationId,
            requestId: req.headers['x-request-id'] as string
        });

        if (!userId) {
            loggingService.warn('Conversation deletion request failed - no user authentication', {
                requestId: req.headers['x-request-id'] as string
            });

            res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
            return;
        }

        if (!conversationId) {
            loggingService.warn('Conversation deletion request failed - missing conversation ID', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(400).json({
                success: false,
                message: 'Conversation ID is required'
            });
            return;
        }

        await ChatService.deleteConversation(conversationId, userId);

        const duration = Date.now() - startTime;

        loggingService.info('Conversation deleted successfully', {
            userId,
            conversationId,
            duration,
            requestId: req.headers['x-request-id'] as string
        });

        // Log business event
        loggingService.logBusiness({
            event: 'conversation_deleted',
            category: 'chat_management',
            value: duration,
            metadata: {
                userId,
                conversationId
            }
        });

        res.json({
            success: true,
            message: 'Conversation deleted successfully'
        });

    } catch (error: any) {
        const duration = Date.now() - startTime;
        
        loggingService.error('Conversation deletion failed', {
            userId,
            conversationId,
            error: error.message || 'Unknown error',
            stack: error.stack,
            duration,
            requestId: req.headers['x-request-id'] as string
        });

        res.status(500).json({
            success: false,
            message: 'Failed to delete conversation',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Rename a conversation
 */
export const renameConversation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const userId = req.userId;
    const { id } = req.params;
    const { title } = req.body;

    try {
        loggingService.info('Conversation rename request initiated', {
            userId,
            conversationId: id,
            newTitle: title,
            requestId: req.headers['x-request-id'] as string
        });

        if (!userId) {
            loggingService.warn('Conversation rename request failed - no user authentication', {
                requestId: req.headers['x-request-id'] as string
            });

            res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
            return;
        }

        if (!title || title.trim().length === 0) {
            loggingService.warn('Conversation rename request failed - invalid title', {
                userId,
                conversationId: id,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(400).json({
                success: false,
                message: 'Title is required and cannot be empty'
            });
            return;
        }

        const updatedConversation = await ChatService.renameConversation(userId, id, title);

        const duration = Date.now() - startTime;

        loggingService.info('Conversation renamed successfully', {
            userId,
            conversationId: id,
            newTitle: title,
            duration,
            requestId: req.headers['x-request-id'] as string
        });

        loggingService.logBusiness({
            event: 'conversation_renamed',
            category: 'chat_management',
            value: duration,
            metadata: {
                userId,
                conversationId: id
            }
        });

        res.json({
            success: true,
            data: updatedConversation
        });

    } catch (error: any) {
        const duration = Date.now() - startTime;
        
        loggingService.error('Conversation rename failed', {
            userId,
            conversationId: id,
            error: error.message || 'Unknown error',
            stack: error.stack,
            duration,
            requestId: req.headers['x-request-id'] as string
        });

        res.status(500).json({
            success: false,
            message: 'Failed to rename conversation',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Archive or unarchive a conversation
 */
export const archiveConversation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const userId = req.userId;
    const { id } = req.params;
    const { archived } = req.body;

    try {
        loggingService.info('Conversation archive request initiated', {
            userId,
            conversationId: id,
            archived,
            requestId: req.headers['x-request-id'] as string
        });

        if (!userId) {
            loggingService.warn('Conversation archive request failed - no user authentication', {
                requestId: req.headers['x-request-id'] as string
            });

            res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
            return;
        }

        if (typeof archived !== 'boolean') {
            loggingService.warn('Conversation archive request failed - invalid archived value', {
                userId,
                conversationId: id,
                archived,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(400).json({
                success: false,
                message: 'archived must be a boolean value'
            });
            return;
        }

        const updatedConversation = await ChatService.archiveConversation(userId, id, archived);

        const duration = Date.now() - startTime;

        loggingService.info('Conversation archive status updated successfully', {
            userId,
            conversationId: id,
            archived,
            duration,
            requestId: req.headers['x-request-id'] as string
        });

        loggingService.logBusiness({
            event: archived ? 'conversation_archived' : 'conversation_unarchived',
            category: 'chat_management',
            value: duration,
            metadata: {
                userId,
                conversationId: id
            }
        });

        res.json({
            success: true,
            data: updatedConversation
        });

    } catch (error: any) {
        const duration = Date.now() - startTime;
        
        loggingService.error('Conversation archive failed', {
            userId,
            conversationId: id,
            archived,
            error: error.message || 'Unknown error',
            stack: error.stack,
            duration,
            requestId: req.headers['x-request-id'] as string
        });

        res.status(500).json({
            success: false,
            message: 'Failed to update conversation archive status',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Pin or unpin a conversation
 */
export const pinConversation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const userId = req.userId;
    const { id } = req.params;
    const { pinned } = req.body;

    try {
        loggingService.info('Conversation pin request initiated', {
            userId,
            conversationId: id,
            pinned,
            requestId: req.headers['x-request-id'] as string
        });

        if (!userId) {
            loggingService.warn('Conversation pin request failed - no user authentication', {
                requestId: req.headers['x-request-id'] as string
            });

            res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
            return;
        }

        if (typeof pinned !== 'boolean') {
            loggingService.warn('Conversation pin request failed - invalid pinned value', {
                userId,
                conversationId: id,
                pinned,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(400).json({
                success: false,
                message: 'pinned must be a boolean value'
            });
            return;
        }

        const updatedConversation = await ChatService.pinConversation(userId, id, pinned);

        const duration = Date.now() - startTime;

        loggingService.info('Conversation pin status updated successfully', {
            userId,
            conversationId: id,
            pinned,
            duration,
            requestId: req.headers['x-request-id'] as string
        });

        loggingService.logBusiness({
            event: pinned ? 'conversation_pinned' : 'conversation_unpinned',
            category: 'chat_management',
            value: duration,
            metadata: {
                userId,
                conversationId: id
            }
        });

        res.json({
            success: true,
            data: updatedConversation
        });

    } catch (error: any) {
        const duration = Date.now() - startTime;
        
        loggingService.error('Conversation pin failed', {
            userId,
            conversationId: id,
            pinned,
            error: error.message || 'Unknown error',
            stack: error.stack,
            duration,
            requestId: req.headers['x-request-id'] as string
        });

        res.status(500).json({
            success: false,
            message: 'Failed to update conversation pin status',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get available models for chat
 */
export const getAvailableModels = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();

    try {
        loggingService.info('Available models request initiated', {
            requestId: _req.headers['x-request-id'] as string
        });

        const models = await ChatService.getAvailableModels();

        const duration = Date.now() - startTime;

        loggingService.info('Available models retrieved successfully', {
            duration,
            modelsCount: models.length,
            requestId: _req.headers['x-request-id'] as string
        });

        // Log business event
        loggingService.logBusiness({
            event: 'available_models_retrieved',
            category: 'chat_management',
            value: duration,
            metadata: {
                modelsCount: models.length
            }
        });

        res.json({
            success: true,
            data: models
        });

    } catch (error: any) {
        const duration = Date.now() - startTime;
        
        loggingService.error('Available models retrieval failed', {
            error: error.message || 'Unknown error',
            stack: error.stack,
            duration,
            requestId: _req.headers['x-request-id'] as string
        });

        res.status(500).json({
            success: false,
            message: 'Failed to get available models',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}; 