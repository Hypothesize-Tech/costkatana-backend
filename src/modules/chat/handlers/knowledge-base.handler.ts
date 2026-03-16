/**
 * Knowledge Base Handler for NestJS
 * Handles RAG (Retrieval-Augmented Generation) queries using the Modular RAG Orchestrator
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  HandlerRequest,
  HandlerResult,
  ProcessingContext,
} from './types/handler.types';
import { RagServiceLocator } from '../../rag/rag-service-locator';
import { BedrockService } from '../../../services/bedrock.service';
import { GoogleService } from '../../google/google.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ContextAssemblerService } from '../services/context-assembler.service';
import { ContextAssemblyService } from '../services/context-assembly.service';

@Injectable()
export class KnowledgeBaseHandler {
  private readonly logger = new Logger(KnowledgeBaseHandler.name);

  constructor(
    private readonly ragServiceLocator: RagServiceLocator,
    private readonly bedrockService: BedrockService,
    private readonly googleService: GoogleService,
    @InjectModel('GoogleConnection') private googleConnectionModel: Model<any>,
    private readonly contextAssemblerService: ContextAssemblerService,
    private readonly contextAssemblyService: ContextAssemblyService,
  ) {}

  /**
   * Handle knowledge base route with RAG
   */
  async handle(
    request: HandlerRequest,
    context: ProcessingContext,
    contextPreamble?: string,
  ): Promise<HandlerResult> {
    this.logger.log('📚 Routing to knowledge base with Modular RAG', {
      subject: (context.conversation as { currentSubject?: string } | undefined)
        ?.currentSubject,
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
      hasSelectionResponse: !!request.selectionResponse,
    });

    try {
      // Check if message contains a link - if so, skip Google Drive files to avoid confusion
      const urlPattern = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;
      const messageContainsLink =
        request.message && urlPattern.test(request.message);

      // Check for accessible Google Drive files (only if no link is present)
      let googleDriveContext = '';
      let accessibleFiles: Array<{
        id: string;
        name: string;
        mimeType?: string;
      }> = [];

      if (!messageContainsLink) {
        const driveResult = await this.loadGoogleDriveContext(request.userId);
        googleDriveContext = driveResult.context;
        accessibleFiles = driveResult.files;
      } else {
        this.logger.debug(
          'Skipping Google Drive files - message contains link',
          {
            userId: request.userId,
            messagePreview: request.message?.substring(0, 100),
          },
        );
      }

      // Use Modular RAG Orchestrator
      const modularRAGOrchestrator =
        RagServiceLocator.getModularRAGOrchestrator();

      // Build RAG context with all available context
      const ragContext: any = {
        userId: request.userId,
        conversationId:
          (
            context.conversation as { _id?: { toString(): string } } | undefined
          )?._id?.toString() || request.conversationId,
        recentMessages: context.recentMessages.slice(-3).map((msg) => ({
          role: msg.role,
          content: msg.content || msg.message || '',
        })),
        currentTopic: (
          context.conversation as { currentSubject?: string } | undefined
        )?.currentSubject,
        googleDriveFiles: accessibleFiles,
        additionalContext: googleDriveContext,
        contextPreamble: contextPreamble || '',
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
        selectionResponse: request.selectionResponse,
      };

      // Configure RAG based on query characteristics and request parameters
      const config: any = {
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        chatMode: request.chatMode,
        useMultiAgent: request.useMultiAgent,
        useWebSearch: request.useWebSearch,
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
          variables: request.templateVariables,
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

      this.logger.log('📚 Modular RAG completed', {
        success: ragResult.success,
        pattern: ragResult.metadata?.pattern,
        documentsFound: ragResult.documents?.length || 0,
        sources: ragResult.sources,
        userId: request.userId,
        hasGoogleDriveFiles: accessibleFiles.length > 0,
        usedTemplate: !!request.templateId,
        processedAttachments: request.attachments?.length ?? 0,
        integrationContexts: {
          github: !!request.githubContext,
          vercel: !!request.vercelContext,
          mongodb: !!request.mongodbContext,
        },
      });

      if (ragResult.success && ragResult.answer) {
        // Enhance response with Google Drive context if available but no knowledge base results
        let enhancedResponse = ragResult.answer;
        if (
          (ragResult.documents?.length === 0 || !ragResult.documents) &&
          googleDriveContext
        ) {
          enhancedResponse = await this.enhanceWithGoogleDrive(
            googleDriveContext,
            request.message ?? '',
            request.modelId,
          );
        }

        const optimizations = [
          'modular_rag',
          `pattern_${ragResult.metadata?.pattern || 'unknown'}`,
          ...(ragResult.metadata?.modulesUsed?.map(
            (m: string) => `module_${m}`,
          ) || []),
          `retrieved_${ragResult.documents?.length || 0}_docs`,
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
          agentPath: [
            'knowledge_base',
            'modular_rag',
            ragResult.metadata?.pattern || 'unknown',
          ],
          optimizationsApplied: optimizations,
          cacheHit: ragResult.metadata?.cacheHit || false,
          riskLevel: 'low',
          webSearchUsed: request.useWebSearch,
          metadata: {
            ragPattern: ragResult.metadata?.pattern,
            documentsRetrieved: ragResult.documents?.length || 0,
            sources: ragResult.sources,
            templateUsed: request.templateId,
            attachmentsProcessed: request.attachments?.length ?? 0,
          },
          success: true,
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
        response:
          "I don't have enough information to answer that question. Please try rephrasing or provide more context.",
        agentPath: ['knowledge_base', 'fallback'],
        optimizationsApplied: ['rag_fallback'],
        cacheHit: false,
        riskLevel: 'low',
        webSearchUsed: request.useWebSearch,
        metadata: {
          fallbackReason: 'rag_no_results',
          templateUsed: request.templateId,
          attachmentsProcessed: request.attachments?.length ?? 0,
        },
        success: false,
      };
    } catch (error) {
      this.logger.error('Knowledge base route failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        userId: request.userId,
        conversationId: request.conversationId,
        modelId: request.modelId,
        templateId: request.templateId,
        hasAttachments: request.attachments?.length ?? 0,
      });

      // Return fallback response
      return {
        response:
          'I encountered an error while searching the knowledge base. Please try again.',
        agentPath: ['knowledge_base', 'error'],
        optimizationsApplied: [],
        cacheHit: false,
        riskLevel: 'medium',
        webSearchUsed: request.useWebSearch,
        metadata: {
          errorType: 'knowledge_base_error',
          templateUsed: request.templateId,
          attachmentsProcessed: request.attachments?.length ?? 0,
        },
        success: false,
      };
    }
  }

  /**
   * Load Google Drive context for knowledge base queries
   */
  private async loadGoogleDriveContext(userId: string): Promise<{
    context: string;
    files: Array<{ id: string; name: string; mimeType?: string }>;
  }> {
    try {
      // Get user's Google connections
      const connections = await this.googleConnectionModel
        .find({
          userId: userId,
          isActive: true,
          healthStatus: 'healthy',
        })
        .select('+accessToken +refreshToken');

      if (connections.length === 0) {
        return { context: '', files: [] };
      }

      // Get accessible files from the first active connection
      const connection = connections[0];

      // Validate that connection has required token
      if (!connection.accessToken) {
        this.logger.warn('Google connection missing access token', {
          connectionId: connection._id.toString(),
          userId,
        });
        return { context: '', files: [] };
      }

      // Get all accessible files
      const accessibleFiles = (await this.googleService.getAccessibleFiles(
        userId,
        connection._id.toString(),
      )) as Array<{ id: string; name: string; mimeType?: string }>;

      if (accessibleFiles.length === 0) {
        return { context: '', files: [] };
      }

      // Try to read content from the most recently accessed file
      const recentFiles = accessibleFiles.slice(0, 1);
      const fileContents: string[] = [];
      type DriveFile = { id: string; name: string; mimeType?: string };

      for (const file of recentFiles as DriveFile[]) {
        try {
          let content = '';
          if (file.mimeType === 'application/vnd.google-apps.document') {
            const docResult = await this.googleService.getDocumentContent(
              connection._id.toString(),
              file.id,
            );
            content = docResult?.content ?? '';
          } else if (
            file.mimeType === 'application/vnd.google-apps.spreadsheet'
          ) {
            const sheetData = await this.googleService.getSpreadsheetContent(
              connection._id.toString(),
              file.id,
              'Sheet1!A1:Z100',
            );
            if (Array.isArray(sheetData)) {
              content =
                sheetData
                  .map((row: string[]) =>
                    Array.isArray(row) ? row.join('\t') : '',
                  )
                  .join('\n') || '';
            }
          }

          if (content && content.length > 50) {
            fileContents.push(
              `File: ${file.name}\nContent: ${content.substring(0, 2000)}...`,
            );
            this.logger.log('Added Google Drive file content to context', {
              fileName: file.name,
              fileId: file.id,
              contentLength: content.length,
            });
          }
        } catch (error) {
          this.logger.warn('Failed to read Google Drive file content', {
            fileName: file.name,
            fileId: file.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const context =
        fileContents.length > 0
          ? `\n\nSelected Google Drive file:\n${fileContents.join('\n\n')}`
          : '';

      return { context, files: accessibleFiles };
    } catch (error) {
      this.logger.warn('Failed to load Google Drive context', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { context: '', files: [] };
    }
  }

  /**
   * Enhance response with Google Drive context
   */
  private async enhanceWithGoogleDrive(
    googleDriveContext: string,
    userMessage: string,
    modelId: string,
  ): Promise<string> {
    const contextualPrompt = `Based on the following Google Drive files and the user's question, provide a helpful response:

${googleDriveContext}

User question: ${userMessage}

Please analyze the content from the Google Drive files above and provide a relevant answer to the user's question. If the files contain relevant information, use that in your response. If not, let the user know what the files contain instead.`;

    try {
      const response = await this.bedrockService.invokeModelDirectly(
        modelId || 'anthropic.claude-sonnet-4-5-20250929-v1:0',
        {
          prompt: contextualPrompt,
          max_tokens: 2000,
          temperature: 0.3,
          useSystemPrompt: false,
        },
      );

      return response.response || 'Unable to process Google Drive content.';
    } catch (error) {
      this.logger.warn(
        'Failed to generate contextual response with Google Drive files',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return 'Unable to process Google Drive content at this time.';
    }
  }
}
