import { extractLinkMetadata, LinkMetadata } from '@utils/linkMetadata';
import { loggingService } from '@services/logging.service';

/**
 * URL with extracted metadata
 */
export interface UrlWithMetadata {
    url: string;
    metadata: LinkMetadata | null;
}

/**
 * Link enrichment result
 */
export interface LinkEnrichmentResult {
    enrichedMessage: string;
    hasLinks: boolean;
    linkCount: number;
}

/**
 * LinkMetadataEnricher
 * Centralizes URL detection and metadata extraction for chat messages
 * Handles timeout, error recovery, and message enrichment
 */
export class LinkMetadataEnricher {
    
    private static readonly URL_PATTERN = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;
    private static readonly METADATA_TIMEOUT = 2000; // 2 seconds per URL
    private static readonly TOTAL_TIMEOUT = 2500; // 2.5 seconds total
    private static readonly MAX_CONTENT_LENGTH = 5000; // Max content to include
    private static readonly MAX_DESCRIPTION_LENGTH = 300; // Max description length
    private static readonly MAX_CODE_BLOCKS = 3; // Max code blocks to include
    private static readonly MAX_CODE_BLOCK_LENGTH = 1000; // Max length per code block

    /**
     * Detect URLs in message
     * 
     * @param message - Message content to scan
     * @returns Array of detected URLs
     */
    static detectUrls(message: string): string[] {
        const matches = message.match(this.URL_PATTERN);
        return matches || [];
    }

    /**
     * Extract metadata for a single URL with timeout
     * 
     * @param url - URL to extract metadata from
     * @returns Promise resolving to URL with metadata
     */
    private static async extractUrlMetadata(url: string): Promise<UrlWithMetadata> {
        try {
            const timeoutPromise = new Promise<UrlWithMetadata>((resolve) => 
                setTimeout(() => resolve({ url, metadata: null }), this.METADATA_TIMEOUT)
            );
            
            const fetchPromise = extractLinkMetadata(url).then(metadata => ({ url, metadata }));
            
            return await Promise.race([fetchPromise, timeoutPromise]);
        } catch (error) {
            loggingService.debug('Link metadata extraction failed', {
                url,
                error: error instanceof Error ? error.message : String(error)
            });
            return { url, metadata: null };
        }
    }

    /**
     * Extract metadata for multiple URLs with global timeout
     * 
     * @param urls - Array of URLs to process
     * @returns Promise resolving to array of URLs with metadata
     */
    private static async extractAllMetadata(urls: string[]): Promise<UrlWithMetadata[]> {
        const metadataPromises = urls.map(url => this.extractUrlMetadata(url));
        
        // Wait for all with global timeout
        const urlsWithMetadata = await Promise.race([
            Promise.all(metadataPromises),
            new Promise<UrlWithMetadata[]>((resolve) => 
                setTimeout(() => resolve(urls.map(url => ({ url, metadata: null }))), this.TOTAL_TIMEOUT)
            )
        ]);

        return urlsWithMetadata;
    }

    /**
     * Build link information string from metadata
     * 
     * @param url - URL being processed
     * @param metadata - Extracted metadata
     * @returns Formatted link information string
     */
    private static buildLinkInfo(url: string, metadata: LinkMetadata | null): string {
        if (!metadata?.title) {
            return `📎 **ATTACHED PUBLIC LINK:**\n**URL:** ${url}`;
        }

        const linkType = metadata.type === 'repository' ? 'Repository' : 
                        metadata.type === 'video' ? 'Video' : 
                        metadata.siteName ?? 'Link';
        
        let linkInfo = `📎 **ATTACHED PUBLIC LINK - ${linkType}:**\n**Title:** ${metadata.title}\n**URL:** ${url}`;
        
        // Add description
        if (metadata.description) {
            const truncatedDesc = metadata.description.substring(0, this.MAX_DESCRIPTION_LENGTH);
            linkInfo += `\n**Description:** ${truncatedDesc}${metadata.description.length > this.MAX_DESCRIPTION_LENGTH ? '...' : ''}`;
        }
        
        // Add AI summary
        if (metadata.summary) {
            linkInfo += `\n\n**📊 AI SUMMARY:**\n${metadata.summary}`;
        }
        
        // Add structured data
        if (metadata.structuredData) {
            const structuredDataStr = JSON.stringify(metadata.structuredData, null, 2).substring(0, 1000);
            linkInfo += `\n\n**📋 STRUCTURED DATA EXTRACTED:**\n${structuredDataStr}`;
        }
        
        // Add full content
        if (metadata.fullContent && metadata.fullContent.length > 100) {
            const contentPreview = metadata.fullContent.substring(0, this.MAX_CONTENT_LENGTH);
            linkInfo += `\n\n**📄 FULL PAGE CONTENT:**\n${contentPreview}${metadata.fullContent.length > this.MAX_CONTENT_LENGTH ? '...\n[Content truncated for length]' : ''}`;
        }
        
        // Add code blocks
        if (metadata.codeBlocks && metadata.codeBlocks.length > 0) {
            linkInfo += `\n\n**CODE BLOCKS FOUND (${metadata.codeBlocks.length}):**`;
            metadata.codeBlocks.slice(0, this.MAX_CODE_BLOCKS).forEach((block: { language?: string; code: string }, idx: number) => {
                const lang = block.language ? ` (${block.language})` : '';
                const truncatedCode = block.code.substring(0, this.MAX_CODE_BLOCK_LENGTH);
                linkInfo += `\n\n**Code Block ${idx + 1}${lang}:**\n\`\`\`${block.language ?? ''}\n${truncatedCode}\n\`\`\``;
            });
            if (metadata.codeBlocks.length > this.MAX_CODE_BLOCKS) {
                linkInfo += `\n... and ${metadata.codeBlocks.length - this.MAX_CODE_BLOCKS} more code blocks`;
            }
        }
        
        // Add images info
        if (metadata.images && metadata.images.length > 0) {
            linkInfo += `\n\n**🖼️ IMAGES FOUND:** ${metadata.images.length} images on this page`;
        }
        
        // Add scraping method
        if (metadata.scrapingMethod) {
            const methodLabel = metadata.scrapingMethod === 'puppeteer-ai' 
                ? '🤖 Advanced AI Scraping (Puppeteer + AI Analysis + Vector Storage)'
                : '⚡ Fast Scraping (Axios + Cheerio)';
            linkInfo += `\n\n**Method:** ${methodLabel}`;
        }

        return linkInfo;
    }

