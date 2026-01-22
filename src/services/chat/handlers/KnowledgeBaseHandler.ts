/**
 * Knowledge Base Handler
 * Handles RAG (Retrieval-Augmented Generation) queries using the Modular RAG Orchestrator
 */

import { HandlerRequest, HandlerResult } from './types/handler.types';
import { ConversationContext } from '../context';
import { loggingService } from '@services/logging.service';
import { BedrockService } from '@services/tracedBedrock.service';

export class KnowledgeBaseHandler {
    /**
     * Handle knowledge base route with RAG
     */
    static async handle(
        request: HandlerRequest,
        context: ConversationContext,
        contextPreamble: string,
        recentMessages: any[]
    ): Promise<HandlerResult> {
        
        loggingService.info('📚 Routing to knowledge base with Modular RAG', {
            subject: context.currentSubject,
            domain: context.lastDomain,
            userId: request.userId,
            conversationId: request.conversationId,
            modelId: request.modelId,
            temperature: request.temperature,
            maxTokens: request.maxTokens,
            chatMode: request.chatMode,
            useMultiAgent: request.useMultiAgent,
            useWebSearch: request.useWebSearch,
            documentIds: request.documentIds,
            templateId: request.templateId,
            hasAttachments: request.attachments?.length ?? 0,
            hasGithubContext: !!request.githubContext,
            hasVercelContext: !!request.vercelContext,
            hasMongodbContext: !!request.mongodbContext,
            hasSelectionResponse: !!request.selectionResponse
        });
        
        try {
            // Check if message contains a link - if so, skip Google Drive files to avoid confusion
            const urlPattern = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;
            const messageContainsLink = request.message && urlPattern.test(request.message);
            
            // Check for accessible Google Drive files (only if no link is present)
            let googleDriveContext = '';
            let accessibleFiles: any[] = [];
            
            if (!messageContainsLink) {
                const driveResult = await this.loadGoogleDriveContext(request.userId);
                googleDriveContext = driveResult.context;
                accessibleFiles = driveResult.files;
            } else {
                loggingService.debug('Skipping Google Drive files - message contains link', {
                    userId: request.userId,
                    messagePreview: request.message?.substring(0, 100)
                });
            }

            // Use new Modular RAG Orchestrator
            const { modularRAGOrchestrator } = await import('../../../rag');
            
            // Build RAG context with all available context
            const ragContext: any = {
                userId: request.userId,
                conversationId: context.conversationId,
                recentMessages: recentMessages.slice(-3).map(msg => ({
                    role: msg.role,
                    content: msg.content
                })),
                currentTopic: context.currentSubject,
                googleDriveFiles: accessibleFiles,
                additionalContext: googleDriveContext,
                contextPreamble,
                originalMessage: request.originalMessage,
                modelId: request.modelId,
                temperature: request.temperature,
                maxTokens: request.maxTokens,
                chatMode: request.chatMode,
                useMultiAgent: request.useMultiAgent,
                useWebSearch: request.useWebSearch,
                githubContext: request.githubContext,
                vercelContext: request.vercelContext,
                mongodbContext: request.mongodbContext,
                templateId: request.templateId,
                templateVariables: request.templateVariables,
                attachments: request.attachments,
                selectionResponse: request.selectionResponse
            };

            // Configure RAG based on query characteristics and request parameters
            const config: any = {
                temperature: request.temperature,
                maxTokens: request.maxTokens,
                chatMode: request.chatMode,
                useMultiAgent: request.useMultiAgent,
                useWebSearch: request.useWebSearch
            };
            
            if (request.documentIds && request.documentIds.length > 0) {
                config.modules = {
                    retrieve: {
                        limit: 10,
                        filters: {
                            documentIds: request.documentIds,
                        },
                    },
                };
            }

            // Handle template-based queries
            if (request.templateId && request.templateVariables) {
                config.template = {
                    id: request.templateId,
                    variables: request.templateVariables
                };
            }

            // Handle attachment processing
            if (request.attachments && request.attachments.length > 0) {
                config.attachments = request.attachments;
            }

            // Execute modular RAG
            const ragResult = await modularRAGOrchestrator.execute({
                query: request.message ?? '',
                context: ragContext,
                config,
            });

            loggingService.info('📚 Modular RAG completed', {
                success: ragResult.success,
                pattern: ragResult.metadata.pattern,
                documentsFound: ragResult.documents.length,
                sources: ragResult.sources,
                userId: request.userId,
                hasGoogleDriveFiles: accessibleFiles.length > 0,
                usedTemplate: !!request.templateId,
                processedAttachments: request.attachments?.length ?? 0,
                integrationContexts: {
                    github: !!request.githubContext,
                    vercel: !!request.vercelContext,
                    mongodb: !!request.mongodbContext
                }
            });

            if (ragResult.success && ragResult.answer) {
                // Enhance response with Google Drive context if available but no knowledge base results
                let enhancedResponse = ragResult.answer;
                if (ragResult.documents.length === 0 && googleDriveContext) {
                    enhancedResponse = await this.enhanceWithGoogleDrive(
                        googleDriveContext,
                        request.message ?? '',
                        request.modelId
                    );
                }

                const optimizations = [
                    'modular_rag',
                    `pattern_${ragResult.metadata.pattern}`,
                    ...ragResult.metadata.modulesUsed.map((m: string) => `module_${m}`),
                    `retrieved_${ragResult.documents.length}_docs`,
                ];

                if (accessibleFiles.length > 0) {
                    optimizations.push(`google_drive_files_${accessibleFiles.length}`);
                }

                if (request.templateId) {
                    optimizations.push(`template_${request.templateId}`);
                }

                if (request.attachments && request.attachments.length > 0) {
                    optimizations.push(`attachments_${request.attachments.length}`);
                }

                if (request.chatMode) {
                    optimizations.push(`chat_mode_${request.chatMode}`);
                }

                // Include integration data in response
                const result: HandlerResult = {
                    response: enhancedResponse,
                    agentPath: ['knowledge_base', 'modular_rag', ragResult.metadata.pattern],
                    optimizationsApplied: optimizations,
                    cacheHit: ragResult.metadata.cacheHit || false,
                    riskLevel: 'low',
                    webSearchUsed: request.useWebSearch,
                    metadata: {
                        ragPattern: ragResult.metadata.pattern,
                        documentsRetrieved: ragResult.documents.length,
                        sources: ragResult.sources,
                        templateUsed: request.templateId,
                        attachmentsProcessed: request.attachments?.length ?? 0
                    }
                };

                // Add integration-specific data if contexts are present
                if (request.githubContext) {
                    result.githubIntegrationData = request.githubContext;
                }
                if (request.vercelContext) {
                    result.vercelIntegrationData = request.vercelContext;
                }
                if (request.mongodbContext) {
                    result.mongodbIntegrationData = request.mongodbContext;
                }

                return result;
            }
            
            // Fallback if RAG fails
            return {
                response: 'I don\'t have enough information to answer that question. Please try rephrasing or provide more context.',
                agentPath: ['knowledge_base', 'fallback'],
                optimizationsApplied: ['rag_fallback'],
                cacheHit: false,
                riskLevel: 'low',
                webSearchUsed: request.useWebSearch,
                metadata: {
                    fallbackReason: 'rag_no_results',
                    templateUsed: request.templateId,
                    attachmentsProcessed: request.attachments?.length ?? 0
                }
            };
            
        } catch (error) {
            loggingService.error('Knowledge base route failed', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                userId: request.userId,
                conversationId: request.conversationId,
                modelId: request.modelId,
                templateId: request.templateId,
                hasAttachments: request.attachments?.length ?? 0
            });
            
            // Return fallback response
            return {
                response: 'I encountered an error while searching the knowledge base. Please try again.',
                agentPath: ['knowledge_base', 'error'],
                optimizationsApplied: [],
                cacheHit: false,
                riskLevel: 'medium',
                webSearchUsed: request.useWebSearch,
                metadata: {
                    errorType: 'knowledge_base_error',
                    templateUsed: request.templateId,
                    attachmentsProcessed: request.attachments?.length ?? 0
                }
            };
        }
    }

    /**
     * Load Google Drive context for knowledge base queries
     */
    private static async loadGoogleDriveContext(userId: string): Promise<{
        context: string;
        files: any[];
    }> {
        try {
            const { GoogleService } = await import('../../google.service');
            const { GoogleConnection } = await import('../../../models/GoogleConnection');
            
            // Get user's Google connections
            const connections = await GoogleConnection.find({ 
                userId: userId, 
                isActive: true,
                healthStatus: 'healthy'
            }).select('+accessToken +refreshToken');
            
            if (connections.length === 0) {
                return { context: '', files: [] };
            }

            // Get accessible files from the first active connection
            const connection = connections[0];
            
            // Validate that connection has required token
            if (!connection.accessToken) {
                loggingService.warn('Google connection missing access token', {
                    connectionId: connection._id.toString(),
                    userId
                });
                return { context: '', files: [] };
            }

            // Get all accessible files
            const accessibleFiles = await GoogleService.getAccessibleFiles(
                userId,
                connection._id.toString()
            );
            
            if (accessibleFiles.length === 0) {
                return { context: '', files: [] };
            }

            // Try to read content from the most recently accessed file
            const recentFiles = accessibleFiles.slice(0, 1);
            const fileContents: string[] = [];
            
            for (const file of recentFiles) {
                try {
                    let content = '';
                    if (file.mimeType === 'application/vnd.google-apps.document') {
                        content = await GoogleService.readDocument(connection, file.id);
                    } else if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
                        const sheetData = await GoogleService.readSpreadsheet(connection, file.id, 'Sheet1!A1:Z100');
                        if (Array.isArray(sheetData)) {
                            content = sheetData.map((row: any[]) => Array.isArray(row) ? row.join('\t') : '').join('\n') || '';
                        }
                    }
                    
                    if (content && content.length > 50) {
                        fileContents.push(`File: ${file.name}\nContent: ${content.substring(0, 2000)}...`);
                        loggingService.info('Added Google Drive file content to context', {
                            fileName: file.name,
                            fileId: file.id,
                            contentLength: content.length
                        });
                    }
                } catch (error) {
                    loggingService.warn('Failed to read Google Drive file content', {
                        fileName: file.name,
                        fileId: file.id,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
            
            const context = fileContents.length > 0 
                ? `\n\nSelected Google Drive file:\n${fileContents.join('\n\n')}`
                : '';

            return { context, files: accessibleFiles };
            
        } catch (error) {
            loggingService.warn('Failed to load Google Drive context', {
                error: error instanceof Error ? error.message : String(error)
            });
            return { context: '', files: [] };
        }
    }

    /**
     * Enhance response with Google Drive context
     */
    private static async enhanceWithGoogleDrive(
        googleDriveContext: string,
        userMessage: string,
        modelId: string
    ): Promise<string> {
        const contextualPrompt = `Based on the following Google Drive files and the user's question, provide a helpful response:

${googleDriveContext}

User question: ${userMessage}

Please analyze the content from the Google Drive files above and provide a relevant answer to the user's question. If the files contain relevant information, use that in your response. If not, let the user know what the files contain instead.`;

        try {
            const response = await BedrockService.invokeModel(
                contextualPrompt,
                modelId || 'anthropic.claude-3-5-sonnet-20240620-v1:0',
                {
                    useSystemPrompt: false
                }
            );
            
            return typeof response === 'string' ? response : 'Unable to process Google Drive content.';
        } catch (error) {
            loggingService.warn('Failed to generate contextual response with Google Drive files', {
                error: error instanceof Error ? error.message : String(error)
            });
            return 'Unable to process Google Drive content at this time.';
        }
    }
}
