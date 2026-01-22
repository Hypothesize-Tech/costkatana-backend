/**
 * Entity Extractor
 * Extracts entities, packages, and services from messages
 */

export class EntityExtractor {
    /**
     * Extract all entities from message and recent conversation history
     */
    static extractEntities(message: string, recentMessages: any[]): string[] {
        const entities: string[] = [];
        const text = `${message} ${recentMessages.map(m => m.content).join(' ')}`.toLowerCase();
        
        // Package entities
        const packageEntities = this.extractPackageEntities(text);
        entities.push(...packageEntities);
        
        // Service entities
        const serviceEntities = this.extractServiceEntities(text);
        entities.push(...serviceEntities);

        return [...new Set(entities)]; // Remove duplicates
    }

    /**
     * Extract package-related entities
     */
    private static extractPackageEntities(text: string): string[] {
        const entities: string[] = [];
        
        const packagePatterns = [
            /cost-katana/g,
            /cost-katana-cli/g,
            /npm\s+package/g,
            /pypi\s+package/g,
            /python\s+package/g,
            /javascript\s+package/g,
            /typescript\s+package/g
        ];
        
        packagePatterns.forEach(pattern => {
            const matches = text.match(pattern);
            if (matches) {
                entities.push(...matches);
            }
        });

        return entities;
    }

    /**
     * Extract service-related entities
     */
    private static extractServiceEntities(text: string): string[] {
        const entities: string[] = [];
        
        const servicePatterns = [
            /costkatana/g,
            /cost katana/g,
            /backend/g,
            /api/g,
            /claude/g,
            /gpt/g,
            /bedrock/g,
            /openai/g
        ];
        
        servicePatterns.forEach(pattern => {
            const matches = text.match(pattern);
            if (matches) {
                entities.push(...matches);
            }
        });

        return entities;
    }
}
