import { Injectable, Logger } from '@nestjs/common';

export interface EvaluationMetrics {
  faithfulness: number; // How faithful is the response to the retrieved documents
  relevance: number; // How relevant are the retrieved documents to the query
  answerCorrectness: number; // How correct is the generated answer
  overall: number; // Overall quality score
}

export interface EvaluationResult {
  metrics: EvaluationMetrics;
  feedback: string[];
  recommendations: string[];
}

/**
 * RAG Evaluation Metrics Service
 * Evaluates RAG pipeline performance using various metrics
 */
@Injectable()
export class RAGEvaluationService {
  private readonly logger = new Logger(RAGEvaluationService.name);

  /**
   * Evaluate RAG results
   */
  async evaluate(
    query: string,
    retrievedDocuments: any[],
    generatedResponse: string,
  ): Promise<EvaluationResult> {
    try {
      this.logger.debug('Starting RAG evaluation', {
        queryLength: query.length,
        documentsCount: retrievedDocuments.length,
        responseLength: generatedResponse.length,
      });

      // Enhanced evaluation metrics
      const faithfulness = this.calculateFaithfulness(
        generatedResponse,
        retrievedDocuments,
      );
      const relevance = this.calculateRelevance(query, retrievedDocuments);
      const answerCorrectness =
        this.calculateAnswerCorrectness(generatedResponse);
      const contextUtilization = this.calculateContextUtilization(
        generatedResponse,
        retrievedDocuments,
      );
      const answerCompleteness = this.calculateAnswerCompleteness(
        generatedResponse,
        query,
      );

      // Weighted overall score
      const overall =
        faithfulness * 0.3 +
        relevance * 0.25 +
        answerCorrectness * 0.2 +
        contextUtilization * 0.15 +
        answerCompleteness * 0.1;

      const feedback = this.generateFeedback({
        faithfulness,
        relevance,
        answerCorrectness,
        contextUtilization,
        answerCompleteness,
      });

      const recommendations = this.generateRecommendations({
        faithfulness,
        relevance,
        answerCorrectness,
        contextUtilization,
        answerCompleteness,
      });

      this.logger.debug('RAG evaluation completed', {
        overall: overall.toFixed(3),
        metrics: {
          faithfulness: faithfulness.toFixed(3),
          relevance: relevance.toFixed(3),
          answerCorrectness: answerCorrectness.toFixed(3),
          contextUtilization: contextUtilization.toFixed(3),
          answerCompleteness: answerCompleteness.toFixed(3),
        },
      });

      return {
        metrics: {
          faithfulness,
          relevance,
          answerCorrectness,
          overall,
          // Additional metrics
          contextUtilization,
          answerCompleteness,
        } as EvaluationMetrics,
        feedback,
        recommendations,
      };
    } catch (error: any) {
      this.logger.error('RAG evaluation failed', { error: error.message });
      return {
        metrics: {
          faithfulness: 0.5,
          relevance: 0.5,
          answerCorrectness: 0.5,
          overall: 0.5,
          contextUtilization: 0.5,
          answerCompleteness: 0.5,
        } as EvaluationMetrics,
        feedback: ['Evaluation failed due to technical issues'],
        recommendations: ['Retry evaluation or check system logs'],
      };
    }
  }

  private calculateFaithfulness(response: string, documents: any[]): number {
    // Simplified: check if response content appears in documents
    const responseWords = response.toLowerCase().split(/\s+/);
    let matchingWords = 0;

    for (const doc of documents) {
      const docWords = doc.content.toLowerCase().split(/\s+/);
      for (const word of responseWords) {
        if (docWords.includes(word) && word.length > 3) {
          matchingWords++;
        }
      }
    }

    return Math.min(matchingWords / responseWords.length, 1);
  }

  private calculateRelevance(query: string, documents: any[]): number {
    // Simplified: check if query terms appear in documents
    const queryWords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    let relevantDocs = 0;

    for (const doc of documents) {
      const docWords = doc.content.toLowerCase().split(/\s+/);
      const matches = queryWords.filter((word) =>
        docWords.includes(word),
      ).length;
      if (matches > 0) {
        relevantDocs++;
      }
    }

    return documents.length > 0 ? relevantDocs / documents.length : 0;
  }

  private calculateAnswerCorrectness(response: string): number {
    // Enhanced: basic heuristics for answer quality
    let score = 0.6; // Base score

    // Length assessment
    if (response.length > 100) score += 0.1;
    if (response.length > 500) score += 0.1;
    if (response.length > 1000) score += 0.05;

    // Content quality indicators
    if (response.includes('$') || response.includes('cost')) score += 0.05;
    if (response.includes('recommend') || response.includes('suggest'))
      score += 0.05;
    if (response.includes('example') || response.includes('Example'))
      score += 0.05;
    if (response.includes('important') || response.includes('note'))
      score += 0.05;

    // Structure indicators
    if (response.includes('\n-') || response.includes('\n*')) score += 0.05; // Lists
    if (response.includes('1.') || response.includes('2.')) score += 0.05; // Numbered lists
    if (response.includes('```')) score += 0.05; // Code blocks

    // Specificity indicators
    const specificTerms = [
      'specifically',
      'according to',
      'based on',
      'therefore',
      'consequently',
    ];
    const specificMatches = specificTerms.filter((term) =>
      response.toLowerCase().includes(term),
    ).length;
    score += Math.min(specificMatches * 0.02, 0.1);

    return Math.min(score, 1);
  }

