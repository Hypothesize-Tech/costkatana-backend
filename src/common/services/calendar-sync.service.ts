/**
 * Calendar Sync Service for NestJS
 * Synchronizes budget alerts and events with external calendar systems
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface CalendarProvider {
  providerId: string;
  name: string;
  type: 'google' | 'outlook' | 'ical' | 'custom';
  isConnected: boolean;
  lastSync: Date;
  config: {
    calendarId?: string;
    accessToken?: string;
    refreshToken?: string;
    syncEnabled: boolean;
    syncDirection: 'one-way' | 'two-way';
    eventPrefix?: string;
  };
}

export interface SyncedEvent {
  eventId: string;
  externalId: string;
  providerId: string;
  title: string;
  description: string;
  startDate: Date;
  endDate?: Date;
  lastSynced: Date;
  syncStatus: 'synced' | 'modified' | 'conflict' | 'error';
}

/** Google Calendar API event shape (minimal for sync) */
interface GoogleCalendarEvent {
  id?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

@Injectable()
export class CalendarSyncService implements OnModuleInit {
  private readonly logger = new Logger(CalendarSyncService.name);

  private providers: Map<string, CalendarProvider> = new Map();
  private syncedEvents: Map<string, SyncedEvent> = new Map();
  private syncInterval?: NodeJS.Timeout;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.initializeProviders();
    this.startSyncScheduler();
  }

  /**
   * Initialize calendar providers
   */
  private initializeProviders(): void {
    // Google Calendar
    if (this.configService.get<string>('GOOGLE_CALENDAR_CLIENT_ID')) {
      this.providers.set('google', {
        providerId: 'google',
        name: 'Google Calendar',
        type: 'google',
        isConnected: false,
        lastSync: new Date(0),
        config: {
          syncEnabled: this.configService.get<boolean>(
            'GOOGLE_CALENDAR_SYNC_ENABLED',
            false,
          ),
          syncDirection: 'two-way',
          eventPrefix: '[Cost Katana]',
        },
      });
    }

    // Outlook Calendar
    if (this.configService.get<string>('OUTLOOK_CLIENT_ID')) {
      this.providers.set('outlook', {
        providerId: 'outlook',
        name: 'Outlook Calendar',
        type: 'outlook',
        isConnected: false,
        lastSync: new Date(0),
        config: {
          syncEnabled: this.configService.get<boolean>(
            'OUTLOOK_CALENDAR_SYNC_ENABLED',
            false,
          ),
          syncDirection: 'two-way',
          eventPrefix: '[Cost Katana]',
        },
      });
    }

    this.logger.log('Calendar providers initialized', {
      count: this.providers.size,
    });
  }

