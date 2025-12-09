/**
 * Google Intent Classifier
 * Detects Google Workspace operations from natural language without @ mentions
 */

import { loggingService } from '../services/logging.service';

export interface GoogleIntent {
    service: 'gmail' | 'calendar' | 'drive' | 'gdocs' | 'sheets' | null;
    action: string;
    confidence: number;
    params: Record<string, any>;
}

/**
 * Detect Google Workspace intent from natural language
 */
export function detectGoogleIntent(message: string): GoogleIntent {
    const lowerMessage = message.toLowerCase();
    
    loggingService.debug('Detecting Google intent', { message });

    // Gmail patterns
    const gmailIntent = detectGmailIntent(lowerMessage);
    if (gmailIntent.confidence >= 0.7) {
        return gmailIntent;
    }

    // Calendar patterns
    const calendarIntent = detectCalendarIntent(lowerMessage);
    if (calendarIntent.confidence >= 0.7) {
        return calendarIntent;
    }

    // Drive patterns
    const driveIntent = detectDriveIntent(lowerMessage);
    if (driveIntent.confidence >= 0.7) {
        return driveIntent;
    }

    // Google Docs patterns
    const docsIntent = detectDocsIntent(lowerMessage);
    if (docsIntent.confidence >= 0.7) {
        return docsIntent;
    }

    // Sheets patterns
    const sheetsIntent = detectSheetsIntent(lowerMessage);
    if (sheetsIntent.confidence >= 0.7) {
        return sheetsIntent;
    }

    // No confident match found
    return {
        service: null,
        action: '',
        confidence: 0,
        params: {}
    };
}

/**
 * Detect Gmail intents
 */
function detectGmailIntent(text: string): GoogleIntent {
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    
    // Send email patterns
    if (/\b(send|email|mail)\b.*\b(to|recipient)\b/.test(text) || 
        (/\b(send|email)\b/.test(text) && emailPattern.test(text))) {
        return {
            service: 'gmail',
            action: 'send',
            confidence: 0.85,
            params: { extractFromNL: true }
        };
    }

    // Search email patterns
    if (/\b(search|find|look\s+for)\b.*\b(email|mail|message|inbox)\b/.test(text) ||
        /\bcheck\s+(my\s+)?(email|inbox|mail)\b/.test(text)) {
        return {
            service: 'gmail',
            action: 'search',
            confidence: 0.8,
            params: { extractFromNL: true }
        };
    }

    // List emails
    if (/\b(show|list|display)\b.*\b(email|mail|message|inbox)\b/.test(text) ||
        /\b(unread|recent)\s+(email|mail)\b/.test(text)) {
        return {
            service: 'gmail',
            action: 'list',
            confidence: 0.75,
            params: {}
        };
    }

    return { service: null, action: '', confidence: 0, params: {} };
}

/**
 * Detect Calendar intents
 */
function detectCalendarIntent(text: string): GoogleIntent {
    // Create event patterns
    if (/\b(create|add|schedule|set\s+up|make)\b.*\b(meeting|event|appointment|calendar)\b/.test(text) ||
        /\b(meeting|event|appointment)\b.*\b(tomorrow|today|next|this)\b/.test(text) ||
        /\b(schedule|book)\b.*\b(call|meeting)\b/.test(text)) {
        return {
            service: 'calendar',
            action: 'create',
            confidence: 0.85,
            params: { extractFromNL: true }
        };
    }

    // List events
    if (/\b(show|list|display|what('?s)?)\b.*\b(meeting|event|calendar|schedule|agenda)\b/.test(text) ||
        /\bwhat('?s)?\s+(on\s+)?(my\s+)?(calendar|schedule)\b/.test(text)) {
        return {
            service: 'calendar',
            action: 'list',
            confidence: 0.8,
            params: {}
        };
    }

    // Search events
    if (/\b(find|search|look\s+for)\b.*\b(meeting|event)\b/.test(text)) {
        return {
            service: 'calendar',
            action: 'search',
            confidence: 0.75,
            params: { extractFromNL: true }
        };
    }

    return { service: null, action: '', confidence: 0, params: {} };
}

/**
 * Detect Drive intents
 */
function detectDriveIntent(text: string): GoogleIntent {
    // Search files
    if (/\b(search|find|look\s+for)\b.*\b(file|drive|document|folder)\b/.test(text) ||
        /\b(where\s+is|locate)\b.*\b(file|document)\b/.test(text)) {
        return {
            service: 'drive',
            action: 'search',
            confidence: 0.85,
            params: { extractFromNL: true }
        };
    }

    // List files
    if (/\b(show|list|display)\b.*\b(file|drive|document|folder)\b/.test(text) ||
        /\bmy\s+(drive\s+)?(file|document)\b/.test(text)) {
        return {
            service: 'drive',
            action: 'list',
            confidence: 0.8,
            params: {}
        };
    }

    // Upload file
    if (/\b(upload|add|save)\b.*\b(to\s+drive|file)\b/.test(text)) {
        return {
            service: 'drive',
            action: 'upload',
            confidence: 0.75,
            params: {}
        };
    }

    return { service: null, action: '', confidence: 0, params: {} };
}

/**
 * Detect Google Docs intents
 */
function detectDocsIntent(text: string): GoogleIntent {
    // Read document
    if (/\b(read|open|show|display|view)\b.*\b(doc|document|google\s+doc)\b/.test(text) ||
        /\b(what('?s)?\s+(in|inside))\b.*\b(doc|document)\b/.test(text)) {
        return {
            service: 'gdocs',
            action: 'read',
            confidence: 0.85,
            params: { extractFromNL: true }
        };
    }

    // Create document
    if (/\b(create|make|new)\b.*\b(doc|document|google\s+doc)\b/.test(text)) {
        return {
            service: 'gdocs',
            action: 'create',
            confidence: 0.8,
            params: { extractFromNL: true }
        };
    }

    // List documents
    if (/\b(list|show)\b.*\b(doc|document)\b/.test(text)) {
        return {
            service: 'gdocs',
            action: 'list',
            confidence: 0.75,
            params: {}
        };
    }

    return { service: null, action: '', confidence: 0, params: {} };
}

/**
 * Detect Sheets intents
 */
function detectSheetsIntent(text: string): GoogleIntent {
    // Read spreadsheet
    if (/\b(read|open|show|view)\b.*\b(sheet|spreadsheet|google\s+sheet)\b/.test(text)) {
        return {
            service: 'sheets',
            action: 'read',
            confidence: 0.85,
            params: { extractFromNL: true }
        };
    }

    // Create spreadsheet
    if (/\b(create|make|new)\b.*\b(sheet|spreadsheet|google\s+sheet)\b/.test(text)) {
        return {
            service: 'sheets',
            action: 'create',
            confidence: 0.8,
            params: { extractFromNL: true }
        };
    }

    // Export to spreadsheet
    if (/\b(export|save)\b.*\b(to\s+)?(sheet|spreadsheet)\b/.test(text)) {
        return {
            service: 'sheets',
            action: 'export',
            confidence: 0.75,
            params: {}
        };
    }

    return { service: null, action: '', confidence: 0, params: {} };
}


