import { GoogleService } from '../../google.service';
import { GoogleIntegrationService } from '../../googleIntegration.service';
import { GoogleConnection } from '../../../models/GoogleConnection';
import { loggingService } from '../../logging.service';
import mongoose from 'mongoose';

export interface GoogleActionConfig {
    connectionId: string;
    actionType: 
        | 'send_email'
        | 'create_calendar_event'
        | 'export_to_sheets'
        | 'create_doc_report'
        | 'upload_to_drive'
        | 'share_file';
    config: {
        // Email action
        to?: string | string[];
        subject?: string;
        body?: string;
        isHtml?: boolean;
        
        // Calendar action
        eventSummary?: string;
        eventStart?: Date;
        eventEnd?: Date;
        eventDescription?: string;
        attendees?: string[];
        
        // Export/Report actions
        title?: string;
        data?: any;
        templateType?: string;
        
        // Drive actions
        fileName?: string;
        fileContent?: string;
        mimeType?: string;
        folderId?: string;
        fileId?: string;
        shareWith?: string;
        role?: 'reader' | 'writer' | 'commenter';
        
        // Form action
        formTitle?: string;
        formDescription?: string;
        questions?: Array<{
            text: string;
            type: 'TEXT' | 'PARAGRAPH_TEXT' | 'MULTIPLE_CHOICE' | 'CHECKBOX' | 'DROPDOWN';
            options?: string[];
        }>;
    };
}

export interface ActionResult {
    success: boolean;
    data?: any;
    message?: string;
    error?: string;
}

export class GoogleActionsService {

    /**
     * Export data to Google Sheets
     */
    static async exportToSheets(
        connectionId: string,
        userId: string,
        title: string,
        data: any
    ): Promise<ActionResult> {
        try {
            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(connectionId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                return { success: false, error: 'Connection not found' };
            }

            let result;

            // If custom data is provided, create a custom spreadsheet
            if (data && Array.isArray(data)) {
                // Create new spreadsheet with custom data
                const spreadsheet = await GoogleService.createSpreadsheet(connection, title || 'Automation Export');
                
                // Convert data to 2D array format if needed
                const values = this.formatDataForSheets(data);
                
                // Update the sheet with data
                await GoogleService.updateSheetValues(
                    connection,
                    spreadsheet.spreadsheetId,
                    'Sheet1!A1',
                    values
                );

                result = {
                    spreadsheetId: spreadsheet.spreadsheetId,
                    spreadsheetUrl: spreadsheet.spreadsheetUrl
                };

                loggingService.info('Exported custom data to Sheets via automation', {
                    connectionId,
                    title,
                    spreadsheetId: result.spreadsheetId,
                    rowCount: values.length
                });
            } else {
                // Use cost data export if no custom data provided
                result = await GoogleIntegrationService.exportCostDataToSheets(connection, {
                    userId,
                    connectionId,
                    template: 'MONTHLY_SPEND_BY_MODEL'
                });

                loggingService.info('Exported cost data to Sheets via automation', {
                    connectionId,
                    spreadsheetId: result.spreadsheetId
                });
            }

            return {
                success: true,
                data: result,
                message: `Data exported to Google Sheets successfully: ${title || 'Cost Data'}`
            };
        } catch (error: any) {
            loggingService.error('Failed to export to Sheets via automation', {
                error: error.message,
                stack: error.stack,
                connectionId,
                title
            });
            return { success: false, error: error.message };
        }
    }

    /**
     * Format data for Google Sheets
     */
    private static formatDataForSheets(data: any): any[][] {
        if (!data || !Array.isArray(data)) {
            return [['No data']];
        }

        // If data is already 2D array, return as-is
        if (Array.isArray(data[0])) {
            return data;
        }

        // If data is array of objects, convert to 2D array with headers
        if (typeof data[0] === 'object' && data[0] !== null) {
            const headers = Object.keys(data[0]);
            const rows = data.map(item => headers.map(key => item[key]));
            return [headers, ...rows];
        }

        // If data is array of primitives, create single column
        return data.map(item => [item]);
    }

