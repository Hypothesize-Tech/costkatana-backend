import { GoogleService } from '../../google.service';
import { GoogleConnection } from '../../../models/GoogleConnection';
import { loggingService } from '../../logging.service';
import mongoose from 'mongoose';

export interface GoogleTriggerConfig {
    connectionId: string;
    triggerType: 'sheet_change' | 'form_submission' | 'calendar_event' | 'gmail_alert' | 'drive_file_change';
    config: {
        // Sheet triggers
        sheetId?: string;
        cellRange?: string;
        
        // Form triggers
        formId?: string;
        
        // Calendar triggers
        eventKeywords?: string[];
        
        // Gmail triggers
        searchQuery?: string;
        
        // Drive triggers
        folderId?: string;
        fileNamePattern?: string;
    };
}

export interface TriggerResult {
    triggered: boolean;
    data?: any;
    message?: string;
}

export class GoogleTriggersService {
    /**
     * Check if a Google Sheet has changed
     */
    static async checkSheetChange(
        connectionId: string,
        sheetId: string,
        cellRange: string,
        lastCheckValue?: any
    ): Promise<TriggerResult> {
        try {
            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(connectionId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                return { triggered: false, message: 'Connection not found' };
            }

            // Get current values from the sheet using Google Sheets API
            const currentValues = await GoogleService.getSheetValues(
                connection,
                sheetId,
                cellRange
            );

            // If no last check value, store current and don't trigger
            if (!lastCheckValue) {
                loggingService.info('First check of Google Sheet - storing baseline', {
                    connectionId,
                    sheetId,
                    cellRange,
                    currentValues: JSON.stringify(currentValues).substring(0, 100)
                });

                return {
                    triggered: false,
                    data: { currentValues },
                    message: 'Baseline values stored for future comparison'
                };
            }

            // Compare current values with last check
            const hasChanged = JSON.stringify(currentValues) !== JSON.stringify(lastCheckValue);

            if (hasChanged) {
                // Calculate specific changes
                const changes = this.calculateSheetChanges(lastCheckValue, currentValues);

                loggingService.info('Google Sheet changes detected', {
                    connectionId,
                    sheetId,
                    cellRange,
                    changesCount: changes.length
                });

                return {
                    triggered: true,
                    data: {
                        previousValues: lastCheckValue,
                        currentValues,
                        changes,
                        cellRange,
                        sheetId
                    },
                    message: `Detected ${changes.length} cell change(s) in range ${cellRange}`
                };
            }

            loggingService.debug('No changes detected in Google Sheet', {
                connectionId,
                sheetId,
                cellRange
            });

            return {
                triggered: false,
                data: { currentValues },
                message: 'No changes detected'
            };
        } catch (error: any) {
            loggingService.error('Failed to check sheet change', {
                error: error.message,
                stack: error.stack,
                connectionId,
                sheetId,
                cellRange
            });
            return { triggered: false, message: error.message };
        }
    }

    /**
     * Calculate specific cell changes between two sheet value sets
     */
    private static calculateSheetChanges(oldValues: any[][], newValues: any[][]): Array<{
        row: number;
        col: number;
        oldValue: any;
        newValue: any;
    }> {
        const changes: Array<{ row: number; col: number; oldValue: any; newValue: any }> = [];

        const maxRows = Math.max(oldValues?.length || 0, newValues?.length || 0);
        
        for (let row = 0; row < maxRows; row++) {
            const oldRow = oldValues?.[row] || [];
            const newRow = newValues?.[row] || [];
            const maxCols = Math.max(oldRow.length, newRow.length);

            for (let col = 0; col < maxCols; col++) {
                const oldValue = oldRow[col];
                const newValue = newRow[col];

                if (oldValue !== newValue) {
                    changes.push({
                        row: row + 1, // 1-indexed for user readability
                        col: col + 1, // 1-indexed for user readability
                        oldValue,
                        newValue
                    });
                }
            }
        }

        return changes;
    }

    /**
     * Check for new form submissions
     */
    static async checkFormSubmission(
        connectionId: string,
        formId: string,
        lastCheckTime: Date
    ): Promise<TriggerResult> {
        try {
            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(connectionId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                return { triggered: false, message: 'Connection not found' };
            }

            const responses = await GoogleService.getFormResponses(connection, formId);

            // Filter responses since last check
            const newResponses = responses.filter((response: any) => {
                const responseTime = new Date(response.lastSubmittedTime || response.createTime);
                return responseTime > lastCheckTime;
            });

            loggingService.info('Checked Google Form for submissions', {
                connectionId,
                formId,
                newResponses: newResponses.length
            });

            return {
                triggered: newResponses.length > 0,
                data: newResponses,
                message: `Found ${newResponses.length} new form submissions`
            };
        } catch (error: any) {
            loggingService.error('Failed to check form submissions', {
                error: error.message,
                connectionId,
                formId
            });
            return { triggered: false, message: error.message };
        }
    }

