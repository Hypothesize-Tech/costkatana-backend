import { loggingService } from './logging.service';
import { GoogleService } from './google.service';
import { GoogleConnection } from '../models/GoogleConnection';
import mongoose from 'mongoose';

/**
 * GoogleCommandService: Handles natural language commands for Google Workspace services
 * 
 * Supported services:
 * - Gmail: send, draft, list, search
 * - Calendar: list, create, update, delete
 * - Drive: list, search, upload, folder
 * - Sheets: create, append, export
 * - Docs: create, update
 */
export class GoogleCommandService {
    
    /**
     * Execute a Google command based on natural language input
     * @param userId - The user executing the command
     * @param command - The parsed command object
     * @param message - Original user message for context
     * @returns Result message to display to user
     */
    static async executeCommand(userId: string, command: any, message: string): Promise<string> {
        try {
            // Get user's Google connection
            const connection = await this.getUserConnection(userId);
            
            if (!connection) {
                return 'Please connect your Google account first to use Google Workspace commands. Go to Settings > Integrations to connect.';
            }
            
            // Route to appropriate handler based on integration type
            switch (command.integration) {
                case 'gmail':
                    return await this.handleGmailCommand(connection, command, message);
                case 'calendar':
                    return await this.handleCalendarCommand(connection, command, message);
                case 'drive':
                    return await this.handleDriveCommand(connection, command, message);
                case 'sheets':
                    return await this.handleSheetsCommand(connection, command, message);
                case 'docs':
                    return await this.handleDocsCommand(connection, command, message);
                case 'google':
                    // Generic Google command - try to infer service
                    return await this.handleGenericGoogleCommand(connection, command, message);
                default:
                    return `Unsupported Google service: ${command.integration}`;
            }
        } catch (error: any) {
            loggingService.error('Error executing Google command', {
                userId,
                command,
                error: error.message
            });
            return `Failed to execute command: ${error.message}`;
        }
    }
    
    /**
     * Get user's active Google connection
     */
    private static async getUserConnection(userId: string): Promise<any | null> {
        return await GoogleConnection.findOne({
            userId: new mongoose.Types.ObjectId(userId),
            isActive: true
        }).select('+accessToken +refreshToken');
    }
    
    /**
     * Handle Gmail commands
     */
    private static async handleGmailCommand(connection: any, command: any, message: string): Promise<string> {
        const action = this.extractAction(command, message, ['send', 'draft', 'list', 'search', 'compose']);
        
        loggingService.info('Executing Gmail command', {
            action,
            userId: connection.userId
        });
        
        switch (action) {
            case 'send':
            case 'compose':
                return await this.sendEmail(connection, message);
            case 'list':
            case 'search':
                return await this.searchEmails(connection, message);
            default:
                return this.listGmailActions();
        }
    }
    
    /**
     * Handle Calendar commands
     */
    private static async handleCalendarCommand(connection: any, command: any, message: string): Promise<string> {
        const action = this.extractAction(command, message, ['list', 'create', 'add', 'update', 'delete', 'events']);
        
        loggingService.info('Executing Calendar command', {
            action,
            userId: connection.userId
        });
        
        switch (action) {
            case 'list':
            case 'events':
                return await this.listCalendarEvents(connection, message);
            case 'create':
            case 'add':
                return await this.createCalendarEvent(connection, message);
            case 'update':
                return 'To update an event, use: @calendar update [event-id] [new-details]';
            case 'delete':
                return 'To delete an event, use: @calendar delete [event-id]';
            default:
                return this.listCalendarActions();
        }
    }
    
    /**
     * Handle Drive commands
     */
    private static async handleDriveCommand(connection: any, command: any, message: string): Promise<string> {
        const action = this.extractAction(command, message, ['list', 'search', 'upload', 'folder', 'files']);
        
        loggingService.info('Executing Drive command', {
            action,
            userId: connection.userId
        });
        
        switch (action) {
            case 'list':
            case 'files':
                return await this.listDriveFiles(connection, message);
            case 'search':
                return await this.searchDriveFiles(connection, message);
            case 'folder':
                return 'To create a folder, use: @drive folder [name]';
            case 'upload':
                return 'To upload a file, use the Drive viewer or: @drive upload [file]';
            default:
                return this.listDriveActions();
        }
    }
    