    /**
     * Build instruction prefix for AI with link context
     * 
     * @param linkDescriptions - Array of formatted link descriptions
     * @returns Instruction prefix string
     */
    private static buildInstructionPrefix(linkDescriptions: string[]): string {
        return `\n\n⚠️ **IMPORTANT: USER IS ASKING ABOUT THE LINK(S) BELOW** ⚠️\n\n${linkDescriptions.join('\n\n')}\n\n**🚨 CRITICAL INSTRUCTIONS - READ CAREFULLY:**
1. The user's question is SPECIFICALLY about the link(s) shown above
2. You MUST provide a comprehensive summary based on:
   - The full page content provided above
   - Any code blocks extracted from the page
   - Images and other media found on the page
   - The overall structure and purpose of the content
3. COMPLETELY IGNORE and DO NOT mention:
   - Any Google Drive files
   - Any other documents or files
   - Any previous conversation context about other topics
   - Anything not directly related to the link(s) above
4. Your summary should cover:
   - What the page/repository/content is about
   - Key sections or components
   - Any code, technical details, or implementations mentioned
   - The purpose and functionality
5. Be thorough and detailed in your analysis of the scraped content

**User's question:**\n`;
    }

    /**
     * Enrich message with link metadata
     * Main entry point for link detection and enrichment
     * 
     * @param message - Original message content
     * @param userId - User ID for logging
     * @returns Promise resolving to enrichment result
     */
    static async enrichMessage(message: string, userId: string): Promise<LinkEnrichmentResult> {
        try {
            const detectedUrls = this.detectUrls(message);

            if (!detectedUrls || detectedUrls.length === 0) {
                return {
                    enrichedMessage: message,
                    hasLinks: false,
                    linkCount: 0
                };
            }

            loggingService.debug('Detected URLs in message, extracting metadata', {
                userId,
                urlCount: detectedUrls.length,
                urls: detectedUrls
            });

            // Extract metadata for all URLs
            const urlsWithMetadata = await this.extractAllMetadata(detectedUrls);

            // Build link descriptions and replace URLs with placeholders
            const linkDescriptions: string[] = [];
            let enrichedMessage = message;

            urlsWithMetadata.forEach(({ url, metadata }, index) => {
                const linkInfo = this.buildLinkInfo(url, metadata);
                linkDescriptions.push(linkInfo);
                
                // Replace URL with placeholder
                enrichedMessage = enrichedMessage.replace(url, `[LINK_${index + 1}]`);
                
                // Log metadata extraction
                if (metadata?.title) {
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
                }
            });

            // Replace placeholders back with URLs
            linkDescriptions.forEach((_, index) => {
                const url = urlsWithMetadata[index]?.url || '';
                enrichedMessage = enrichedMessage.replace(`[LINK_${index + 1}]`, url);
            });

            // Prepend instruction prefix with link context
            if (linkDescriptions.length > 0) {
                const linkContextPrefix = this.buildInstructionPrefix(linkDescriptions);
                enrichedMessage = linkContextPrefix + enrichedMessage;
            }

            return {
                enrichedMessage,
                hasLinks: true,
                linkCount: detectedUrls.length
            };

        } catch (error) {
            loggingService.error('Failed to extract link metadata', {
                error: error instanceof Error ? error.message : String(error),
                userId,
                messageLength: message.length
            });
            
            // Return original message on error
            return {
                enrichedMessage: message,
                hasLinks: false,
                linkCount: 0
            };
        }
    }
}
