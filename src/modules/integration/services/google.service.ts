/**
 * Google Service for NestJS
 * Provides Google Workspace API operations for integration chat
 */

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  GoogleConnection,
  GoogleConnectionDocument,
} from '../../../schemas/integration/google-connection.schema';

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  modifiedTime: string;
  size?: string;
}

@Injectable()
export class GoogleService {
  constructor(
    private readonly logger: LoggerService,
    @InjectModel(GoogleConnection.name)
    private readonly googleConnectionModel: Model<GoogleConnectionDocument>,
  ) {}

  /**
   * List Drive files with optional query
   */
  async listDriveFiles(
    connectionId: string,
    options: {
      query?: string;
      pageSize?: number;
      orderBy?: string;
    } = {},
  ): Promise<{ files: GoogleDriveFile[] }> {
    try {
      const connection =
        await this.googleConnectionModel.findById(connectionId);
      if (!connection) {
        throw new Error('Google connection not found');
      }

      const accessToken = connection.accessToken;
      if (!accessToken) {
        throw new Error('Google access token not available');
      }

      const params = new URLSearchParams({
        pageSize: (options.pageSize || 50).toString(),
        fields: 'files(id,name,mimeType,webViewLink,modifiedTime,size)',
        orderBy: options.orderBy || 'modifiedTime desc',
      });

      if (options.query) {
        params.append('q', options.query);
      }

      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?${params}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          `Google Drive API error: ${response.status} ${response.statusText}`,
        );
      }

      const data = await response.json();

      const files = data.files.map((file: any) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        webViewLink: file.webViewLink,
        modifiedTime: file.modifiedTime,
        size: file.size,
      }));

      return { files };
    } catch (error) {
      this.logger.error('Failed to list Google Drive files', {
        connectionId,
        options,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * List spreadsheets
   */
  async listSpreadsheets(connectionId: string): Promise<GoogleDriveFile[]> {
    const result = await this.listDriveFiles(connectionId, {
      query: "mimeType='application/vnd.google-apps.spreadsheet'",
      pageSize: 50,
    });
    return result.files;
  }

  /**
   * List documents
   */
  async listDocuments(connectionId: string): Promise<GoogleDriveFile[]> {
    const result = await this.listDriveFiles(connectionId, {
      query: "mimeType='application/vnd.google-apps.document'",
      pageSize: 50,
    });
    return result.files;
  }

  /**
   * List folders
   */
  async listFolders(connectionId: string): Promise<GoogleDriveFile[]> {
    const result = await this.listDriveFiles(connectionId, {
      query: "mimeType='application/vnd.google-apps.folder'",
      pageSize: 50,
    });
    return result.files;
  }

  /**
   * List calendars available to the connected account.
   * Requires calendar.readonly or calendar scope.
   */
  async listCalendars(connectionId: string): Promise<
    Array<{ id: string; summary?: string; primary?: boolean }>
  > {
    try {
      const connection =
        await this.googleConnectionModel.findById(connectionId).select('+accessToken');
      if (!connection) {
        throw new Error('Google connection not found');
      }

      const accessToken = (connection as { accessToken?: string }).accessToken;
      if (!accessToken) {
        throw new Error('Google access token not available');
      }

      const response = await fetch(
        'https://www.googleapis.com/calendar/v3/users/me/calendarList',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          `Google Calendar API error: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as {
        items?: Array<{ id?: string; summary?: string; primary?: boolean }>;
      };
      return (data.items ?? []).map((c) => ({
        id: c.id!,
        summary: c.summary,
        primary: c.primary ?? false,
      }));
    } catch (error) {
      this.logger.error('Failed to list Google calendars', {
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * List calendars for a user by looking up their Google connection.
   */
  async listCalendarsForUser(
    userId: string,
  ): Promise<Array<{ id: string; summary?: string; primary?: boolean }>> {
    const connection = await this.googleConnectionModel
      .findOne({ userId, status: 'active', isActive: true })
      .select('+accessToken')
      .exec();
    if (!connection) {
      return [];
    }
    return this.listCalendars(connection._id.toString());
  }
}
