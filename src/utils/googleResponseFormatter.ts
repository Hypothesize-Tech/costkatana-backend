/**
 * Google Services Response Formatter
 * Formats Google Workspace integration responses for chat display
 * with proper structure and view links
 */

import { loggingService } from '../services/logging.service';

export interface GoogleFormattedResponse {
  message: string;
  data?: any;
  viewLinks?: Array<{
    label: string;
    url: string;
    type: 'document' | 'spreadsheet' | 'presentation' | 'file' | 'email' | 'calendar' | 'form';
  }>;
  metadata?: {
    type: string;
    count?: number;
    service: 'gmail' | 'calendar' | 'drive' | 'gdocs' | 'sheets';
  };
}

/**
 * Format Google Drive files response
 */
export function formatDriveFilesResponse(files: any[], action: 'list' | 'search'): GoogleFormattedResponse {
  if (!files || files.length === 0) {
    return {
      message: action === 'search' ? '🔍 No files found matching your search.' : '📁 No files found in Google Drive.',
      metadata: { type: 'drive_list', count: 0, service: 'drive' }
    };
  }

  const viewLinks = files.slice(0, 20).map(file => ({
    label: file.name || 'Untitled',
    url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
    type: determineFileType(file.mimeType) as any
  }));

  const fileList = files.slice(0, 20).map(file => {
    const emoji = getFileEmoji(file.mimeType);
    return `${emoji} **${file.name || 'Untitled'}**${file.mimeType?.includes('folder') ? ' (Folder)' : ''}`;
  }).join('\n');

  const message = action === 'search' 
    ? `🔍 Found ${files.length} file(s) matching your search:\n\n${fileList}`
    : `📁 Found ${files.length} files in Google Drive:\n\n${fileList}`;

  return {
    message,
    data: files,
    viewLinks,
    metadata: { type: 'drive_list', count: files.length, service: 'drive' }
  };
}

/**
 * Format Google Docs list response
 */
export function formatDocsListResponse(files: any[]): GoogleFormattedResponse {
  if (!files || files.length === 0) {
    return {
      message: '📄 No documents found.',
      metadata: { type: 'docs_list', count: 0, service: 'gdocs' }
    };
  }

  const viewLinks = files.map(file => ({
    label: file.name || 'Untitled Document',
    url: file.webViewLink || `https://docs.google.com/document/d/${file.id}/edit`,
    type: 'document' as const
  }));

  const docList = files.map(file => 
    `📄 **${file.name || 'Untitled Document'}**`
  ).join('\n');

  return {
    message: `📄 Found ${files.length} Google Docs:\n\n${docList}`,
    data: files,
    viewLinks,
    metadata: { type: 'docs_list', count: files.length, service: 'gdocs' }
  };
}

/**
 * Format Google Sheets list response
 */
export function formatSheetsListResponse(files: any[]): GoogleFormattedResponse {
  if (!files || files.length === 0) {
    return {
      message: '📊 No spreadsheets found.',
      metadata: { type: 'sheets_list', count: 0, service: 'sheets' }
    };
  }

  const viewLinks = files.map(file => ({
    label: file.name || 'Untitled Spreadsheet',
    url: file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}/edit`,
    type: 'spreadsheet' as const
  }));

  const sheetList = files.map(file => 
    `📊 **${file.name || 'Untitled Spreadsheet'}**`
  ).join('\n');

  return {
    message: `📊 Found ${files.length} Google Sheets:\n\n${sheetList}`,
    data: files,
    viewLinks,
    metadata: { type: 'sheets_list', count: files.length, service: 'sheets' }
  };
}

/**
 * Format Gmail messages response
 */
export function formatGmailMessagesResponse(messages: any[], action: 'list' | 'search'): GoogleFormattedResponse {
  if (!messages || messages.length === 0) {
    return {
      message: action === 'search' ? '📧 No emails found matching your search.' : '📧 No emails found.',
      metadata: { type: 'gmail_list', count: 0, service: 'gmail' }
    };
  }

  const viewLinks = messages.map(msg => ({
    label: msg.subject || msg.snippet?.substring(0, 50) || 'Email',
    url: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`,
    type: 'email' as const
  }));

  const emailList = messages.map((msg, idx) => {
    const from = msg.from || 'Unknown';
    const subject = msg.subject || msg.snippet?.substring(0, 50) || '(No subject)';
    const date = msg.date ? new Date(msg.date).toLocaleDateString() : '';
    
    return `📧 **${subject}**\n   From: ${from}${date ? ` • ${date}` : ''}\n   ${msg.snippet ? msg.snippet.substring(0, 100) + '...' : ''}`;
  }).join('\n\n');

  const message = action === 'search'
    ? `📧 Found ${messages.length} email(s) matching your search:\n\n${emailList}`
    : `📧 Found ${messages.length} email(s):\n\n${emailList}`;

  return {
    message,
    data: messages,
    viewLinks,
    metadata: { type: 'gmail_list', count: messages.length, service: 'gmail' }
  };
}

/**
 * Format Google Calendar events response
 */