  private calculateContextUtilization(
    response: string,
    documents: any[],
  ): number {
    if (documents.length === 0) return 0;

    let totalUtilization = 0;
    let processedDocs = 0;

    for (const doc of documents) {
      const content = doc.content || '';
      const utilization = this.calculateDocumentUtilization(response, content);
      totalUtilization += utilization;
      processedDocs++;
    }

    return processedDocs > 0 ? totalUtilization / processedDocs : 0;
  }

  private calculateDocumentUtilization(
    response: string,
    documentContent: string,
  ): number {
    const responseWords = response.toLowerCase().split(/\s+/);
    const docWords = documentContent.toLowerCase().split(/\s+/);

    let utilizedWords = 0;
    const uniqueDocWords = new Set(docWords);

    for (const word of responseWords) {
      if (word.length > 3 && uniqueDocWords.has(word)) {
        utilizedWords++;
      }
    }

    return responseWords.length > 0
      ? Math.min(utilizedWords / Math.min(responseWords.length, 50), 1)
      : 0;
  }

  private calculateAnswerCompleteness(response: string, query: string): number {
    // Assess if the response adequately addresses the query
    let score = 0.5;

    const queryWords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 3);
    const responseWords = response.toLowerCase().split(/\s+/);

    // Direct term matching
    let matchedTerms = 0;
    for (const term of queryWords) {
      if (responseWords.includes(term)) {
        matchedTerms++;
      }
    }

    if (queryWords.length > 0) {
      score += (matchedTerms / queryWords.length) * 0.3;
    }

    // Response comprehensiveness
    if (response.length > query.length * 2) score += 0.1; // Adequate expansion
    if (response.length > query.length * 5) score += 0.1; // Comprehensive response

    // Question handling
    if (
      query.includes('?') &&
      (response.includes('answer') || response.includes('solution'))
    ) {
      score += 0.1;
    }

    return Math.min(score, 1);
  }

  private generateFeedback(metrics: {
    faithfulness: number;
    relevance: number;
    answerCorrectness: number;
    contextUtilization: number;
    answerCompleteness: number;
  }): string[] {
    const feedback: string[] = [];

    if (metrics.faithfulness < 0.6) {
      feedback.push(
        'Response may not be fully grounded in retrieved documents',
      );
    } else if (metrics.faithfulness > 0.8) {
      feedback.push('Response shows excellent grounding in retrieved context');
    }

    if (metrics.relevance < 0.6) {
      feedback.push(
        'Retrieved documents may not be highly relevant to the query',
      );
    } else if (metrics.relevance > 0.8) {
      feedback.push('Retrieved documents are highly relevant to the query');
    }

    if (metrics.answerCorrectness < 0.6) {
      feedback.push('Generated answer may lack completeness or accuracy');
    } else if (metrics.answerCorrectness > 0.8) {
      feedback.push('Generated answer demonstrates high quality and accuracy');
    }

    if (metrics.contextUtilization < 0.5) {
      feedback.push('Retrieved context is underutilized in the response');
    } else if (metrics.contextUtilization > 0.7) {
      feedback.push('Response effectively utilizes retrieved context');
    }

    if (metrics.answerCompleteness < 0.6) {
      feedback.push('Response may not fully address the query requirements');
    } else if (metrics.answerCompleteness > 0.8) {
      feedback.push('Response comprehensively addresses the query');
    }

    if (feedback.length === 0) {
      feedback.push('RAG pipeline performed well across all metrics');
    }

    return feedback;
  }

  private generateRecommendations(metrics: {
    faithfulness: number;
    relevance: number;
    answerCorrectness: number;
    contextUtilization: number;
    answerCompleteness: number;
  }): string[] {
    const recommendations: string[] = [];

    if (metrics.relevance < 0.7) {
      recommendations.push(
        'Consider using more sophisticated retrieval methods (e.g., hybrid search)',
      );
      recommendations.push('Review document indexing and embedding quality');
      recommendations.push('Implement query expansion techniques');
    }

    if (metrics.faithfulness < 0.7) {
      recommendations.push(
        'Improve answer generation to better utilize retrieved context',
      );
      recommendations.push('Consider using different prompting strategies');
      recommendations.push('Implement context compression techniques');
    }

    if (metrics.contextUtilization < 0.6) {
      recommendations.push(
        'Improve context integration in response generation',
      );
      recommendations.push('Consider using context-aware prompting techniques');
      recommendations.push('Implement better context ranking and selection');
    }

    if (metrics.answerCorrectness < 0.7) {
      recommendations.push(
        'Validate answer quality through additional verification steps',
      );
      recommendations.push(
        'Consider using more advanced language models for generation',
      );
      recommendations.push(
        'Implement answer validation and correction mechanisms',
      );
    }

    if (metrics.answerCompleteness < 0.7) {
      recommendations.push('Enhance query understanding and decomposition');
      recommendations.push(
        'Implement multi-step reasoning in response generation',
      );
      recommendations.push('Consider using follow-up question generation');
    }

    if (recommendations.length === 0) {
      recommendations.push(
        'RAG pipeline is performing optimally - consider fine-tuning for specific use cases',
      );
    }

    return recommendations;
  }
}
