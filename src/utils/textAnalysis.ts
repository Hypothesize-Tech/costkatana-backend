export interface TextAnalysis {
    language: string;
    sentiment: string;
    complexity: 'simple' | 'medium' | 'complex';
    keywords: string[];
}

export async function analyzeText(text: string): Promise<TextAnalysis> {
    let complexity: 'simple' | 'medium' | 'complex';

    const wordCount = text.split(/\s+/).length;
    if (wordCount <= 10) {
        complexity = 'simple';
    } else if (wordCount <= 30) {
        complexity = 'medium';
    } else {
        complexity = 'complex';
    }

    const keywords = text.split(/\s+/)
        .filter(word => word.length > 3)
        .filter(word => !/^(the|and|or|but|if|then|when|where|what|how|why|with|for|from|to|in|on|at|by|of)$/i.test(word))
        .slice(0, 10);

    return {
        language: 'en', // Placeholder, could use a library for language detection
        sentiment: 'neutral', // Placeholder, could use a sentiment analysis library
        complexity,
        keywords
    };
}
