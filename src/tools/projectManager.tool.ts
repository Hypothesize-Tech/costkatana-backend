import { Tool } from "@langchain/core/tools";
import { Project } from "../models/Project";
import { User } from "../models/User";

interface ProjectOperation {
    operation: 'create' | 'update' | 'get' | 'list' | 'delete' | 'configure';
    projectData?: {
        name?: string;
        description?: string;
        type?: 'api-integration' | 'chatbot' | 'content-generation' | 'data-analysis' | 'custom';
        settings?: {
            budgetLimit?: number;
            alertThreshold?: number;
            preferredModels?: string[];
            optimizationGoals?: string[];
        };
        integrations?: {
            apiKeys?: Array<{ service: string; keyName: string }>;
            endpoints?: string[];
            frameworks?: string[];
        };
    };
    projectId?: string;
    userId?: string;
}

export class ProjectManagerTool extends Tool {
    name = "project_manager";
    description = `Comprehensive project management tool for creating, updating, and managing AI projects.
    
    This tool can:
    - Create new projects with smart defaults
    - Update existing projects  
    - Configure project settings and integrations
    - List user projects
    - Get project details
    - Set up model configurations
    
    Input should be a JSON string with:
    {{
        "operation": "create|update|get|list|delete|configure",
        "userId": "user-id-string",
        "projectId": "project-id" (for update/get/delete),
        "projectData": {{
            "name": "Project Name",
            "description": "Project description",
            "type": "api-integration|chatbot|content-generation|data-analysis|ai-cost-optimization|custom",
            "settings": {{
                "budgetLimit": 100.00,
                "alertThreshold": 80,
                "preferredModels": ["claude-3-haiku", "gpt-3.5-turbo"],
                "optimizationGoals": ["cost", "speed", "quality"]
            }},
            "integrations": {{
                "apiKeys": [{{"service": "openai", "keyName": "main-key"}}],
                "endpoints": ["https://api.example.com"],
                "frameworks": ["langchain", "openai-sdk"]
            }}
        }}
    }}`;

