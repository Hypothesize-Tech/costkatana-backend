/**
 * HTML Security Service
 * Parses HTML content and extracts text from all elements to detect hidden threats
 * Handles obfuscation techniques like base64, URL encoding, HTML entities, etc.
 */

import * as cheerio from 'cheerio';
import { loggingService } from './logging.service';

export interface HTMLSecurityResult {
    extractedText: string;
    hasHTML: boolean;
    htmlMetadata: {
        scriptTags: number;
        styleTags: number;
        comments: number;
        hiddenElements: number;
        dataAttributes: number;
        obfuscatedContent: string[];
    };
}

export class HTMLSecurityService {
    /**
     * Check if content contains HTML
     */
    static isHTML(content: string): boolean {
        if (!content || typeof content !== 'string') {
            return false;
        }

        // Check for HTML tags
        const htmlTagPattern = /<[a-z][\s\S]*>/i;
        return htmlTagPattern.test(content.trim());
    }

    /**
     * Extract and normalize text from HTML content
     * This method extracts text from all elements including hidden ones
     */
    static extractTextFromHTML(htmlContent: string): HTMLSecurityResult {
        try {
            if (!this.isHTML(htmlContent)) {
                return {
                    extractedText: htmlContent,
                    hasHTML: false,
                    htmlMetadata: {
                        scriptTags: 0,
                        styleTags: 0,
                        comments: 0,
                        hiddenElements: 0,
                        dataAttributes: 0,
                        obfuscatedContent: []
                    }
                };
            }

            const $ = cheerio.load(htmlContent, {
                decodeEntities: false
            });

            const extractedTexts: string[] = [];
            const obfuscatedContent: string[] = [];
            let scriptTags = 0;
            let styleTags = 0;
            let comments = 0;
            let hiddenElements = 0;
            let dataAttributes = 0;

            // Extract text from script tags
            $('script').each((_, element) => {
                scriptTags++;
                const scriptContent = $(element).html() || $(element).text();
                if (scriptContent) {
                    extractedTexts.push(scriptContent);
                    // Check for obfuscation
                    if (this.detectObfuscation(scriptContent)) {
                        obfuscatedContent.push(`script:${scriptContent.substring(0, 100)}`);
                    }
                }
            });

            // Extract text from style tags
            $('style').each((_, element) => {
                styleTags++;
                const styleContent = $(element).html() || $(element).text();
                if (styleContent) {
                    extractedTexts.push(styleContent);
                }
            });

            // Extract text from HTML comments
            $.root().contents().each((_, node) => {
                if (node.type === 'comment') {
                    comments++;
                    const commentText = node.data || '';
                    if (commentText) {
                        extractedTexts.push(commentText);
                        if (this.detectObfuscation(commentText)) {
                            obfuscatedContent.push(`comment:${commentText.substring(0, 100)}`);
                        }
                    }
                }
            });

            // Extract text from all visible elements
            $('*').each((_, element) => {
                const $el = $(element);
                
                // Check if element is hidden
                const isHidden = 
                    $el.css('display') === 'none' ||
                    $el.css('visibility') === 'hidden' ||
                    $el.attr('hidden') !== undefined ||
                    $el.hasClass('hidden') ||
                    $el.attr('style')?.includes('display:none') ||
                    $el.attr('style')?.includes('visibility:hidden');

                if (isHidden) {
                    hiddenElements++;
                }

                // Extract text content
                const text = $el.text();
                if (text && text.trim()) {
                    extractedTexts.push(text.trim());
                }

                // Extract data attributes (often used for hidden data)
                $el.attr() && Object.keys($el.attr() || {}).forEach(attr => {
                    if (attr.startsWith('data-')) {
                        dataAttributes++;
                        const dataValue = $el.attr(attr);
                        if (dataValue) {
                            extractedTexts.push(dataValue);
                            if (this.detectObfuscation(dataValue)) {
                                obfuscatedContent.push(`data-${attr}:${dataValue.substring(0, 100)}`);
                            }
                        }
                    }
                });

                // Extract from input values (hidden inputs)
                if ($el.is('input[type="hidden"]')) {
                    const value = $el.attr('value');
                    if (value) {
                        extractedTexts.push(value);
                        if (this.detectObfuscation(value)) {
                            obfuscatedContent.push(`hidden-input:${value.substring(0, 100)}`);
                        }
                    }
                }

                // Extract from meta tags
                if ($el.is('meta')) {
                    const content = $el.attr('content');
                    if (content) {
                        extractedTexts.push(content);
                    }
                }
            });

            // Decode HTML entities and normalize
            const normalizedText = extractedTexts
                .map(text => this.decodeHTML(text))
                .filter(text => text.trim().length > 0)
                .join(' ');

            return {
                extractedText: normalizedText,
                hasHTML: true,
                htmlMetadata: {
                    scriptTags,
                    styleTags,
                    comments,
                    hiddenElements,
                    dataAttributes,
                    obfuscatedContent
                }
            };

        } catch (error) {
            loggingService.error('Error extracting text from HTML', {
                error: error instanceof Error ? error.message : String(error),
                htmlLength: htmlContent.length
            });

            // Fallback: return original content if parsing fails
            return {
                extractedText: htmlContent,
                hasHTML: true,
                htmlMetadata: {
                    scriptTags: 0,
                    styleTags: 0,
                    comments: 0,
                    hiddenElements: 0,
                    dataAttributes: 0,
                    obfuscatedContent: []
                }
            };
        }
    }