export function formatCalendarEventsResponse(events: any[]): GoogleFormattedResponse {
  if (!events || events.length === 0) {
    return {
      message: '📅 No calendar events found.',
      metadata: { type: 'calendar_list', count: 0, service: 'calendar' }
    };
  }

  const viewLinks = events.map(event => ({
    label: event.summary || 'Untitled Event',
    url: event.htmlLink || `https://calendar.google.com/calendar/event?eid=${event.id}`,
    type: 'calendar' as const
  }));

  const eventList = events.map(event => {
    const title = event.summary || 'Untitled Event';
    const start = event.start?.dateTime || event.start?.date;
    const end = event.end?.dateTime || event.end?.date;
    const location = event.location ? `\n   📍 ${event.location}` : '';
    const attendees = event.attendees?.length ? `\n   👥 ${event.attendees.length} attendee(s)` : '';
    
    let timeStr = '';
    if (start) {
      const startDate = new Date(start);
      const endDate = end ? new Date(end) : null;
      
      if (event.start?.dateTime) {
        // Has time
        timeStr = `   🕐 ${startDate.toLocaleString()}`;
        if (endDate) {
          timeStr += ` - ${endDate.toLocaleTimeString()}`;
        }
      } else {
        // All-day event
        timeStr = `   📅 ${startDate.toLocaleDateString()}`;
      }
    }
    
    return `📅 **${title}**\n${timeStr}${location}${attendees}`;
  }).join('\n\n');

  return {
    message: `📅 Found ${events.length} calendar event(s):\n\n${eventList}`,
    data: events,
    viewLinks,
    metadata: { type: 'calendar_list', count: events.length, service: 'calendar' }
  };
}

/**
 * Format single document read response
 */
export function formatDocumentReadResponse(documentId: string, content: string, name?: string): GoogleFormattedResponse {
  const viewLink = {
    label: name || 'View Document',
    url: `https://docs.google.com/document/d/${documentId}/edit`,
    type: 'document' as const
  };

  const preview = content.length > 500 
    ? content.substring(0, 500) + '...\n\n[Content loaded - you can now ask questions about it]'
    : content;

  return {
    message: `📄 Document loaded successfully (${content.length} characters)\n\n**Preview:**\n${preview}`,
    data: { documentId, content, characterCount: content.length },
    viewLinks: [viewLink],
    metadata: { type: 'document_read', service: 'gdocs' }
  };
}

/**
 * Determine file type from MIME type
 */
function determineFileType(mimeType: string | undefined): 'document' | 'spreadsheet' | 'presentation' | 'file' {
  if (!mimeType) return 'file';
  
  if (mimeType.includes('document')) return 'document';
  if (mimeType.includes('spreadsheet')) return 'spreadsheet';
  if (mimeType.includes('presentation')) return 'presentation';
  
  return 'file';
}

/**
 * Get emoji for file type
 */
function getFileEmoji(mimeType: string | undefined): string {
  if (!mimeType) return '📄';
  
  if (mimeType.includes('folder')) return '📁';
  if (mimeType.includes('document')) return '📄';
  if (mimeType.includes('spreadsheet')) return '📊';
  if (mimeType.includes('presentation')) return '📊';
  if (mimeType.includes('pdf')) return '📕';
  if (mimeType.includes('image')) return '🖼️';
  if (mimeType.includes('video')) return '🎬';
  if (mimeType.includes('audio')) return '🎵';
  
  return '📄';
}

/**
 * Main formatter function - routes to appropriate formatter based on service and action
 */
export function formatGoogleServiceResponse(
  service: string,
  action: string,
  result: any
): GoogleFormattedResponse {
  try {
    // Handle error cases
    if (!result.success || result.error) {
      return {
        message: result.message || result.error || 'Operation failed',
        metadata: { type: 'error', service: service as any }
      };
    }

    // Route to appropriate formatter
    if (service === 'drive') {
      if (action === 'search' || action === 'find') {
        return formatDriveFilesResponse(result.data || [], 'search');
      }
      if (action === 'list') {
        return formatDriveFilesResponse(result.data || [], 'list');
      }
    }

    if (service === 'gdocs') {
      if (action === 'list') {
        return formatDocsListResponse(result.data || []);
      }
      if (action === 'read' || action === 'view' || action === 'get') {
        return formatDocumentReadResponse(
          result.data?.documentId,
          result.data?.content || '',
          result.data?.name
        );
      }
    }

    if (service === 'sheets') {
      if (action === 'list') {
        return formatSheetsListResponse(result.data || []);
      }
    }

    if (service === 'gmail' || service === 'email') {
      if (action === 'search' || action === 'find') {
        return formatGmailMessagesResponse(result.data?.messages || [], 'search');
      }
      if (action === 'list') {
        return formatGmailMessagesResponse(result.data?.messages || [], 'list');
      }
    }

    if (service === 'calendar') {
      if (action === 'list' || action === 'events') {
        return formatCalendarEventsResponse(result.data?.events || result.data || []);
      }
    }


    // Default: return the original result with basic formatting
    return {
      message: result.message || 'Operation completed successfully',
      data: result.data,
      metadata: { type: 'generic', service: service as any }
    };

  } catch (error) {
    loggingService.error('Error formatting Google service response', {
      error: error instanceof Error ? error.message : String(error),
      service,
      action
    });

    return {
      message: result.message || 'Operation completed',
      data: result.data,
      metadata: { type: 'error', service: service as any }
    };
  }
}