    /**
     * Create Google Doc report
     */
    static async createDocReport(
        connectionId: string,
        userId: string,
        title: string,
        data?: any
    ): Promise<ActionResult> {
        try {
            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(connectionId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                return { success: false, error: 'Connection not found' };
            }

            let result;

            // If custom data is provided, create a custom document
            if (data && typeof data === 'object') {
                // Create new document with custom title
                const doc = await GoogleService.createDocument(connection, title || 'Automation Report');
                
                // Format and insert content based on data structure
                const content = this.formatDataForDocs(data, title);
                
                // Insert content into document
                await GoogleService.insertTextInDocument(
                    connection,
                    doc.documentId,
                    content
                );

                result = {
                    documentId: doc.documentId,
                    documentUrl: doc.documentUrl
                };

                loggingService.info('Created custom Doc report via automation', {
                    connectionId,
                    title,
                    documentId: result.documentId,
                    dataKeys: Object.keys(data).length
                });
            } else {
                // Use cost report if no custom data provided
                result = await GoogleIntegrationService.createCostReportInDocs(connection, {
                    userId,
                    connectionId,
                    includeTopModels: true,
                    includeRecommendations: true
                });

                loggingService.info('Created cost report Doc via automation', {
                    connectionId,
                    documentId: result.documentId
                });
            }

            return {
                success: true,
                data: result,
                message: `Google Doc report created successfully: ${title || 'Cost Report'}`
            };
        } catch (error: any) {
            loggingService.error('Failed to create Doc report via automation', {
                error: error.message,
                stack: error.stack,
                connectionId,
                title
            });
            return { success: false, error: error.message };
        }
    }

    /**
     * Format data for Google Docs
     */
    private static formatDataForDocs(data: any, title?: string): string {
        let content = '';

        // Add title if provided
        if (title) {
            content += `${title}\n\n`;
        }

        // Add timestamp
        content += `Generated: ${new Date().toLocaleString()}\n\n`;

        // Format data based on type
        if (Array.isArray(data)) {
            content += `Records: ${data.length}\n\n`;
            data.forEach((item, index) => {
                content += `${index + 1}. ${JSON.stringify(item, null, 2)}\n\n`;
            });
        } else if (typeof data === 'object') {
            Object.entries(data).forEach(([key, value]) => {
                content += `${key}: ${typeof value === 'object' ? JSON.stringify(value, null, 2) : value}\n\n`;
            });
        } else {
            content += String(data);
        }

        return content;
    }

    /**
     * Upload file to Drive
     */
    static async uploadToDrive(
        connectionId: string,
        fileName: string,
        fileContent: string | Buffer,
        mimeType: string,
        folderId?: string
    ): Promise<ActionResult> {
        try {
            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(connectionId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                return { success: false, error: 'Connection not found' };
            }

            const result = await GoogleService.uploadFileToDrive(
                connection,
                fileName,
                mimeType,
                fileContent,
                folderId
            );

            loggingService.info('Uploaded file to Drive via automation', {
                connectionId,
                fileName,
                fileId: result.fileId
            });

            return {
                success: true,
                data: result,
                message: 'File uploaded to Google Drive successfully'
            };
        } catch (error: any) {
            loggingService.error('Failed to upload to Drive via automation', {
                error: error.message,
                connectionId
            });
            return { success: false, error: error.message };
        }
    }

    /**
     * Share Drive file
     */
    static async shareFile(
        connectionId: string,
        fileId: string,
        shareWith: string,
        role: 'reader' | 'writer' | 'commenter' = 'reader'
    ): Promise<ActionResult> {
        try {
            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(connectionId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                return { success: false, error: 'Connection not found' };
            }

            const result = await GoogleService.shareFile(
                connection,
                fileId,
                shareWith,
                role
            );

            loggingService.info('Shared Drive file via automation', {
                connectionId,
                fileId,
                shareWith,
                role
            });

            return {
                success: true,
                data: result,
                message: 'File shared successfully'
            };
        } catch (error: any) {
            loggingService.error('Failed to share file via automation', {
                error: error.message,
                connectionId
            });
            return { success: false, error: error.message };
        }
    }

    /**
     * Execute a Google action based on config
     */
    static async executeAction(
        actionConfig: GoogleActionConfig,
        userId: string
    ): Promise<ActionResult> {
        const { connectionId, actionType, config } = actionConfig;

        switch (actionType) {
            case 'send_email':
                // Gmail disabled - return error
                return {
                    success: false,
                    error: 'Gmail features disabled - using drive.file scope only'
                };

            case 'create_calendar_event':
                // Calendar disabled - return error
                return {
                    success: false,
                    error: 'Calendar features disabled - using drive.file scope only'
                };

            case 'export_to_sheets':
                return this.exportToSheets(
                    connectionId,
                    userId,
                    config.title!,
                    config.data
                );

            case 'create_doc_report':
                return this.createDocReport(
                    connectionId,
                    userId,
                    config.title!,
                    config.data
                );

            case 'upload_to_drive':
                return this.uploadToDrive(
                    connectionId,
                    config.fileName!,
                    config.fileContent!,
                    config.mimeType!,
                    config.folderId
                );

            case 'share_file':
                return this.shareFile(
                    connectionId,
                    config.fileId!,
                    config.shareWith!,
                    config.role
                );

            default:
                return {
                    success: false,
                    error: `Unknown action type: ${actionType}`
                };
        }
    }
}

