/**
 * IntegrationFormatter Unit Tests
 * Tests for integration result formatting
 */

import { IntegrationFormatter } from '@services/chat/formatters';

describe('IntegrationFormatter', () => {
    describe('formatGithubResult', () => {
        it('should format repository data correctly', () => {
            const repositoryData = {
                name: 'cost-katana',
                full_name: 'testuser/cost-katana',
                owner: { login: 'testuser' },
                description: 'A cost optimization platform',
                stargazers_count: 150,
                forks_count: 25,
                language: 'TypeScript',
                html_url: 'https://github.com/testuser/cost-katana'
            };

            const result = IntegrationFormatter.formatGithubResult(repositoryData, 'repository');

            expect(result).toContain('**cost-katana**');
            expect(result).toContain('testuser');
            expect(result).toContain('150 stars');
            expect(result).toContain('25 forks');
            expect(result).toContain('TypeScript');
        });

        it('should format issue data correctly', () => {
            const issueData = {
                number: 42,
                title: 'Fix bug in chat service',
                state: 'open',
                user: { login: 'developer' },
                labels: [{ name: 'bug' }, { name: 'priority' }],
                html_url: 'https://github.com/testuser/repo/issues/42'
            };

            const result = IntegrationFormatter.formatGithubResult(issueData, 'issue');

            expect(result).toContain('#42');
            expect(result).toContain('Fix bug in chat service');
            expect(result).toContain('open');
            expect(result).toContain('developer');
            expect(result).toContain('bug');
        });

        it('should handle missing optional fields gracefully', () => {
            const minimalData = {
                name: 'test-repo',
                owner: { login: 'testuser' }
            };

            const result = IntegrationFormatter.formatGithubResult(minimalData, 'repository');

            expect(result).toContain('test-repo');
            expect(result).toContain('testuser');
            expect(result).not.toContain('undefined');
            expect(result).not.toContain('null');
        });
    });

    describe('formatMongodbResult', () => {
        it('should format database list correctly', () => {
            const databases = ['admin', 'local', 'myapp'];

            const result = IntegrationFormatter.formatMongodbResult(databases, 'databases');

            expect(result).toContain('admin');
            expect(result).toContain('local');
            expect(result).toContain('myapp');
            expect(result).toContain('3 databases');
        });

        it('should format collection documents correctly', () => {
            const documents = [
                { _id: '1', name: 'John', age: 30 },
                { _id: '2', name: 'Jane', age: 25 }
            ];

            const result = IntegrationFormatter.formatMongodbResult(documents, 'documents');

            expect(result).toContain('John');
            expect(result).toContain('Jane');
            expect(result).toContain('30');
            expect(result).toContain('25');
        });

        it('should handle empty results', () => {
            const result = IntegrationFormatter.formatMongodbResult([], 'documents');

            expect(result).toContain('No documents found');
        });
    });

    describe('formatVercelResult', () => {
        it('should format deployment data correctly', () => {
            const deploymentData = {
                uid: 'dpl_123',
                name: 'my-app',
                url: 'my-app.vercel.app',
                state: 'READY',
                created: 1234567890000,
                creator: { username: 'developer' }
            };

            const result = IntegrationFormatter.formatVercelResult(deploymentData, 'deployment');

            expect(result).toContain('my-app');
            expect(result).toContain('my-app.vercel.app');
            expect(result).toContain('READY');
            expect(result).toContain('developer');
        });

        it('should format project list correctly', () => {
            const projects = [
                { id: 'prj_1', name: 'frontend', framework: 'nextjs' },
                { id: 'prj_2', name: 'backend', framework: 'express' }
            ];

            const result = IntegrationFormatter.formatVercelResult(projects, 'projects');

            expect(result).toContain('frontend');
            expect(result).toContain('backend');
            expect(result).toContain('nextjs');
            expect(result).toContain('express');
        });
    });

    describe('formatSlackResult', () => {
        it('should format channel list correctly', () => {
            const channels = [
                { id: 'C123', name: 'general', num_members: 50 },
                { id: 'C456', name: 'random', num_members: 30 }
            ];

            const result = IntegrationFormatter.formatSlackResult(channels, 'channels');

            expect(result).toContain('general');
            expect(result).toContain('random');
            expect(result).toContain('50 members');
            expect(result).toContain('30 members');
        });

        it('should format message history correctly', () => {
            const messages = [
                { user: 'U123', text: 'Hello team!', ts: '1234567890.123' },
                { user: 'U456', text: 'Hi there!', ts: '1234567891.456' }
            ];

            const result = IntegrationFormatter.formatSlackResult(messages, 'messages');

            expect(result).toContain('Hello team!');
            expect(result).toContain('Hi there!');
        });
    });
});