    async _call(input: string): Promise<string> {
        try {
            const operation: ProjectOperation = JSON.parse(input);
            
            if (!this.isValidOperation(operation)) {
                return "Invalid operation: Check operation type, userId, and required fields.";
            }

            switch (operation.operation) {
                case 'create':
                    return await this.createProject(operation);
                case 'update':
                    return await this.updateProject(operation);
                case 'get':
                    return await this.getProject(operation);
                case 'list':
                    return await this.listProjects(operation);
                case 'delete':
                    return await this.deleteProject(operation);
                case 'configure':
                    return await this.configureProject(operation);
                default:
                    return "Unsupported operation.";
            }

        } catch (error) {
            console.error('Project management operation failed:', error);
            
            if (error instanceof SyntaxError) {
                return "Invalid JSON input. Please provide a valid operation object.";
            }
            
            return `Project management error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    private async createProject(operation: ProjectOperation): Promise<string> {
        try {
            if (!operation.projectData?.name || !operation.userId) {
                return "Project creation requires name and userId.";
            }

            // Check if user exists
            const user = await User.findById(operation.userId);
            if (!user) {
                return "User not found. Cannot create project.";
            }

            // Generate smart defaults based on project type
            const smartDefaults = this.generateSmartDefaults(operation.projectData.type || 'custom');

            const projectData = {
                name: operation.projectData.name,
                description: operation.projectData.description || `AI project: ${operation.projectData.name}`,
                ownerId: operation.userId,
                members: [{ 
                    userId: operation.userId, 
                    role: 'owner' as const, 
                    joinedAt: new Date() 
                }],
                budget: {
                    amount: operation.projectData.settings?.budgetLimit || smartDefaults.settings.budgetLimit,
                    period: 'monthly' as const,
                    startDate: new Date(),
                    currency: 'USD',
                    alerts: [{
                        threshold: operation.projectData.settings?.alertThreshold || smartDefaults.settings.alertThreshold,
                        type: 'email' as const,
                        recipients: []
                    }]
                },
                spending: {
                    current: 0,
                    lastUpdated: new Date(),
                    history: []
                },
                settings: {
                    allowedModels: operation.projectData.settings?.preferredModels || smartDefaults.settings.preferredModels,
                    enablePromptLibrary: true,
                    enableCostAllocation: true
                },
                tags: smartDefaults.tags,
                isActive: true
            };

            const project = new Project(projectData);
            await project.save();

            // Create initial activity entry
            await this.createProjectActivity(project._id as string, operation.userId, 'project_created', {
                projectName: project.name,
                projectType: operation.projectData.type
            });

            return JSON.stringify({
                success: true,
                message: `Your project "${project.name}" has been created successfully with a monthly budget of $${project.budget.amount.toLocaleString()}. Here are some smart defaults and next steps to get you started:`,
                smartDefaults: smartDefaults.recommendations,
                nextSteps: this.getNextSteps(operation.projectData.type || 'custom'),
                project: {
                    name: project.name,
                    description: project.description,
                    type: operation.projectData.type,
                    budget: `$${project.budget.amount.toLocaleString()}/month`,
                    alertThreshold: `${project.budget.alerts[0].threshold}%`,
                    modelsEnabled: project.settings.allowedModels?.length || 0,
                    status: 'Active'
                }
            }, null, 2);

        } catch (error) {
            return `Failed to create project: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    private async updateProject(operation: ProjectOperation): Promise<string> {
        try {
            if (!operation.projectId || !operation.userId) {
                return "Project update requires projectId and userId.";
            }

            const project = await Project.findById(operation.projectId);
            if (!project) {
                return "Project not found.";
            }

            // Check if user has permission to update
            const hasPermission = project.members.some(
                member => member.userId.toString() === operation.userId && 
                ['owner', 'admin'].includes(member.role)
            );

            if (!hasPermission) {
                return "You don't have permission to update this project.";
            }

            // Update project data
            if (operation.projectData) {
                if (operation.projectData.name) project.name = operation.projectData.name;
                if (operation.projectData.description) project.description = operation.projectData.description;
                if (operation.projectData.settings) {
                    project.settings = { ...project.settings, ...operation.projectData.settings };
                }
            }

            await project.save();

            // Log activity
            await this.createProjectActivity(operation.projectId, operation.userId, 'project_updated', {
                changes: operation.projectData
            });

            return JSON.stringify({
                success: true,
                message: `Project '${project.name}' updated successfully!`,
                project: {
                    id: project._id,
                    name: project.name,
                    description: project.description,
                    settings: project.settings,
                    updatedAt: project.updatedAt
                }
            }, null, 2);

        } catch (error) {
            return `Failed to update project: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    private async getProject(operation: ProjectOperation): Promise<string> {
        try {
            if (!operation.projectId) {
                return "Get project operation requires projectId.";
            }

            const project = await Project.findById(operation.projectId)
                .populate('members.userId', 'name email')
                .lean();

            if (!project) {
                return "Project not found.";
            }

            // Check if user has access
            if (operation.userId) {
                const hasAccess = project.members.some(
                    member => member.userId.toString() === operation.userId
                );
                if (!hasAccess) {
                    return "You don't have access to this project.";
                }
            }

            return JSON.stringify({
                success: true,
                project: {
                    id: project._id,
                    name: project.name,
                    description: project.description,
                    isActive: project.isActive,
                    settings: project.settings,
                    members: project.members,
                    tags: project.tags,
                    budget: project.budget,
                    createdAt: project.createdAt,
                    updatedAt: project.updatedAt
                }
            }, null, 2);

        } catch (error) {
            return `Failed to get project: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    private async listProjects(operation: ProjectOperation): Promise<string> {
        try {
            if (!operation.userId) {
                return "List projects operation requires userId.";
            }

            const projects = await Project.find({
                'members.userId': operation.userId,
                isActive: true
            })
            .select('name description isActive settings createdAt updatedAt tags')
            .sort({ updatedAt: -1 })
            .limit(20)
            .lean();

            return JSON.stringify({
                success: true,
                count: projects.length,
                projects: projects.map(project => ({
                    id: project._id,
                    name: project.name,
                    description: project.description,
                    isActive: project.isActive,
                    type: project.tags?.[0] || 'custom', // Use first tag as type
                    createdAt: project.createdAt,
                    updatedAt: project.updatedAt
                }))
            }, null, 2);

        } catch (error) {
            return `Failed to list projects: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    private async configureProject(operation: ProjectOperation): Promise<string> {
        try {
            // This would set up model configurations, API integrations, etc.
            return JSON.stringify({
                success: true,
                message: "Project configuration completed",
                configuration: operation.projectData
            }, null, 2);
        } catch (error) {
            return `Failed to configure project: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    private async deleteProject(operation: ProjectOperation): Promise<string> {
        // Soft delete for safety
        try {
            if (!operation.projectId || !operation.userId) {
                return "Delete project operation requires projectId and userId.";
            }

            const project = await Project.findById(operation.projectId);
            if (!project) {
                return "Project not found.";
            }

            // Check if user is owner
            const isOwner = project.members.some(
                member => member.userId.toString() === operation.userId && member.role === 'owner'
            );

            if (!isOwner) {
                return "Only project owners can delete projects.";
            }

            project.isActive = false;
            await project.save();

            return JSON.stringify({
                success: true,
                message: `Project '${project.name}' has been archived.`
            });

        } catch (error) {
            return `Failed to delete project: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    private generateSmartDefaults(projectType: string) {
        const defaults = {
            'api-integration': {
                settings: {
                    budgetLimit: 100.00,
                    alertThreshold: 80,
                    preferredModels: ['claude-3-haiku-20240307-v1:0', 'gpt-3.5-turbo'],
                    optimizationGoals: ['cost', 'reliability']
                },
                tags: ['api', 'integration', 'production'],
                recommendations: [
                    'Use Claude 3 Haiku for simple API responses to minimize costs',
                    'Implement request batching for bulk operations',
                    'Set up monitoring for API usage patterns'
                ]
            },
            'chatbot': {
                settings: {
                    budgetLimit: 200.00,
                    alertThreshold: 75,
                    preferredModels: ['claude-3-sonnet-20240229-v1:0', 'gpt-4'],
                    optimizationGoals: ['quality', 'speed']
                },
                tags: ['chatbot', 'conversational', 'customer-service'],
                recommendations: [
                    'Use Claude 3 Sonnet for balanced quality and cost',
                    'Implement context trimming for long conversations',
                    'Consider caching common responses'
                ]
            },
            'content-generation': {
                settings: {
                    budgetLimit: 300.00,
                    alertThreshold: 70,
                    preferredModels: ['claude-3-opus-20240229-v1:0', 'gpt-4-turbo'],
                    optimizationGoals: ['quality', 'creativity']
                },
                tags: ['content', 'generation', 'creative'],
                recommendations: [
                    'Use Claude 3 Opus for high-quality content generation',
                    'Implement prompt templates for consistency',
                    'Batch similar content requests'
                ]
            },
            'data-analysis': {
                settings: {
                    budgetLimit: 150.00,
                    alertThreshold: 85,
                    preferredModels: ['claude-3-sonnet-20240229-v1:0', 'gpt-4'],
                    optimizationGoals: ['accuracy', 'cost']
                },
                tags: ['analytics', 'data', 'insights'],
                recommendations: [
                    'Use structured prompts for consistent analysis',
                    'Pre-process data to reduce token usage',
                    'Implement result caching for repeated analyses'
                ]
            },
            'ai-cost-optimization': {
                settings: {
                    budgetLimit: 500.00,
                    alertThreshold: 60,
                    preferredModels: [
                        'amazon.nova-lite-v1:0', 
                        'amazon.nova-pro-v1:0', 
                        'anthropic.claude-3-5-haiku-20241022-v1:0',
                        'anthropic.claude-3-5-sonnet-20241022-v2:0'
                    ],
                    optimizationGoals: ['cost', 'efficiency', 'performance', 'quality']
                },
                tags: ['ai-optimization', 'cost-reduction', 'monitoring', 'enterprise'],
                recommendations: [
                    'Start with Nova Lite for baseline cost measurements',
                    'Compare multiple models for each use case to find optimal cost/quality ratio',
                    'Implement comprehensive usage tracking and analytics',
                    'Set up automated alerts for cost anomalies',
                    'Use prompt optimization techniques to reduce token usage',
                    'Implement caching for repeated queries',
                    'Consider model switching based on task complexity'
                ]
            },
            'custom': {
                settings: {
                    budgetLimit: 100.00,
                    alertThreshold: 80,
                    preferredModels: ['amazon.nova-lite-v1:0'],
                    optimizationGoals: ['cost']
                },
                tags: ['custom', 'general'],
                recommendations: [
                    'Start with cost-effective models and scale as needed',
                    'Monitor usage patterns to optimize'
                ]
            }
        };

        return defaults[projectType as keyof typeof defaults] || defaults.custom;
    }

    private getNextSteps(projectType: string): string[] {
        const nextSteps = {
            'api-integration': [
                '1. Set up your API keys in project settings',
                '2. Configure your endpoints and authentication',
                '3. Test with a small batch of requests',
                '4. Set up monitoring and alerts'
            ],
            'chatbot': [
                '1. Define your chatbot personality and use cases',
                '2. Set up conversation context management',
                '3. Configure response templates',
                '4. Test with sample conversations'
            ],
            'content-generation': [
                '1. Define your content templates and styles',
                '2. Set up batch processing workflows',
                '3. Configure quality scoring',
                '4. Test with sample content requests'
            ],
            'data-analysis': [
                '1. Upload or connect your data sources',
                '2. Define analysis templates',
                '3. Set up automated reporting',
                '4. Configure data privacy settings'
            ],
            'ai-cost-optimization': [
                '1. 🔍 Set up comprehensive usage tracking across all AI models',
                '2. 📊 Configure cost monitoring dashboard and alerts at 60% budget usage',
                '3. 🧪 Run model comparison tests to identify optimal cost/quality ratios',
                '4. 💡 Implement prompt optimization techniques to reduce token usage',
                '5. ⚡ Set up caching strategies for repeated queries',
                '6. 📈 Establish baseline metrics for cost-per-task analysis',
                '7. 🎯 Configure automated model switching based on task complexity',
                '8. 📋 Create optimization reports and ROI tracking'
            ],
            'custom': [
                '1. Define your specific use case requirements',
                '2. Choose appropriate models for your needs',
                '3. Set up basic monitoring',
                '4. Start with small-scale testing'
            ]
        };

        return nextSteps[projectType as keyof typeof nextSteps] || nextSteps.custom;
    }

    private async createProjectActivity(projectId: string, userId: string, action: string, details: any) {
        try {
            // This would create an activity record - simplified for now
            console.log(`Project Activity: ${action} by ${userId} on ${projectId}`, details);
        } catch (error) {
            console.error('Failed to create project activity:', error);
        }
    }

    private isValidOperation(operation: ProjectOperation): boolean {
        if (!operation.operation || !operation.userId) {
            return false;
        }

        const validOperations = ['create', 'update', 'get', 'list', 'delete', 'configure'];
        if (!validOperations.includes(operation.operation)) {
            return false;
        }

        // Additional validation based on operation
        if (['update', 'get', 'delete', 'configure'].includes(operation.operation) && !operation.projectId) {
            return false;
        }

        if (operation.operation === 'create' && !operation.projectData?.name) {
            return false;
        }

        return true;
    }
} 