import { Tool } from "@langchain/core/tools";
import { vectorStoreService } from "../services/vectorStore.service";

export class KnowledgeBaseTool extends Tool {
    name = "knowledge_base_search";
    description = `Search the knowledge base for information about AI cost optimization, 
    platform documentation, best practices, and learned insights. 
    Use this when you need to find specific information about:
    - How to optimize AI costs
    - Platform features and capabilities  
    - Best practices for model selection
    - Historical insights and patterns
    - Integration guides and documentation
    
    Input should be a clear search query about what you're looking for.`;

    async _call(query: string): Promise<string> {
        try {
            // Search the vector store
            const results = await vectorStoreService.search(query, 5);
            
            if (results.length === 0) {
                return "No relevant information found in the knowledge base for this query.";
            }

            // Format results for the agent
            let response = `Found ${results.length} relevant pieces of information:\n\n`;
            
            results.forEach((doc, index) => {
                const source = doc.metadata.source || 'unknown';
                const type = doc.metadata.type || 'documentation';
                
                response += `${index + 1}. [${type} from ${source}]\n`;
                response += `${doc.pageContent.trim()}\n\n`;
            });

            return response;
        } catch (error) {
            console.error('Knowledge base search failed:', error);
            return `Error searching knowledge base: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }
} 