    /**
     * Handle Sheets commands
     */
    private static async handleSheetsCommand(connection: any, command: any, message: string): Promise<string> {
        const action = this.extractAction(command, message, ['list', 'create', 'append', 'export']);
        
        loggingService.info('Executing Sheets command', {
            action,
            userId: connection.userId
        });
        
        switch (action) {
            case 'list':
                return await this.listSpreadsheets(connection);
            case 'create':
                return 'To create a sheet, use: @sheets create [title]';
            case 'append':
                return 'To append data, use: @sheets append [sheet-id] [data]';
            case 'export':
                return 'To export data, use: @sheets export [sheet-id]';
            default:
                return this.listSheetsActions();
        }
    }
    
    /**
     * Handle Docs commands
     */
    private static async handleDocsCommand(connection: any, command: any, message: string): Promise<string> {
        const action = this.extractAction(command, message, ['list', 'create', 'update']);
        
        loggingService.info('Executing Docs command', {
            action,
            userId: connection.userId
        });
        
        switch (action) {
            case 'list':
                return await this.listDocuments(connection);
            case 'create':
                return 'To create a document, use: @docs create [title]';
            case 'update':
                return 'To update a document, use: @docs update [doc-id] [content]';
            default:
                return this.listDocsActions();
        }
    }
    
    /**
     * Handle generic Google commands
     */
    private static async handleGenericGoogleCommand(connection: any, command: any, message: string): Promise<string> {
        // Compose details about user's connection status and command info
        let connDetails = '';
        if (connection) {
            connDetails = `Your Google connection is active for ${connection.googleEmail || connection.userId || 'your account'}.\n\n`;
        } else {
            connDetails = `No active Google account detected. Please connect your Google account in Settings > Integrations.\n\n`;
        }

        let commandDetails = '';
        if (command && command.integration) {
            commandDetails = `* Detected integration: @${command.integration}${command.action ? ` (${command.action})` : ''}\n`;
        }
        if (message) {
            commandDetails += `* Command context: "${message.trim().substring(0, 100)}"\n`;
        }
        if (commandDetails) {
            commandDetails = `Command Details:\n${commandDetails}\n`;
        }

        const helpText =
            `**Google Workspace Commands**\n\n` +
            `Use these commands to interact with your Google account:\n\n` +
            `• **@gmail** - Send emails, search inbox\n` +
            `• **@calendar** - Manage events and meetings\n` +
            `• **@drive** - Browse and search files\n` +
            `• **@sheets** - Create and manage spreadsheets\n` +
            `• **@docs** - Create and edit documents\n\n` +
            `Examples:\n` +
            `• @gmail search budget\n` +
            `• @calendar list events today\n` +
            `• @drive list recent files`;

        return connDetails + commandDetails + helpText;
    }
    
    /**
     * Extract action from command or message
     */
    private static extractAction(command: any, message: string, validActions: string[]): string {
        // Check command object first
        if (command.action) {
            return command.action.toLowerCase();
        }
        
        // Parse from message
        const lowerMessage = message.toLowerCase();
        for (const action of validActions) {
            if (lowerMessage.includes(action)) {
                return action;
            }
        }
        
        return validActions[0] || 'list'; // Default to first action or 'list'
    }
    
    // ==================== Gmail Actions ====================
    
