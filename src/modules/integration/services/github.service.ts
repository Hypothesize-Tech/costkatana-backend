/**
 * GitHub Service for NestJS
 * Provides GitHub API operations for integration chat
 */

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  GitHubConnection,
  GitHubConnectionDocument,
} from '../../../schemas/integration/github-connection.schema';

export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  description: string | null;
  language: string | null;
  updatedAt: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubBranch {
  name: string;
  protected: boolean;
  sha: string;
}

@Injectable()
export class GitHubService {
  constructor(
    private readonly logger: LoggerService,
    @InjectModel(GitHubConnection.name)
    private readonly githubConnectionModel: Model<GitHubConnectionDocument>,
  ) {}

  /**
   * List user repositories
   */
  async listUserRepositories(
    connectionId: string,
  ): Promise<GitHubRepository[]> {
    try {
      const connection =
        await this.githubConnectionModel.findById(connectionId);
      if (!connection) {
        throw new Error('GitHub connection not found');
      }

      const accessToken = connection.accessToken;
      if (!accessToken) {
        throw new Error('GitHub access token not available');
      }

      const response = await fetch(
        `${process.env.GITHUB_API_URL || 'https://api.github.com'}/user/repos?per_page=100`,
        {
          headers: {
            Authorization: `token ${accessToken}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'CostKatana/1.0',
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          `GitHub API error: ${response.status} ${response.statusText}`,
        );
      }

      const repos = await response.json();

      return repos.map((repo: any) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        private: repo.private,
        htmlUrl: repo.html_url,
        description: repo.description,
        language: repo.language,
        updatedAt: repo.updated_at,
      }));
    } catch (error) {
      this.logger.error('Failed to list GitHub repositories', {
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * List repository issues
   */
  async listRepositoryIssues(
    connectionId: string,
    owner: string,
    repo: string,
  ): Promise<GitHubIssue[]> {
    try {
      const connection =
        await this.githubConnectionModel.findById(connectionId);
      if (!connection) {
        throw new Error('GitHub connection not found');
      }

      const accessToken = connection.accessToken;
      if (!accessToken) {
        throw new Error('GitHub access token not available');
      }

      const response = await fetch(
        `${process.env.GITHUB_API_URL || 'https://api.github.com'}/repos/${owner}/${repo}/issues?state=open&per_page=50`,
        {
          headers: {
            Authorization: `token ${accessToken}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'CostKatana/1.0',
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          `GitHub API error: ${response.status} ${response.statusText}`,
        );
      }

      const issues = await response.json();

      return issues.map((issue: any) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        htmlUrl: issue.html_url,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
      }));
    } catch (error) {
      this.logger.error('Failed to list GitHub repository issues', {
        connectionId,
        owner,
        repo,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * List repository pull requests
   */
  async listRepositoryPullRequests(
    connectionId: string,
    owner: string,
    repo: string,
  ): Promise<GitHubPullRequest[]> {
    try {
      const connection =
        await this.githubConnectionModel.findById(connectionId);
      if (!connection) {
        throw new Error('GitHub connection not found');
      }

      const accessToken = connection.accessToken;
      if (!accessToken) {
        throw new Error('GitHub access token not available');
      }

      const response = await fetch(
        `${process.env.GITHUB_API_URL || 'https://api.github.com'}/repos/${owner}/${repo}/pulls?state=open&per_page=50`,
        {
          headers: {
            Authorization: `token ${accessToken}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'CostKatana/1.0',
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          `GitHub API error: ${response.status} ${response.statusText}`,
        );
      }

      const prs = await response.json();

      return prs.map((pr: any) => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        htmlUrl: pr.html_url,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
      }));
    } catch (error) {
      this.logger.error('Failed to list GitHub repository pull requests', {
        connectionId,
        owner,
        repo,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * List repository branches
   */
  async listRepositoryBranches(
    connectionId: string,
    owner: string,
    repo: string,
  ): Promise<GitHubBranch[]> {
    try {
      const connection =
        await this.githubConnectionModel.findById(connectionId);
      if (!connection) {
        throw new Error('GitHub connection not found');
      }

      const accessToken = connection.accessToken;
      if (!accessToken) {
        throw new Error('GitHub access token not available');
      }

      const response = await fetch(
        `${process.env.GITHUB_API_URL || 'https://api.github.com'}/repos/${owner}/${repo}/branches?per_page=50`,
        {
          headers: {
            Authorization: `token ${accessToken}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'CostKatana/1.0',
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          `GitHub API error: ${response.status} ${response.statusText}`,
        );
      }

      const branches = await response.json();

      return branches.map((branch: any) => ({
        name: branch.name,
        protected: branch.protected,
        sha: branch.commit.sha,
      }));
    } catch (error) {
      this.logger.error('Failed to list GitHub repository branches', {
        connectionId,
        owner,
        repo,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
