/**
 * Cortex Long Handshake Service
 *
 * This service implements token-level streaming orchestration with chunked responses:
 * - Breaks huge outputs into manageable sections (like Cursor does with functions/files)
 * - Multi-turn handshake for big jobs: chunk → confirm → continue → stitch seamlessly
 * - Token-level streaming orchestration (not full-response blocking)
 * - Progressive output generation and validation
 * - Interactive chunk confirmation and continuation
 * - Seamless stitching of multi-part responses
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { redisService } from './redis.service';
import { loggingService } from './logging.service';

// Import types
import { CortexStreamingExecution, CortexToken } from './cortexStreamingOrchestrator.service';
import { CortexFrame } from '../types/cortex.types';

export enum HandshakePhase {
    INITIALIZING = 'initializing',
    CHUNK_GENERATION = 'chunk_generation',
    CHUNK_VALIDATION = 'chunk_validation',
    USER_CONFIRMATION = 'user_confirmation',
    CONTINUATION = 'continuation',
    STITCHING = 'stitching',
    COMPLETED = 'completed',
    FAILED = 'failed'
}

export enum ChunkType {
    CODE_BLOCK = 'code_block',
    JSON_OBJECT = 'json_object',
    MARKDOWN_SECTION = 'markdown_section',
    TEXT_PARAGRAPH = 'text_paragraph',
    LIST_ITEM = 'list_item',
    TABLE_ROW = 'table_row',
    FUNCTION_DEFINITION = 'function_definition',
    CLASS_DEFINITION = 'class_definition',
    FILE_CONTENT = 'file_content',
    API_RESPONSE = 'api_response'
}

export interface ChunkMetadata {
    chunkId: string;
    chunkType: ChunkType;
    sequenceNumber: number;
    totalSequences: number;
    parentChunkId?: string;
    childChunkIds: string[];
    isComplete: boolean;
    requiresConfirmation: boolean;
    canContinue: boolean;
    contentHash: string;
    dependencies: string[];
    estimatedTokens: number;
    actualTokens: number;
    confidence: number;
    validationScore: number;
}

export interface ChunkContent {
    id: string;
    type: ChunkType;
    content: string;
    metadata: ChunkMetadata;
    tokens: CortexToken[];
    validationErrors: string[];
    continuationPrompt?: string;
    nextChunkHint?: string;
}

export interface HandshakeState {
    executionId: string;
    currentPhase: HandshakePhase;
    activeChunks: Map<string, ChunkContent>;
    completedChunks: ChunkContent[];
    pendingChunks: ChunkContent[];
    currentChunk: ChunkContent | null;
    totalTokens: number;
    totalCost: number;
    userInteractions: UserInteraction[];
    stitchingInstructions: StitchingInstruction[];
    progress: number; // 0-100
    phase: HandshakePhase; // Add phase property
    estimatedChunks: number; // Add estimatedChunks property
}

export interface UserInteraction {
    id: string;
    timestamp: Date;
    interactionType: 'confirmation' | 'modification' | 'cancellation' | 'skip' | 'retry';
    chunkId: string;
    userInput?: string;
    systemResponse?: string;
    metadata?: any;
}

export interface StitchingInstruction {
    sourceChunkId: string;
    targetChunkId: string;
    stitchingMethod: 'concatenate' | 'merge' | 'overwrite' | 'insert' | 'replace';
    position: number;
    content: string;
    conditions?: string[];
}

export interface ChunkingStrategy {
    maxChunkSize: number; // tokens
    preferredChunkTypes: ChunkType[];
    enableValidation: boolean;
    enableUserConfirmation: boolean;
    autoContinue: boolean;
    stitchingEnabled: boolean;
    preserveFormatting: boolean;
}

export const DEFAULT_CHUNKING_STRATEGY: ChunkingStrategy = {
    maxChunkSize: 1000,
    preferredChunkTypes: [ChunkType.CODE_BLOCK, ChunkType.FUNCTION_DEFINITION, ChunkType.JSON_OBJECT],
    enableValidation: true,
    enableUserConfirmation: false, // Auto-continue by default
    autoContinue: true,
    stitchingEnabled: true,
    preserveFormatting: true
};

export class CortexLongHandshakeService extends EventEmitter {
    private static instance: CortexLongHandshakeService;

    private handshakeStates = new Map<string, HandshakeState>();
    private chunkStrategies = new Map<string, ChunkingStrategy>();
    private activeChunking = new Map<string, { chunks: ChunkContent[]; currentIndex: number }>();

    private constructor() {
        super();
        this.initializeDefaultStrategies();
    }

    public static getInstance(): CortexLongHandshakeService {
        if (!CortexLongHandshakeService.instance) {
            CortexLongHandshakeService.instance = new CortexLongHandshakeService();
        }
        return CortexLongHandshakeService.instance;
    }

    // ========================================================================
    // CHUNK GENERATION AND MANAGEMENT
    // ========================================================================

    /**
     * Initialize handshake for an execution
     */
    public async initializeHandshake(
        executionId: string,
        chunkingStrategy?: Partial<ChunkingStrategy>
    ): Promise<HandshakeState> {
        try {
            loggingService.info('🤝 Initializing long handshake', {
                executionId
            });

            // Create handshake state
            const strategy = { ...DEFAULT_CHUNKING_STRATEGY, ...chunkingStrategy };
            this.chunkStrategies.set(executionId, strategy);

            const handshakeState: HandshakeState = {
                executionId,
                currentPhase: HandshakePhase.INITIALIZING,
                activeChunks: new Map(),
                completedChunks: [],
                pendingChunks: [],
                currentChunk: null,
                totalTokens: 0,
                totalCost: 0,
                userInteractions: [],
                stitchingInstructions: [],
                progress: 0,
                phase: HandshakePhase.INITIALIZING,
                estimatedChunks: 0
            };

            this.handshakeStates.set(executionId, handshakeState);

            // Store in Redis for persistence
            await this.storeHandshakeState(handshakeState);

            loggingService.info('✅ Long handshake initialized', {
                executionId,
                strategy: strategy
            });

            return handshakeState;

        } catch (error) {
            loggingService.error('❌ Failed to initialize long handshake', {
                executionId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Generate next chunk in the handshake sequence
     */
    public async generateNextChunk(
        executionId: string,
        content: string,
        chunkType?: ChunkType,
        metadata?: Partial<ChunkMetadata>
    ): Promise<ChunkContent> {
        try {
            const handshakeState = this.handshakeStates.get(executionId);
            if (!handshakeState) {
                throw new Error(`No handshake state found for execution ${executionId}`);
            }

            const strategy = this.chunkStrategies.get(executionId)!;

            loggingService.info('📦 Generating next chunk', {
                executionId,
                contentLength: content.length,
                chunkType: chunkType || 'auto-detect'
            });

            // Determine chunk type if not provided
            const detectedChunkType = chunkType || this.detectChunkType(content);

            // Create chunk metadata
            const chunkMetadata: ChunkMetadata = {
                chunkId: uuidv4(),
                chunkType: detectedChunkType,
                sequenceNumber: handshakeState.completedChunks.length + handshakeState.pendingChunks.length + 1,
                totalSequences: 0, // Will be updated later
                childChunkIds: [],
                isComplete: false,
                requiresConfirmation: strategy.enableUserConfirmation,
                canContinue: true,
                contentHash: this.generateContentHash(content),
                dependencies: [],
                estimatedTokens: content.length / 4, // Rough estimate
                actualTokens: 0, // Will be updated when tokens are counted
                confidence: 0.9,
                validationScore: 0,
                ...metadata
            };

            // Create chunk content
            const chunk: ChunkContent = {
                id: chunkMetadata.chunkId,
                type: detectedChunkType,
                content,
                metadata: chunkMetadata,
                tokens: [],
                validationErrors: [],
                continuationPrompt: this.generateContinuationPrompt(handshakeState, detectedChunkType),
                nextChunkHint: this.generateNextChunkHint(handshakeState, detectedChunkType)
            };

            // Validate chunk if enabled
            if (strategy.enableValidation) {
                await this.validateChunk(chunk);
            }

            // Add to pending chunks
            handshakeState.pendingChunks.push(chunk);
            handshakeState.currentChunk = chunk;

            // Update handshake state
            handshakeState.currentPhase = HandshakePhase.CHUNK_GENERATION;

            // Store updated state
            await this.storeHandshakeState(handshakeState);

            loggingService.info('✅ Chunk generated', {
                executionId,
                chunkId: chunk.id,
                chunkType: detectedChunkType,
                sequenceNumber: chunkMetadata.sequenceNumber,
                requiresConfirmation: chunkMetadata.requiresConfirmation
            });

            this.emit('chunkGenerated', {
                executionId,
                chunk,
                handshakeState
            });

            return chunk;

        } catch (error) {
            loggingService.error('❌ Failed to generate chunk', {
                executionId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Detect the type of content chunk
     */
    private detectChunkType(content: string): ChunkType {
        // Code detection
        if (content.includes('function') || content.includes('class') ||
            content.includes('=>') || content.includes('const ') ||
            content.match(/^\s*(import|export|function|class|interface|type)\s/)) {
            return ChunkType.CODE_BLOCK;
        }

        // JSON detection
        if ((content.startsWith('{') && content.includes(':')) ||
            (content.startsWith('[') && content.includes(','))) {
            return ChunkType.JSON_OBJECT;
        }

        // Markdown detection
        if (content.includes('#') || content.includes('**') ||
            content.includes('*') || content.includes('```')) {
            return ChunkType.MARKDOWN_SECTION;
        }

        // List detection
        if (content.includes('- ') || content.includes('* ') ||
            content.match(/^\s*\d+\.\s/)) {
            return ChunkType.LIST_ITEM;
        }

        // Function definition
        if (content.match(/^\s*function\s+\w+\s*\(/) ||
            content.match(/^\s*const\s+\w+\s*=\s*\(/) ||
            content.match(/^\s*\w+\s*\([^)]*\)\s*\{/)) {
            return ChunkType.FUNCTION_DEFINITION;
        }

        // Class definition
        if (content.match(/^\s*class\s+\w+/)) {
            return ChunkType.CLASS_DEFINITION;
        }

        // File content (has file extension patterns)
        if (content.includes('.ts') || content.includes('.js') ||
            content.includes('.py') || content.includes('.md') ||
            content.includes('File:') || content.includes('Path:')) {
            return ChunkType.FILE_CONTENT;
        }

        // Default to text paragraph
        return ChunkType.TEXT_PARAGRAPH;
    }

    /**
     * Validate chunk content and structure
     */
    private async validateChunk(chunk: ChunkContent): Promise<void> {
        const errors: string[] = [];

        try {
            // Type-specific validation
            switch (chunk.type) {
                case ChunkType.JSON_OBJECT:
                    if (!this.isValidJSON(chunk.content)) {
                        errors.push('Invalid JSON structure');
                    }
                    break;

                case ChunkType.CODE_BLOCK:
                    if (!this.isValidCodeStructure(chunk.content)) {
                        errors.push('Invalid code structure');
                    }
                    break;

                case ChunkType.FUNCTION_DEFINITION:
                    if (!this.isValidFunctionDefinition(chunk.content)) {
                        errors.push('Invalid function definition');
                    }
                    break;

                case ChunkType.CLASS_DEFINITION:
                    if (!this.isValidClassDefinition(chunk.content)) {
                        errors.push('Invalid class definition');
                    }
                    break;
            }

            // General validation
            if (chunk.content.trim().length === 0) {
                errors.push('Empty content');
            }

            if (chunk.content.length > 10000) {
                errors.push('Content too large');
            }

            // Check for incomplete structures
            if (this.hasIncompleteStructure(chunk.content)) {
                errors.push('Incomplete structure detected');
            }

            chunk.validationErrors = errors;

            // Calculate validation score
            chunk.metadata.validationScore = Math.max(0, 1 - (errors.length * 0.2));

            if (errors.length > 0) {
                loggingService.warn('⚠️ Chunk validation found errors', {
                    chunkId: chunk.id,
                    errors: errors,
                    validationScore: chunk.metadata.validationScore
                });
            }

        } catch (error) {
            chunk.validationErrors.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`);
            chunk.metadata.validationScore = 0;
        }
    }

    // ========================================================================
    // CHUNK VALIDATION HELPERS
    // ========================================================================

    private isValidJSON(content: string): boolean {
        try {
            JSON.parse(content);
            return true;
        } catch {
            return false;
        }
    }

    private isValidCodeStructure(content: string): boolean {
        // Basic syntax checks - in production you'd use a proper parser
        const suspiciousPatterns = [
            /\{[^}]*$/,           // Unclosed brace
            /\([^)]*$/,           // Unclosed parenthesis
            /\[[^\]]*$/,          // Unclosed bracket
            /"[^"]*$/,            // Unclosed quote
            /'[^']*$/,            // Unclosed single quote
            /\/\*[^/*]*$/,        // Unclosed comment
            /\/\/.*$/,            // Line ends with comment (might be incomplete)
        ];

        return !suspiciousPatterns.some(pattern => pattern.test(content));
    }

    private isValidFunctionDefinition(content: string): boolean {
        const functionStartMatch = content.match(/function\s+\w+\s*\(|const\s+\w+\s*=\s*\(|^\s*\w+\s*\([^)]*\)\s*\{/);
        const braceMatch = content.match(/\{/g);
        const closeBraceMatch = content.match(/\}/g);

        if (!functionStartMatch) return false;

        const openBraces = braceMatch ? braceMatch.length : 0;
        const closeBraces = closeBraceMatch ? closeBraceMatch.length : 0;

        // Allow for incomplete functions that will be continued
        return openBraces >= closeBraces;
    }

    private isValidClassDefinition(content: string): boolean {
        const classMatch = content.match(/class\s+\w+/);
        const braceMatch = content.match(/\{/g);
        const closeBraceMatch = content.match(/\}/g);

        if (!classMatch) return false;

        const openBraces = braceMatch ? braceMatch.length : 0;
        const closeBraces = closeBraceMatch ? closeBraceMatch.length : 0;

        return openBraces >= closeBraces;
    }

    private hasIncompleteStructure(content: string): boolean {
        const incompletePatterns = [
            /\w+\s*$/,                    // Ends with word
            /\w+,\s*$/,                   // Ends with comma
            /\w+\s+(and|or|but)\s*$/,     // Ends with conjunction
            /:\s*$/,                      // Ends with colon
            /["']\s*$/,                   // Ends with quote
            /\(\s*$/,                     // Ends with opening paren
            /\[\s*$/,                     // Ends with opening bracket
            /\{\s*$/,                     // Ends with opening brace
            /\.\.\.$/,                    // Ends with ellipsis
        ];

        return incompletePatterns.some(pattern => pattern.test(content.trim()));
    }

    // ========================================================================
    // CONTINUATION AND CONFIRMATION
    // ========================================================================

    /**
     * Generate continuation prompt for next chunk
     */
    private generateContinuationPrompt(
        handshakeState: HandshakeState,
        chunkType: ChunkType
    ): string {
        const basePrompts: { [key in ChunkType]: string } = {
            [ChunkType.CODE_BLOCK]: 'Continue writing the code. Complete any incomplete functions, classes, or blocks.',
            [ChunkType.JSON_OBJECT]: 'Continue the JSON structure. Complete any incomplete objects or arrays.',
            [ChunkType.MARKDOWN_SECTION]: 'Continue the documentation. Complete the current section.',
            [ChunkType.TEXT_PARAGRAPH]: 'Continue the text. Complete the current thought or paragraph.',
            [ChunkType.LIST_ITEM]: 'Continue the list. Complete any incomplete items.',
            [ChunkType.TABLE_ROW]: 'Continue the table. Complete the current row or add the next row.',
            [ChunkType.FUNCTION_DEFINITION]: 'Complete the function definition. Add the function body and any missing parts.',
            [ChunkType.CLASS_DEFINITION]: 'Complete the class definition. Add methods, properties, and complete the class structure.',
            [ChunkType.FILE_CONTENT]: 'Continue the file content. Complete the current file or section.',
            [ChunkType.API_RESPONSE]: 'Continue the API response. Complete any incomplete data structures.'
        };

        const basePrompt = basePrompts[chunkType] || 'Continue where you left off.';

        // Add context from previous chunks
        const recentChunks = handshakeState.completedChunks.slice(-3);
        const context = recentChunks
            .map(chunk => chunk.content.substring(0, 200) + (chunk.content.length > 200 ? '...' : ''))
            .join('\n...\n');

        if (context) {
            return `${basePrompt}

Previous context:
${context}

Continue seamlessly without repeating what was already written.`;
        }

        return basePrompt;
    }

    /**
     * Generate hint for next chunk
     */
    private generateNextChunkHint(
        handshakeState: HandshakeState,
        chunkType: ChunkType
    ): string {
        const hints: { [key in ChunkType]: string } = {
            [ChunkType.CODE_BLOCK]: 'Next: More code implementation',
            [ChunkType.JSON_OBJECT]: 'Next: Additional data structure',
            [ChunkType.MARKDOWN_SECTION]: 'Next: Next documentation section',
            [ChunkType.TEXT_PARAGRAPH]: 'Next: Continue explanation',
            [ChunkType.LIST_ITEM]: 'Next: More list items',
            [ChunkType.TABLE_ROW]: 'Next: Additional table rows',
            [ChunkType.FUNCTION_DEFINITION]: 'Next: More function implementations',
            [ChunkType.CLASS_DEFINITION]: 'Next: Additional class methods',
            [ChunkType.FILE_CONTENT]: 'Next: More file content',
            [ChunkType.API_RESPONSE]: 'Next: Additional API data'
        };

        const baseHint = hints[chunkType] || 'Next: Continue content';

        // Use handshakeState to provide more contextual hints
        const completedCount = handshakeState.completedChunks.length;
        const totalEstimated = handshakeState.estimatedChunks || 0;
        const currentPhase = handshakeState.phase || HandshakePhase.INITIALIZING;

        // Add progress context to the hint
        const progressContext = totalEstimated > 0
            ? ` (${completedCount + 1}/${totalEstimated})`
            : ` (chunk ${completedCount + 1})`;

        // Add phase-specific context
        const phaseContext = currentPhase === HandshakePhase.CONTINUATION
            ? ' - Continuing from previous chunk'
            : currentPhase === HandshakePhase.STITCHING
            ? ' - Preparing for final assembly'
            : '';

        return `${baseHint}${progressContext}${phaseContext}`;
    }

    /**
     * Confirm current chunk and prepare for continuation
     */
    public async confirmChunk(
        executionId: string,
        chunkId: string,
        userApproval?: boolean,
        modifications?: string
    ): Promise<{ success: boolean; nextChunk?: ChunkContent; message: string }> {
        try {
            const handshakeState = this.handshakeStates.get(executionId);
            if (!handshakeState) {
                return { success: false, message: 'No handshake state found' };
            }

            const chunk = handshakeState.currentChunk;
            if (!chunk || !chunk.id || chunk.id !== chunkId) {
                return { success: false, message: 'Chunk not found or not current' };
            }

            loggingService.info('✅ Chunk confirmed', {
                executionId,
                chunkId: chunk.id,
                userApproval,
                hasModifications: !!modifications
            });

            // Record user interaction
            const interaction: UserInteraction = {
                id: uuidv4(),
                timestamp: new Date(),
                interactionType: userApproval ? 'confirmation' : 'modification',
                chunkId,
                userInput: modifications,
                systemResponse: userApproval ? 'Approved' : 'Modified and approved'
            };

            handshakeState.userInteractions.push(interaction);

            // Apply modifications if provided
            if (modifications) {
                chunk.content = modifications;
                chunk.metadata.contentHash = this.generateContentHash(modifications);
                await this.validateChunk(chunk);
            }

            // Mark chunk as complete
            chunk.metadata.isComplete = true;
            handshakeState.completedChunks.push(chunk);
            handshakeState.currentChunk = null;

            // Update progress
            handshakeState.progress = Math.min(
                ((handshakeState.completedChunks.length + handshakeState.pendingChunks.length) /
                 (handshakeState.completedChunks.length + handshakeState.pendingChunks.length + 1)) * 100,
                95
            );

            // Store updated state
            await this.storeHandshakeState(handshakeState);

            // Emit confirmation event
            this.emit('chunkConfirmed', {
                executionId,
                chunk,
                interaction,
                handshakeState
            });

            // Generate next chunk if auto-continue is enabled
            const strategy = this.chunkStrategies.get(executionId)!;
            if (strategy.autoContinue && chunk.metadata.canContinue) {
                const nextChunk = await this.generateNextChunk(
                    executionId,
                    '', // Empty content to be filled by continuation
                    chunk.type,
                    {
                        parentChunkId: chunk.id,
                        sequenceNumber: chunk.metadata.sequenceNumber + 1,
                        requiresConfirmation: strategy.enableUserConfirmation
                    }
                );

                return {
                    success: true,
                    nextChunk,
                    message: 'Chunk confirmed, next chunk generated'
                };
            }

            return {
                success: true,
                message: 'Chunk confirmed successfully'
            };

        } catch (error) {
            loggingService.error('❌ Failed to confirm chunk', {
                executionId,
                chunkId,
                error: error instanceof Error ? error.message : String(error)
            });

            return {
                success: false,
                message: `Confirmation failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    // ========================================================================
    // STITCHING AND FINALIZATION
    // ========================================================================

    /**
     * Stitch completed chunks into final output
     */
    public async stitchChunks(executionId: string): Promise<string> {
        try {
            const handshakeState = this.handshakeStates.get(executionId);
            if (!handshakeState) {
                throw new Error(`No handshake state found for execution ${executionId}`);
            }

            loggingService.info('🧵 Stitching chunks into final output', {
                executionId,
                completedChunks: handshakeState.completedChunks.length,
                pendingChunks: handshakeState.pendingChunks.length
            });

            handshakeState.currentPhase = HandshakePhase.STITCHING;

            // Sort chunks by sequence number
            const sortedChunks = [...handshakeState.completedChunks]
                .sort((a, b) => a.metadata.sequenceNumber - b.metadata.sequenceNumber);

            // Apply stitching instructions
            let finalContent = '';
            for (const chunk of sortedChunks) {
                finalContent = this.applyStitchingInstructions(finalContent, chunk, handshakeState.stitchingInstructions);
            }

            // Validate final output
            const validationResult = await this.validateFinalOutput(finalContent, handshakeState);

            if (!validationResult.isValid) {
                loggingService.warn('⚠️ Final output validation found issues', {
                    executionId,
                    errors: validationResult.errors,
                    warnings: validationResult.warnings
                });
            }

            // Update handshake state
            handshakeState.currentPhase = HandshakePhase.COMPLETED;
            handshakeState.progress = 100;

            // Store final state
            await this.storeHandshakeState(handshakeState);

            loggingService.info('✅ Chunks stitched successfully', {
                executionId,
                finalContentLength: finalContent.length,
                totalChunks: sortedChunks.length,
                validationScore: validationResult.score
            });

            this.emit('stitchingCompleted', {
                executionId,
                finalContent,
                validationResult,
                handshakeState
            });

            return finalContent;

        } catch (error) {
            loggingService.error('❌ Failed to stitch chunks', {
                executionId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Apply stitching instructions to combine chunks
     */
    private applyStitchingInstructions(
        currentContent: string,
        chunk: ChunkContent,
        instructions: StitchingInstruction[]
    ): string {
        // Find relevant stitching instructions for this chunk
        const relevantInstructions = instructions.filter(
            inst => inst.sourceChunkId === chunk.id || inst.targetChunkId === chunk.id
        );

        if (relevantInstructions.length === 0) {
            // No specific instructions, just concatenate
            return currentContent + chunk.content;
        }

        let result = currentContent;

        for (const instruction of relevantInstructions) {
            switch (instruction.stitchingMethod) {
                case 'concatenate':
                    result += instruction.content;
                    break;

                case 'insert':
                    result = result.substring(0, instruction.position) +
                            instruction.content +
                            result.substring(instruction.position);
                    break;

                case 'replace':
                    if (!chunk || !chunk.content) {
                        result += instruction.content;
                        break;
                    }
                    const endPos = instruction.position + chunk.content.length;
                    result = result.substring(0, instruction.position) +
                            instruction.content +
                            result.substring(endPos);
                    break;

                case 'merge':
                    // Merge content intelligently
                    if (chunk && chunk.content) {
                        result = this.mergeContent(result, chunk.content, instruction.position);
                    } else {
                        result = this.mergeContent(result, instruction.content, instruction.position);
                    }
                    break;

                case 'overwrite':
                    // Replace content at position
                    if (chunk && chunk.content) {
                        result = result.substring(0, instruction.position) +
                                instruction.content +
                                result.substring(instruction.position + chunk.content.length);
                    } else {
                        result = result.substring(0, instruction.position) +
                                instruction.content +
                                result.substring(instruction.position);
                    }
                    break;
            }
        }

        return result;
    }

    /**
     * Merge content intelligently
     */
    private mergeContent(baseContent: string, newContent: string, position: number): string {
        // Simple merge logic - in production you'd want more sophisticated merging
        const basePart = baseContent.substring(0, position);
        const newPart = baseContent.substring(position);

        // Try to find overlapping content to merge cleanly
        const overlap = this.findContentOverlap(basePart, newContent);

        if (overlap > 0) {
            return basePart + newContent.substring(overlap);
        }

        return baseContent + newContent;
    }

    /**
     * Find overlapping content for clean merging
     */
    private findContentOverlap(base: string, addition: string): number {
        const minOverlap = 20;
        const maxOverlap = Math.min(100, base.length, addition.length);

        for (let i = maxOverlap; i >= minOverlap; i--) {
            const baseEnd = base.substring(base.length - i);
            const additionStart = addition.substring(0, i);

            if (baseEnd === additionStart) {
                return i;
            }
        }

        return 0;
    }

    /**
     * Validate final stitched output
     */
    private async validateFinalOutput(
        content: string,
        handshakeState: HandshakeState
    ): Promise<{ isValid: boolean; score: number; errors: string[]; warnings: string[] }> {
        const errors: string[] = [];
        const warnings: string[] = [];

        try {
            // Basic validation
            if (content.trim().length === 0) {
                errors.push('Final output is empty');
            }

            if (content.length < 100) {
                warnings.push('Final output is very short');
            }

            // Check for incomplete structures
            if (this.hasIncompleteStructure(content)) {
                warnings.push('Final output may have incomplete structures');
            }

            // Type-specific validation based on chunk types
            const chunkTypes = handshakeState.completedChunks.map(c => c.type);
            if (chunkTypes.includes(ChunkType.JSON_OBJECT) && !this.isValidJSON(content)) {
                errors.push('Final output contains invalid JSON');
            }

            if (chunkTypes.includes(ChunkType.CODE_BLOCK) && !this.isValidCodeStructure(content)) {
                warnings.push('Final output contains potentially invalid code structure');
            }

            // Calculate validation score
            const errorPenalty = errors.length * 0.5;
            const warningPenalty = warnings.length * 0.1;
            const score = Math.max(0, 1 - errorPenalty - warningPenalty);

            return {
                isValid: errors.length === 0,
                score,
                errors,
                warnings
            };

        } catch (error) {
            return {
                isValid: false,
                score: 0,
                errors: [`Validation error: ${error instanceof Error ? error.message : String(error)}`],
                warnings: []
            };
        }
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================

    private generateContentHash(content: string): string {
        // Simple hash - in production you'd use crypto
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16);
    }

    private initializeDefaultStrategies(): void {
        // Set up default chunking strategies for different content types
        this.chunkStrategies.set('default', DEFAULT_CHUNKING_STRATEGY);
    }

    private async storeHandshakeState(handshakeState: HandshakeState): Promise<void> {
        try {
            await redisService.storeCache(
                `cortex:handshake:${handshakeState.executionId}`,
                handshakeState,
                { ttl: 3600 } // 1 hour
            );
        } catch (error) {
            loggingService.warn('Failed to store handshake state in Redis', {
                executionId: handshakeState.executionId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // ========================================================================
    // PUBLIC API METHODS
    // ========================================================================

    /**
     * Get handshake state for an execution
     */
    public getHandshakeState(executionId: string): HandshakeState | null {
        return this.handshakeStates.get(executionId) || null;
    }

    /**
     * Get current chunk for an execution
     */
    public getCurrentChunk(executionId: string): ChunkContent | null {
        const handshakeState = this.handshakeStates.get(executionId);
        return handshakeState?.currentChunk || null;
    }

    /**
     * Get all chunks for an execution
     */
    public getAllChunks(executionId: string): {
        completed: ChunkContent[];
        pending: ChunkContent[];
        current: ChunkContent | null;
    } {
        const handshakeState = this.handshakeStates.get(executionId);
        if (!handshakeState) {
            return { completed: [], pending: [], current: null };
        }

        return {
            completed: handshakeState.completedChunks,
            pending: handshakeState.pendingChunks,
            current: handshakeState.currentChunk
        };
    }

    /**
     * Cancel handshake and clean up
     */
    public async cancelHandshake(executionId: string): Promise<void> {
        const handshakeState = this.handshakeStates.get(executionId);
        if (!handshakeState) return;

        loggingService.info('🛑 Cancelling handshake', {
            executionId,
            completedChunks: handshakeState.completedChunks.length,
            pendingChunks: handshakeState.pendingChunks.length
        });

        handshakeState.currentPhase = HandshakePhase.FAILED;
        handshakeState.progress = 0;

        // Clean up
        this.handshakeStates.delete(executionId);
        this.chunkStrategies.delete(executionId);
        this.activeChunking.delete(executionId);

        // Remove from Redis
        await redisService.del(`cortex:handshake:${executionId}`);

        this.emit('handshakeCancelled', {
            executionId,
            handshakeState
        });
    }

    /**
     * Get handshake statistics
     */
    public getHandshakeStats(): {
        activeHandshakes: number;
        totalCompletedChunks: number;
        averageChunkSize: number;
        mostCommonChunkTypes: { [key: string]: number };
    } {
        const handshakes = Array.from(this.handshakeStates.values());
        const allChunks = handshakes.flatMap(h => [...h.completedChunks, ...h.pendingChunks, h.currentChunk].filter(Boolean));

        const totalCompletedChunks = handshakes.reduce((sum, h) => sum + h.completedChunks.length, 0);

        const averageChunkSize = allChunks.length > 0
            ? allChunks.reduce((sum, chunk) => sum + (chunk?.content?.length || 0), 0) / allChunks.length
            : 0;

        const chunkTypeCounts = allChunks.reduce((acc, chunk) => {
            if (chunk) {
                acc[chunk.type] = (acc[chunk.type] || 0) + 1;
            }
            return acc;
        }, {} as { [key: string]: number });

        return {
            activeHandshakes: handshakes.length,
            totalCompletedChunks,
            averageChunkSize,
            mostCommonChunkTypes: chunkTypeCounts
        };
    }
}