    /**
     * Check for calendar events matching criteria
     */
    static async checkCalendarEvent(
        connectionId: string,
        eventKeywords: string[],
        startDate?: Date,
        endDate?: Date
    ): Promise<TriggerResult> {
        try {
            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(connectionId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                return { triggered: false, message: 'Connection not found' };
            }

            const events = await GoogleService.listCalendarEvents(
                connection,
                startDate,
                endDate,
                50
            );

            // Filter events by keywords
            const matchingEvents = events.filter(event => 
                eventKeywords.some(keyword => 
                    event.summary?.toLowerCase().includes(keyword.toLowerCase()) ||
                    event.description?.toLowerCase().includes(keyword.toLowerCase())
                )
            );

            loggingService.info('Checked Calendar for events', {
                connectionId,
                keywords: eventKeywords,
                matchingEvents: matchingEvents.length
            });

            return {
                triggered: matchingEvents.length > 0,
                data: matchingEvents,
                message: `Found ${matchingEvents.length} matching calendar events`
            };
        } catch (error: any) {
            loggingService.error('Failed to check calendar events', {
                error: error.message,
                connectionId
            });
            return { triggered: false, message: error.message };
        }
    }

    /**
     * Check Gmail for new alerts/messages
     */
    static async checkGmailAlert(
        connectionId: string,
        searchQuery: string,
        lastCheckTime: Date
    ): Promise<TriggerResult> {
        try {
            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(connectionId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                return { triggered: false, message: 'Connection not found' };
            }

            // Add date filter to search query
            const afterTimestamp = Math.floor(lastCheckTime.getTime() / 1000);
            const fullQuery = `${searchQuery} after:${afterTimestamp}`;

            const messages = await GoogleService.searchGmailMessages(
                connection,
                fullQuery,
                20
            );

            loggingService.info('Checked Gmail for alerts', {
                connectionId,
                searchQuery,
                newMessages: messages.length
            });

            return {
                triggered: messages.length > 0,
                data: messages,
                message: `Found ${messages.length} new messages matching query`
            };
        } catch (error: any) {
            loggingService.error('Failed to check Gmail alerts', {
                error: error.message,
                connectionId,
                searchQuery
            });
            return { triggered: false, message: error.message };
        }
    }

    /**
     * Check Drive for file changes
     */
    static async checkDriveFileChange(
        connectionId: string,
        folderId?: string,
        fileNamePattern?: string,
        lastCheckTime?: Date
    ): Promise<TriggerResult> {
        try {
            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(connectionId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                return { triggered: false, message: 'Connection not found' };
            }

            let query = '';
            if (folderId) {
                query += `'${folderId}' in parents`;
            }
            if (fileNamePattern) {
                query += (query ? ' and ' : '') + `name contains '${fileNamePattern}'`;
            }
            if (lastCheckTime) {
                const modifiedAfter = lastCheckTime.toISOString();
                query += (query ? ' and ' : '') + `modifiedTime > '${modifiedAfter}'`;
            }

            const { files } = await GoogleService.listDriveFiles(connection, {
                query: query || undefined,
                pageSize: 50
            });

            loggingService.info('Checked Drive for file changes', {
                connectionId,
                folderId,
                fileNamePattern,
                changedFiles: files.length
            });

            return {
                triggered: files.length > 0,
                data: files,
                message: `Found ${files.length} changed files`
            };
        } catch (error: any) {
            loggingService.error('Failed to check Drive file changes', {
                error: error.message,
                connectionId
            });
            return { triggered: false, message: error.message };
        }
    }

    /**
     * Execute a Google trigger based on config
     */
    static async executeTrigger(
        triggerConfig: GoogleTriggerConfig,
        lastExecutionTime?: Date
    ): Promise<TriggerResult> {
        const { connectionId, triggerType, config } = triggerConfig;

        switch (triggerType) {
            case 'sheet_change':
                return this.checkSheetChange(
                    connectionId,
                    config.sheetId!,
                    config.cellRange!
                );

            case 'form_submission':
                return this.checkFormSubmission(
                    connectionId,
                    config.formId!,
                    lastExecutionTime || new Date(Date.now() - 3600000) // Default: 1 hour ago
                );

            case 'calendar_event':
                return this.checkCalendarEvent(
                    connectionId,
                    config.eventKeywords || [],
                    lastExecutionTime,
                    new Date(Date.now() + 86400000 * 7) // Next 7 days
                );

            case 'gmail_alert':
                return this.checkGmailAlert(
                    connectionId,
                    config.searchQuery || '',
                    lastExecutionTime || new Date(Date.now() - 3600000)
                );

            case 'drive_file_change':
                return this.checkDriveFileChange(
                    connectionId,
                    config.folderId,
                    config.fileNamePattern,
                    lastExecutionTime
                );

            default:
                return {
                    triggered: false,
                    message: `Unknown trigger type: ${triggerType}`
                };
        }
    }
}