    /**
     * Detect obfuscation techniques in content
     */
    private static detectObfuscation(content: string): boolean {
        if (!content || content.length < 10) {
            return false;
        }

        // Check for base64 encoding
        const base64Pattern = /^[A-Za-z0-9+/]{20,}={0,2}$/;
        if (base64Pattern.test(content.replace(/\s/g, ''))) {
            return true;
        }

        // Check for URL encoding (high percentage of %XX)
        const urlEncodedPattern = /%[0-9A-Fa-f]{2}/g;
        const urlEncodedMatches = content.match(urlEncodedPattern);
        if (urlEncodedMatches && urlEncodedMatches.length > content.length * 0.1) {
            return true;
        }

        // Check for hex encoding
        const hexPattern = /\\x[0-9A-Fa-f]{2}/g;
        if (hexPattern.test(content) && content.match(hexPattern)!.length > 5) {
            return true;
        }

        // Check for excessive HTML entities
        const entityPattern = /&#[0-9]+;|&[a-z]+;/gi;
        if (entityPattern.test(content) && content.match(entityPattern)!.length > content.length * 0.2) {
            return true;
        }

        return false;
    }

    /**
     * Decode HTML entities and other obfuscation
     */
    private static decodeHTML(content: string): string {
        try {
            let decoded = content;

            // Decode HTML entities
            decoded = decoded
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&nbsp;/g, ' ');

            // Decode numeric entities
            decoded = decoded.replace(/&#(\d+);/g, (_, num) => {
                return String.fromCharCode(parseInt(num, 10));
            });

            // Decode hex entities
            decoded = decoded.replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => {
                return String.fromCharCode(parseInt(hex, 16));
            });

            // Try to decode base64 if it looks like base64
            if (/^[A-Za-z0-9+/]{20,}={0,2}$/.test(decoded.replace(/\s/g, ''))) {
                try {
                    const base64Decoded = Buffer.from(decoded.replace(/\s/g, ''), 'base64').toString('utf-8');
                    // Only use if it produces readable text
                    if (/^[\x20-\x7E\s]*$/.test(base64Decoded)) {
                        decoded = base64Decoded + ' ' + decoded; // Include both
                    }
                } catch {
                    // Not valid base64, continue
                }
            }

            // Decode URL encoding
            try {
                decoded = decodeURIComponent(decoded);
            } catch {
                // Not fully URL encoded, continue
            }

            return decoded;

        } catch (error) {
            loggingService.warn('Error decoding HTML content', {
                error: error instanceof Error ? error.message : String(error)
            });
            return content;
        }
    }

    /**
     * Prepare content for security scanning
     * Returns the text that should be scanned, whether it came from HTML or plain text
     */
    static prepareContentForScanning(content: string): {
        textToScan: string;
        isHTML: boolean;
        metadata: HTMLSecurityResult['htmlMetadata'];
    } {
        if (this.isHTML(content)) {
            const result = this.extractTextFromHTML(content);
            return {
                textToScan: result.extractedText,
                isHTML: true,
                metadata: result.htmlMetadata
            };
        }

        return {
            textToScan: content,
            isHTML: false,
            metadata: {
                scriptTags: 0,
                styleTags: 0,
                comments: 0,
                hiddenElements: 0,
                dataAttributes: 0,
                obfuscatedContent: []
            }
        };
    }
}

