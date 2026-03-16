import { Injectable } from '@nestjs/common';
import { IntegrationService } from '../integration.service';

export interface IntegrationOption {
  value: string;
  label: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class IntegrationOptionProviderService {
  constructor(private readonly integrationService: IntegrationService) {}

  /**
   * Return available options for a given capability (e.g. channels, projects) for an integration.
   */
  async getOptions(
    userId: string,
    integrationId: string,
    optionType:
      | 'channels'
      | 'projects'
      | 'teams'
      | 'guilds'
      | 'issueTypes'
      | 'priorities',
  ): Promise<IntegrationOption[]> {
    const integration = await this.integrationService.getIntegrationById(
      integrationId,
      userId,
    );
    if (!integration) return [];

    switch (optionType) {
      case 'channels':
        if (integration.type === 'slack_oauth') {
          const list = await this.integrationService.getSlackChannels(
            integrationId,
            userId,
          );
          return (list as Array<{ id?: string; name?: string }>).map((c) => ({
            value: String(c.id ?? c.name ?? ''),
            label: String(c.name ?? c.id ?? ''),
            metadata: c,
          }));
        }
        if (integration.type === 'discord_oauth') return [];
        break;
      case 'guilds':
        if (integration.type === 'discord_oauth') {
          const list = await this.integrationService.getDiscordGuilds(
            integrationId,
            userId,
          );
          return (list as Array<{ id?: string; name?: string }>).map((g) => ({
            value: String(g.id ?? g.name ?? ''),
            label: String(g.name ?? g.id ?? ''),
            metadata: g,
          }));
        }
        break;
      case 'teams':
        if (integration.type === 'linear_oauth') {
          const list = await this.integrationService.getLinearTeams(
            integrationId,
            userId,
          );
          return (list as Array<{ id?: string; name?: string }>).map((t) => ({
            value: String(t.id ?? t.name ?? ''),
            label: String(t.name ?? t.id ?? ''),
            metadata: t,
          }));
        }
        break;
      case 'projects':
        if (integration.type === 'jira_oauth') {
          const list = await this.integrationService.getJiraProjects(
            integrationId,
            userId,
          );
          return (list as Array<{ key?: string; name?: string }>).map((p) => ({
            value: String(p.key ?? p.name ?? ''),
            label: String(p.name ?? p.key ?? ''),
            metadata: p,
          }));
        }
        break;
      case 'issueTypes':
        if (integration.type === 'jira_oauth') {
          const projects = await this.integrationService.getJiraProjects(
            integrationId,
            userId,
          );
          const projectKey = (projects as Array<{ key?: string }>)[0]?.key;
          if (!projectKey) return [];
          const list = await this.integrationService.getJiraIssueTypes(
            integrationId,
            userId,
            projectKey,
          );
          return (list as Array<{ id?: string; name?: string }>).map((i) => ({
            value: String(i.id ?? i.name ?? ''),
            label: String(i.name ?? i.id ?? ''),
            metadata: i,
          }));
        }
        break;
      case 'priorities':
        if (integration.type === 'jira_oauth') {
          const list = await this.integrationService.getJiraPriorities(
            integrationId,
            userId,
          );
          return (list as Array<{ id?: string; name?: string }>).map((i) => ({
            value: String(i.id ?? i.name ?? ''),
            label: String(i.name ?? i.id ?? ''),
            metadata: i,
          }));
        }
        break;
    }
    return [];
  }
}
