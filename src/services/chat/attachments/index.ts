/**
 * Barrel export for attachment processing modules
 */

export { AttachmentProcessor } from './AttachmentProcessor';
export { ContentExtractor } from './ContentExtractor';
export { FileFormatter } from './FileFormatter';
export { FileTypeDetector } from './FileTypeDetector';
export type {
    AttachmentInput,
    ProcessedAttachment,
    AttachmentProcessingResult
} from './types/attachment.types';