    private static async sendEmail(connection: any, message: string): Promise<string> {
        // Parse email details from message
        const toMatch = message.match(/to\s+([^\s]+@[^\s]+)/i);
        const subjectMatch = message.match(/subject[:\s]+"([^"]+)"|subject[:\s]+([^\n]+)/i);
        const bodyMatch = message.match(/body[:\s]+"([^"]+)"|message[:\s]+"([^"]+)"/i);
        
        if (!toMatch) {
            return 'Please specify recipient email address. Example: @gmail send to user@example.com subject "Budget Report" message "Please review the Q4 budget."';
        }
        
        const to = toMatch[1];
        const subject = subjectMatch ? (subjectMatch[1] || subjectMatch[2]) : 'No Subject';
        const body = bodyMatch ? (bodyMatch[1] || bodyMatch[2]) : message;
        
        try {
            await GoogleService.sendEmail(connection, to, subject, body, false);
            return `✅ Email sent to ${to} successfully!`;
        } catch (error: any) {
            return `❌ Failed to send email: ${error.message}`;
        }
    }
    
    private static async searchEmails(connection: any, message: string): Promise<string> {
        const query = message.replace(/@gmail\s+(?:search|list)\s+/i, '').trim();
        
        try {
            const results = await GoogleService.searchGmailMessages(connection, query || '', 10);
            
            if (!results || results.length === 0) {
                return `No emails found ${query ? `matching "${query}"` : ''}`;
            }
            
            const emailList = results.slice(0, 5).map((email: any, idx: number) => 
                `${idx + 1}. **${email.subject}**\n   From: ${email.from}\n   ${email.date}`
            ).join('\n\n');
            
            return `**Recent Emails** ${query ? `(matching "${query}")` : ''}\n\n${emailList}\n\n${results.length > 5 ? `+ ${results.length - 5} more results. Open Gmail viewer to see all.` : ''}`;
        } catch (error: any) {
            return `❌ Failed to search emails: ${error.message}`;
        }
    }
    
    private static listGmailActions(): string {
        return `**Gmail Commands**\n\n` +
               `• **@gmail search [query]** - Search your inbox\n` +
               `• **@gmail send to [email] subject "[subject]" message "[body]"** - Send email\n` +
               `• **@gmail list** - List recent emails\n\n` +
               `Examples:\n` +
               `• @gmail search budget alerts\n` +
               `• @gmail send to team@company.com subject "Weekly Update" message "Here's this week's summary..."`;
    }
    
    // ==================== Calendar Actions ====================
    
    private static async listCalendarEvents(connection: any, message: string): Promise<string> {
        try {
            // Default: next 7 days
            let now = new Date();
            let endDate = new Date(now);
            endDate.setDate(now.getDate() + 7);

            // If the message contains a specific date range, parse it
            // e.g., "@calendar list events today", "this week", "tomorrow", "on 2024-06-21"
            if (/today/i.test(message)) {
                now = new Date();
                now.setHours(0, 0, 0, 0);
                endDate = new Date(now);
                endDate.setDate(now.getDate() + 1);
            } else if (/tomorrow/i.test(message)) {
                now = new Date();
                now.setHours(0, 0, 0, 0);
                now.setDate(now.getDate() + 1);
                endDate = new Date(now);
                endDate.setDate(now.getDate() + 1);
            } else if (/this\s+week/i.test(message)) {
                now = new Date();
                now.setHours(0, 0, 0, 0);
                // Set to start of week (Sunday)
                now.setDate(now.getDate() - now.getDay());
                endDate = new Date(now);
                endDate.setDate(now.getDate() + 7);
            } else {
                // Try parsing "on YYYY-MM-DD"
                const dateMatch = message.match(/on\s+(\d{4}-\d{2}-\d{2})/i);
                if (dateMatch) {
                    const dateStr = dateMatch[1];
                    now = new Date(dateStr);
                    now.setHours(0, 0, 0, 0);
                    endDate = new Date(now);
                    endDate.setDate(now.getDate() + 1);
                }
            }

            const events = await GoogleService.listCalendarEvents(connection, now, endDate, 10);

            if (!events || events.length === 0) {
                let rangeDesc = '';
                if (/today/i.test(message)) rangeDesc = "today";
                else if (/tomorrow/i.test(message)) rangeDesc = "tomorrow";
                else if (/this\s+week/i.test(message)) rangeDesc = "this week";
                else {
                    const dateMatch = message.match(/on\s+(\d{4}-\d{2}-\d{2})/i);
                    if (dateMatch) rangeDesc = `on ${dateMatch[1]}`;
                    else rangeDesc = "in the next 7 days";
                }
                return `No upcoming events ${rangeDesc ? `(${rangeDesc})` : ""}.`;
            }

            const eventList = events.map((event: any, idx: number) =>
                `${idx + 1}. **${event.summary}**\n   ${event.start} - ${event.end}${event.description ? `\n   ${event.description}` : ''}`
            ).join('\n\n');

            let rangeDesc = '';
            if (/today/i.test(message)) rangeDesc = " (today)";
            else if (/tomorrow/i.test(message)) rangeDesc = " (tomorrow)";
            else if (/this\s+week/i.test(message)) rangeDesc = " (this week)";
            else {
                const dateMatch = message.match(/on\s+(\d{4}-\d{2}-\d{2})/i);
                if (dateMatch) rangeDesc = ` (on ${dateMatch[1]})`;
            }

            return `**Upcoming Events**${rangeDesc}\n\n${eventList}`;
        } catch (error: any) {
            return `❌ Failed to list events: ${error.message}`;
        }
    }
    
    private static async createCalendarEvent(connection: any, message: string): Promise<string> {
        // Parse the message to extract event data
        // Format: @calendar create "Event Title" on 2024-01-15 at 2pm with user@example.com
        const createMatch = message.match(/create\s+"(.+?)"\s+on\s+(\d{4}-\d{2}-\d{2})(?:\s+at\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?))?\s*(?:with\s+([^\s]+@[^\s]+))?/i);
        
        if (!createMatch) {
            return 'To create an event, use: @calendar create "Event Title" on 2024-01-15 at 2pm with user@example.com';
        }

        const [fullMatch, title, date, timeStr, attendee] = createMatch;
        
        loggingService.info('Parsing calendar event creation', {
            userId: connection.userId,
            title,
            date,
            timeStr,
            attendee,
            fullMatch: fullMatch.substring(0, 100)
        });

        // Compose start and end times
        let start: Date;
        if (timeStr && timeStr.trim()) {
            // Parse time string (e.g., "2pm", "14:00", "2:30pm")
            const normalizedTime = timeStr.trim().toLowerCase();
            const time24Match = normalizedTime.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
            
            if (time24Match) {
                const [, hourStr, minuteStr, meridiem] = time24Match;
                let hours = parseInt(hourStr, 10);
                const minutes = minuteStr ? parseInt(minuteStr, 10) : 0;
                
                // Handle 12-hour format
                if (meridiem) {
                    const isPM = meridiem.toLowerCase() === 'pm';
                    if (isPM && hours < 12) {
                        hours += 12;
                    } else if (!isPM && hours === 12) {
                        hours = 0;
                    }
                }
                
                // Create date with specified time
                start = new Date(`${date}T${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`);
                
                loggingService.info('Parsed event time', {
                    userId: connection.userId,
                    originalTime: timeStr,
                    parsedHours: hours,
                    parsedMinutes: minutes,
                    meridiem: meridiem || 'none',
                    startTime: start.toISOString()
                });
            } else {
                // Fallback to 9 AM if parsing fails
                start = new Date(`${date}T09:00:00`);
                loggingService.warn('Failed to parse time, using default 9 AM', {
                    userId: connection.userId,
                    timeStr
                });
            }
        } else {
            // No time specified, default to 9 AM
            start = new Date(`${date}T09:00:00`);
        }

        // Set end time to 1 hour later
        const end = new Date(start.getTime() + 60 * 60 * 1000);

        // Prepare attendees as string array
        const attendees = attendee ? [attendee.trim()] : [];

        try {
            const event = await GoogleService.createCalendarEvent(
                connection,
                title,
                start,
                end,
                undefined, // description
                attendees.length > 0 ? attendees : undefined
            );

            loggingService.info('Calendar event created successfully', {
                userId: connection.userId,
                eventId: event?.eventId,
                title,
                date,
                hasAttendees: attendees.length > 0
            });

            // Format response message
            const timeDisplay = timeStr ? ` at ${timeStr.trim()}` : '';
            const attendeeDisplay = attendee ? ` Invited: ${attendee.trim()}.` : '';
            const linkDisplay = event?.eventLink ? `\n\n[📅 View in Google Calendar](${event.eventLink})` : '';
            
            return `✅ Event "${title}" created for ${date}${timeDisplay}.${attendeeDisplay}${linkDisplay}`;
        } catch (error: any) {
            loggingService.error('Failed to create calendar event', {
                userId: connection.userId,
                error: error.message,
                title,
                date,
                timeStr,
                attendee
            });
            return `❌ Failed to create event: ${error.message}`;
        }
    }
    
    private static listCalendarActions(): string {
        return `**Calendar Commands**\n\n` +
               `• **@calendar list** - List upcoming events\n` +
               `• **@calendar events today** - Show today's events\n` +
               `• **@calendar create "[title]" on [date] at [time]** - Create event\n\n` +
               `Examples:\n` +
               `• @calendar list events this week\n` +
               `• @calendar create "Team Meeting" on 2024-01-15 at 2pm`;
    }
    
    // ==================== Drive Actions ====================
    
    private static async listDriveFiles(connection: any, message: string): Promise<string> {
        // Optionally support query via "@drive list [query]"
        // If message contains a query after "@drive list", use it to filter files
        const match = message.match(/@drive\s+list\s+(.+)/i);
        const userQuery = match && match[1] ? match[1].trim() : '';
        let queryOptions: { pageSize: number, query?: string } = { pageSize: 10 };

        if (userQuery) {
            // Search files based on user query
            queryOptions.query = `name contains '${userQuery}' or fullText contains '${userQuery}'`;
        }

        try {
            const { files } = await GoogleService.listDriveFiles(connection, queryOptions);

            if (!files || files.length === 0) {
                return userQuery
                    ? `No files found in your Drive matching "${userQuery}".`
                    : 'No files found in your Drive.';
            }

            const fileList = files.map((file: any, idx: number) =>
                `${idx + 1}. **${file.name}** (${file.mimeType})`
            ).join('\n');

            return userQuery
                ? `**Drive Files matching "${userQuery}"**\n\n${fileList}\n\n${files.length === 10 ? 'Open Drive viewer to see more files.' : ''}`
                : `**Recent Drive Files**\n\n${fileList}\n\n${files.length === 10 ? 'Open Drive viewer to see more files.' : ''}`;
        } catch (error: any) {
            return `❌ Failed to list files: ${error.message}`;
        }
    }
    
    private static async searchDriveFiles(connection: any, message: string): Promise<string> {
        const query = message.replace(/@drive\s+search\s+/i, '').trim();
        
        if (!query) {
            return 'Please specify a search query. Example: @drive search budget reports';
        }
        
        try {
            const { files } = await GoogleService.listDriveFiles(connection, { 
                pageSize: 10,
                query: `name contains '${query}' or fullText contains '${query}'`
            });
            
            if (!files || files.length === 0) {
                return `No files found matching "${query}"`;
            }
            
            const fileList = files.map((file: any, idx: number) => 
                `${idx + 1}. **${file.name}** (${file.mimeType})`
            ).join('\n');
            
            return `**Search Results for "${query}"**\n\n${fileList}`;
        } catch (error: any) {
            return `❌ Failed to search files: ${error.message}`;
        }
    }
    
    private static listDriveActions(): string {
        return `**Drive Commands**\n\n` +
               `• **@drive list** - List recent files\n` +
               `• **@drive search [query]** - Search for files\n` +
               `• **@drive folder [name]** - Create folder\n\n` +
               `Examples:\n` +
               `• @drive search quarterly reports\n` +
               `• @drive list recent files`;
    }
    
    // ==================== Sheets Actions ====================
    
    private static async listSpreadsheets(connection: any): Promise<string> {
        try {
            const sheets = await GoogleService.listSpreadsheets(connection);
            
            if (!sheets || sheets.length === 0) {
                return 'No spreadsheets found.';
            }
            
            const sheetList = sheets.slice(0, 10).map((sheet: any, idx: number) => 
                `${idx + 1}. **${sheet.name}**`
            ).join('\n');
            
            return `**Your Spreadsheets**\n\n${sheetList}`;
        } catch (error: any) {
            return `❌ Failed to list spreadsheets: ${error.message}`;
        }
    }
    
    private static listSheetsActions(): string {
        return `**Sheets Commands**\n\n` +
               `• **@sheets list** - List your spreadsheets\n` +
               `• **@sheets create [title]** - Create new sheet\n` +
               `• **@sheets export [sheet-id]** - Export to CSV\n\n` +
               `Examples:\n` +
               `• @sheets list\n` +
               `• @sheets create "Q4 Budget"`;
    }
    
    // ==================== Docs Actions ====================
    
    private static async listDocuments(connection: any): Promise<string> {
        try {
            const docs = await GoogleService.listDocuments(connection);
            
            if (!docs || docs.length === 0) {
                return 'No documents found.';
            }
            
            const docList = docs.slice(0, 10).map((doc: any, idx: number) => 
                `${idx + 1}. **${doc.name}**`
            ).join('\n');
            
            return `**Your Documents**\n\n${docList}`;
        } catch (error: any) {
            return `❌ Failed to list documents: ${error.message}`;
        }
    }
    
    private static listDocsActions(): string {
        return `**Docs Commands**\n\n` +
               `• **@docs list** - List your documents\n` +
               `• **@docs create [title]** - Create new document\n\n` +
               `Examples:\n` +
               `• @docs list\n` +
               `• @docs create "Meeting Notes"`;
    }
    
}