  /**
   * Connect to a calendar provider
   */
  async connectProvider(providerId: string, authCode: string): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }

    try {
      // Exchange auth code for tokens (implementation depends on provider)
      const tokens = await this.exchangeAuthCode(providerId, authCode);

      provider.config.accessToken = tokens.accessToken;
      provider.config.refreshToken = tokens.refreshToken;
      provider.isConnected = true;

      // Initial sync
      await this.syncProvider(providerId);

      this.logger.log('Calendar provider connected', { providerId });
    } catch (error) {
      this.logger.error('Failed to connect calendar provider', {
        providerId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Sync events with a provider
   */
  async syncProvider(providerId: string): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider || !provider.isConnected) {
      throw new Error(`Provider ${providerId} not connected`);
    }

    try {
      this.logger.log('Starting calendar sync', { providerId });

      // Get events from external calendar
      const externalEvents = await this.fetchExternalEvents(provider);

      // Get local events to sync
      const localEvents = this.getLocalEventsForSync();

      // Sync events
      this.performSync(provider, externalEvents);

      provider.lastSync = new Date();

      this.logger.log('Calendar sync completed', {
        providerId,
        externalEvents: externalEvents.length,
        localEvents: localEvents.length,
      });
    } catch (error) {
      this.logger.error('Calendar sync failed', {
        providerId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create event in external calendar
   */
  async createExternalEvent(
    providerId: string,
    event: {
      title: string;
      description: string;
      startDate: Date;
      endDate?: Date;
    },
  ): Promise<string> {
    const provider = this.providers.get(providerId);
    if (!provider || !provider.isConnected) {
      throw new Error(`Provider ${providerId} not connected`);
    }

    try {
      const externalId = await this.createEventInProvider(provider, event);

      const syncedEvent: SyncedEvent = {
        eventId: `local_${Date.now()}`,
        externalId,
        providerId,
        title: event.title,
        description: event.description,
        startDate: event.startDate,
        endDate: event.endDate,
        lastSynced: new Date(),
        syncStatus: 'synced',
      };

      this.syncedEvents.set(syncedEvent.eventId, syncedEvent);

      this.logger.log('External calendar event created', {
        providerId,
        externalId,
        title: event.title,
      });

      return externalId;
    } catch (error) {
      this.logger.error('Failed to create external calendar event', {
        providerId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update event in external calendar
   */
  async updateExternalEvent(
    providerId: string,
    externalId: string,
    updates: Partial<{
      title: string;
      description: string;
      startDate: Date;
      endDate: Date;
    }>,
  ): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider || !provider.isConnected) {
      throw new Error(`Provider ${providerId} not connected`);
    }

    try {
      await this.updateEventInProvider(provider, externalId, updates);

      // Update sync status
      const syncedEvent = Array.from(this.syncedEvents.values()).find(
        (e) => e.externalId === externalId && e.providerId === providerId,
      );

      if (syncedEvent) {
        syncedEvent.lastSynced = new Date();
        syncedEvent.syncStatus = 'synced';
      }

      this.logger.log('External calendar event updated', {
        providerId,
        externalId,
      });
    } catch (error) {
      this.logger.error('Failed to update external calendar event', {
        providerId,
        externalId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete event from external calendar
   */
  async deleteExternalEvent(
    providerId: string,
    externalId: string,
  ): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider || !provider.isConnected) {
      throw new Error(`Provider ${providerId} not connected`);
    }

    try {
      await this.deleteEventFromProvider(provider, externalId);

      // Remove from synced events
      const syncedEvent = Array.from(this.syncedEvents.values()).find(
        (e) => e.externalId === externalId && e.providerId === providerId,
      );

      if (syncedEvent) {
        this.syncedEvents.delete(syncedEvent.eventId);
      }

      this.logger.log('External calendar event deleted', {
        providerId,
        externalId,
      });
    } catch (error) {
      this.logger.error('Failed to delete external calendar event', {
        providerId,
        externalId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get connected providers
   */
  getConnectedProviders(): CalendarProvider[] {
    return Array.from(this.providers.values()).filter((p) => p.isConnected);
  }

  /**
   * Get sync status
   */
  getSyncStatus(): {
    providers: Array<{
      providerId: string;
      isConnected: boolean;
      lastSync: Date;
      syncedEvents: number;
    }>;
    totalSyncedEvents: number;
    lastGlobalSync: Date;
  } {
    const providers = Array.from(this.providers.values()).map((provider) => ({
      providerId: provider.providerId,
      isConnected: provider.isConnected,
      lastSync: provider.lastSync,
      syncedEvents: Array.from(this.syncedEvents.values()).filter(
        (e) => e.providerId === provider.providerId,
      ).length,
    }));

    const totalSyncedEvents = this.syncedEvents.size;
    const lastGlobalSync = new Date(
      Math.max(
        ...Array.from(this.providers.values())
          .map((p) => p.lastSync.getTime())
          .filter((time) => time > 0),
      ),
    );

    return {
      providers,
      totalSyncedEvents,
      lastGlobalSync:
        lastGlobalSync.getTime() > 0 ? lastGlobalSync : new Date(0),
    };
  }

  // Private methods for provider-specific implementations
  private async exchangeAuthCode(
    providerId: string,
    authCode: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn?: number;
    tokenType?: string;
  }> {
    if (providerId === 'google') {
      const clientId = this.configService.get<string>(
        'GOOGLE_CALENDAR_CLIENT_ID',
      );
      const clientSecret = this.configService.get<string>(
        'GOOGLE_CALENDAR_CLIENT_SECRET',
      );
      const redirectUri = this.configService.getOrThrow<string>(
        'GOOGLE_CALENDAR_REDIRECT_URI',
      );

      if (!clientId || !clientSecret) {
        throw new Error(
          'Google Calendar OAuth not configured. Please set GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET environment variables.',
        );
      }

      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: authCode,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Google token exchange failed: ${res.status} ${err}`);
      }

      const data = (await res.json()) as {
        access_token: string;
        refresh_token?: string;
      };
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? '',
      };
    }

    if (providerId === 'outlook') {
      // Outlook/Microsoft Graph API OAuth implementation
      const tokenEndpoint =
        'https://login.microsoftonline.com/common/oauth2/v2.0/token';

      const params = new URLSearchParams({
        client_id: process.env.OUTLOOK_CLIENT_ID || '',
        client_secret: process.env.OUTLOOK_CLIENT_SECRET || '',
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: process.env.OUTLOOK_REDIRECT_URI || '',
        scope:
          'https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/Calendars.ReadWrite offline_access',
      });

      try {
        const response = await fetch(tokenEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            `Outlook OAuth failed: ${response.status} ${errorData.error_description || response.statusText}`,
          );
        }

        const tokenData = (await response.json()) as {
          access_token: string;
          refresh_token: string;
          expires_in?: number;
          token_type?: string;
        };

        return {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          ...(tokenData.expires_in !== undefined && {
            expiresIn: tokenData.expires_in,
          }),
          ...(tokenData.token_type !== undefined && {
            tokenType: tokenData.token_type,
          }),
        };
      } catch (error) {
        this.logger.error('Outlook OAuth token exchange failed', {
          error: error instanceof Error ? error.message : String(error),
          providerId,
        });
        throw new Error(
          'Failed to exchange Outlook authorization code for access token',
        );
      }
    }

    return {
      accessToken: `ext_${providerId}_${Date.now()}`,
      refreshToken: `ext_${providerId}_refresh_${Date.now()}`,
    };
  }

  private async fetchExternalEvents(
    provider: CalendarProvider,
  ): Promise<GoogleCalendarEvent[]> {
    if (provider.type === 'google' && provider.config.accessToken) {
      const calendarId = provider.config.calendarId ?? 'primary';
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?maxResults=250&singleEvents=true&orderBy=startTime`,
        {
          headers: { Authorization: `Bearer ${provider.config.accessToken}` },
        },
      );
      if (!res.ok) {
        this.logger.warn('Google Calendar list failed', { status: res.status });
        return [];
      }
      const data = (await res.json()) as { items?: GoogleCalendarEvent[] };
      return data.items ?? [];
    }

    if (provider.type === 'outlook' && provider.config.accessToken) {
      try {
        // Microsoft Graph API for Outlook Calendar
        const calendarId = provider.config.calendarId ?? 'primary';
        const endpoint =
          calendarId === 'primary'
            ? 'https://graph.microsoft.com/v1.0/me/events'
            : `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events`;

        const res = await fetch(
          `${endpoint}?$top=250&$orderby=start/dateTime`,
          {
            headers: {
              Authorization: `Bearer ${provider.config.accessToken}`,
              'Content-Type': 'application/json',
            },
          },
        );

        if (!res.ok) {
          this.logger.warn('Outlook Calendar fetch failed', {
            status: res.status,
            calendarId,
            endpoint,
          });
          return [];
        }

        const data = await res.json();
        const outlookEvents = data.value || [];

        // Convert Outlook events to Google Calendar event format for consistency
        return outlookEvents.map((event: any) => ({
          id: event.id,
          summary: event.subject || 'No title',
          description: event.body?.content || '',
          start: {
            dateTime: event.start?.dateTime,
            timeZone: event.start?.timeZone,
          },
          end: {
            dateTime: event.end?.dateTime,
            timeZone: event.end?.timeZone,
          },
          status: event.showAs === 'free' ? 'confirmed' : 'confirmed',
          created: event.createdDateTime,
          updated: event.lastModifiedDateTime,
        }));
      } catch (error) {
        this.logger.error('Outlook Calendar fetch error', {
          error: error instanceof Error ? error.message : String(error),
          providerId: provider.providerId,
        });
        return [];
      }
    }

    return [];
  }

  private getLocalEventsForSync(): Array<{
    eventId: string;
    externalId: string;
    providerId: string;
    title: string;
    startDate: Date;
    endDate?: Date;
  }> {
    return Array.from(this.syncedEvents.values()).map((e) => ({
      eventId: e.eventId,
      externalId: e.externalId,
      providerId: e.providerId,
      title: e.title,
      startDate: e.startDate,
      endDate: e.endDate,
    }));
  }

  private performSync(
    provider: CalendarProvider,
    externalEvents: GoogleCalendarEvent[],
  ): void {
    // Merge strategy: external events are the source of truth when two-way; we just track what we pushed
    for (const ev of externalEvents) {
      const id = ev.id;
      const existing = Array.from(this.syncedEvents.values()).find(
        (e) => e.providerId === provider.providerId && e.externalId === id,
      );
      if (!existing && id) {
        const startDate = ev.start?.dateTime
          ? new Date(ev.start.dateTime)
          : new Date(ev.start?.date ?? 0);
        const endDate = ev.end?.dateTime
          ? new Date(ev.end.dateTime)
          : undefined;
        this.syncedEvents.set(`ext_${id}`, {
          eventId: `ext_${id}`,
          externalId: id,
          providerId: provider.providerId,
          title: ev.summary ?? '',
          description: ev.description ?? '',
          startDate,
          endDate,
          lastSynced: new Date(),
          syncStatus: 'synced',
        });
      }
    }
  }

  private async createEventInProvider(
    provider: CalendarProvider,
    event: {
      title: string;
      description: string;
      startDate: Date;
      endDate?: Date;
    },
  ): Promise<string> {
    if (provider.type === 'google' && provider.config.accessToken) {
      const calendarId = provider.config.calendarId ?? 'primary';
      const prefix = provider.config.eventPrefix ?? '';
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${provider.config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            summary: prefix + event.title,
            description: event.description,
            start: { dateTime: event.startDate.toISOString(), timeZone: 'UTC' },
            end: event.endDate
              ? { dateTime: event.endDate.toISOString(), timeZone: 'UTC' }
              : {
                  dateTime: new Date(
                    event.startDate.getTime() + 3600000,
                  ).toISOString(),
                  timeZone: 'UTC',
                },
          }),
        },
      );
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Google Calendar create failed: ${res.status} ${err}`);
      }
      const data = (await res.json()) as { id: string };
      return data.id;
    }
    return `ext_${Date.now()}`;
  }

  private async updateEventInProvider(
    provider: CalendarProvider,
    externalId: string,
    updates: Partial<{
      title: string;
      description: string;
      startDate: Date;
      endDate: Date;
    }>,
  ): Promise<void> {
    if (provider.type === 'google' && provider.config.accessToken) {
      const calendarId = provider.config.calendarId ?? 'primary';
      const body: Record<string, unknown> = {};
      if (updates.title) body.summary = updates.title;
      if (updates.description) body.description = updates.description;
      if (updates.startDate)
        body.start = {
          dateTime: updates.startDate.toISOString(),
          timeZone: 'UTC',
        };
      if (updates.endDate)
        body.end = { dateTime: updates.endDate.toISOString(), timeZone: 'UTC' };
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalId)}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${provider.config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Google Calendar update failed: ${res.status} ${err}`);
      }
    }
  }

  private async deleteEventFromProvider(
    provider: CalendarProvider,
    externalId: string,
  ): Promise<void> {
    if (provider.type === 'google' && provider.config.accessToken) {
      const calendarId = provider.config.calendarId ?? 'primary';
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${provider.config.accessToken}` },
        },
      );
      if (!res.ok && res.status !== 404) {
        const err = await res.text();
        throw new Error(`Google Calendar delete failed: ${res.status} ${err}`);
      }
    }
  }

  /**
   * Start sync scheduler
   */
  private startSyncScheduler(): void {
    this.syncInterval = setInterval(() => {
      void (async () => {
        for (const [providerId, provider] of this.providers.entries()) {
          if (provider.isConnected && provider.config.syncEnabled) {
            try {
              await this.syncProvider(providerId);
            } catch (error) {
              this.logger.error('Scheduled sync failed', {
                providerId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      })();
    }, 3600000); // Sync every hour

    this.logger.log('Calendar sync scheduler started');
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
  }
}
