import { RequirementsAnalysis } from './requirementsAnalysis.service';
import { loggingService } from './logging.service';

export interface Template {
    id: string;
    name: string;
    description: string;
    generationType: string;
    language: string;
    framework?: string;
    content: string;
    provenance?: {
        examples: string[];
        snippets: string[];
    };
}

/**
 * Template selection service
 * Matches intent to appropriate code generation templates
 */
export class TemplateSelectorService {
    private static readonly TEMPLATE_LIBRARY: Record<string, Template[]> = {
        'test_typescript': [
            {
                id: 'test_ts_jest',
                name: 'Jest Test Template',
                description: 'Jest unit test template for TypeScript',
                generationType: 'test',
                language: 'typescript',
                framework: 'jest',
                content: `import { describe, it, expect } from '@jest/globals';

describe('{{className}}', () => {
    it('should {{testCase}}', () => {
        // Test implementation
        expect(true).toBe(true);
    });
});`
            }
        ],
        'test_python': [
            {
                id: 'test_py_pytest',
                name: 'Pytest Test Template',
                description: 'Pytest unit test template for Python',
                generationType: 'test',
                language: 'python',
                framework: 'pytest',
                content: `import pytest

def test_{{functionName}}():
    """Test {{functionName}} function"""
    # Test implementation
    assert True`
            }
        ],
        'boilerplate_typescript': [
            {
                id: 'boilerplate_ts_service',
                name: 'TypeScript Service Template',
                description: 'Service class template for TypeScript',
                generationType: 'boilerplate',
                language: 'typescript',
                content: `export class {{className}} {
    constructor() {
        // Initialize
    }

    async {{methodName}}(): Promise<void> {
        // Implementation
    }
}`
            }
        ]
    };

    /**
     * Select templates based on requirements
     */
    static selectTemplates(
        requirements: RequirementsAnalysis,
        language: string,
        framework?: string
    ): Template[] {
        const templates: Template[] = [];
        const key = `${requirements.generationType}_${language}`;

        // Get templates for this generation type and language
        const candidateTemplates = this.TEMPLATE_LIBRARY[key] || [];

        // Filter by framework if specified
        const filtered = framework
            ? candidateTemplates.filter(t => t.framework === framework || !t.framework)
            : candidateTemplates;

        templates.push(...filtered);

        // If no templates found, try generic templates
        if (templates.length === 0) {
            const genericKey = `${requirements.generationType}_*`;
            // Would search for generic templates here
            loggingService.warn('No specific templates found, using generic', {
                component: 'TemplateSelectorService',
                key,
                language,
                framework
            });
        }

        return templates.slice(0, 3); // Return top 3 templates
    }

    /**
     * Get template by ID
     */
    static getTemplate(templateId: string): Template | null {
        for (const templates of Object.values(this.TEMPLATE_LIBRARY)) {
            const template = templates.find(t => t.id === templateId);
            if (template) {
                return template;
            }
        }
        return null;
    }
}

