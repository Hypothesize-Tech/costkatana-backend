/**
 * Message Analyzer
 * Analyzes messages to determine subject, intent, domain, and other metadata
 */

import { Injectable } from '@nestjs/common';
import { MessageAnalysis } from './types/context.types';

@Injectable()
export class MessageAnalyzer {
  /**
   * Analyze message to determine subject, intent, and domain
   */
  analyzeMessage(
    message: string,
    recentMessages: any[],
  ): Omit<MessageAnalysis, 'languageFramework'> {
    const lowerMessage = message.toLowerCase();

    // Determine intent
    const intent = this.determineIntent(lowerMessage);

    // Determine domain
    const domain = this.determineDomain(lowerMessage);

    // Extract subject
    const subject = this.extractSubject(message, lowerMessage);

    // Calculate confidence
    const confidence = this.calculateConfidence(message, intent, domain);

    // Determine complexity
    const complexity = this.determineComplexity(message);

    // Simple sentiment analysis
    const sentiment = this.determineSentiment(lowerMessage);

    return {
      subject,
      intent,
      domain,
      confidence,
      sentiment,
      complexity,
    };
  }

  /**
   * Detect programming language/framework from message
   */
  detectLanguageFramework(message: string): string | undefined {
    const lowerMessage = message.toLowerCase();

    const frameworks = [
      { name: 'React', keywords: ['react', 'jsx', 'tsx', 'component', 'hook'] },
      { name: 'Node.js', keywords: ['node', 'express', 'npm', 'package.json'] },
      {
        name: 'Python',
        keywords: ['python', 'django', 'flask', 'pip', 'requirements.txt'],
      },
      { name: 'JavaScript', keywords: ['javascript', 'js', 'es6', 'babel'] },
      {
        name: 'TypeScript',
        keywords: ['typescript', 'ts', 'interface', 'type'],
      },
      { name: 'Java', keywords: ['java', 'spring', 'maven', 'gradle'] },
      { name: 'C#', keywords: ['csharp', 'dotnet', '.net', 'asp.net'] },
      { name: 'Go', keywords: ['golang', 'go ', 'goroutine'] },
      { name: 'Rust', keywords: ['rust', 'cargo', 'crate'] },
    ];

    for (const framework of frameworks) {
      if (
        framework.keywords.some((keyword) => lowerMessage.includes(keyword))
      ) {
        return framework.name;
      }
    }

    return undefined;
  }

  /**
   * Determine the intent of the message
   */
  private determineIntent(lowerMessage: string): string {
    if (
      lowerMessage.includes('help') ||
      lowerMessage.includes('how to') ||
      lowerMessage.includes('guide')
    ) {
      return 'help';
    }
    if (
      lowerMessage.includes('analyze') ||
      lowerMessage.includes('review') ||
      lowerMessage.includes('check')
    ) {
      return 'analysis';
    }
    if (
      lowerMessage.includes('create') ||
      lowerMessage.includes('build') ||
      lowerMessage.includes('generate')
    ) {
      return 'creation';
    }
    if (
      lowerMessage.includes('fix') ||
      lowerMessage.includes('debug') ||
      lowerMessage.includes('error')
    ) {
      return 'debugging';
    }
    if (
      lowerMessage.includes('optimize') ||
      lowerMessage.includes('improve') ||
      lowerMessage.includes('performance')
    ) {
      return 'optimization';
    }
    if (
      lowerMessage.includes('search') ||
      lowerMessage.includes('find') ||
      lowerMessage.includes('lookup')
    ) {
      return 'search';
    }

    return 'general';
  }

  /**
   * Determine the domain/context of the message
   */
  private determineDomain(lowerMessage: string): string {
    if (
      lowerMessage.includes('code') ||
      lowerMessage.includes('programming') ||
      lowerMessage.includes('development')
    ) {
      return 'development';
    }
    if (
      lowerMessage.includes('database') ||
      lowerMessage.includes('data') ||
      lowerMessage.includes('sql')
    ) {
      return 'data';
    }
    if (
      lowerMessage.includes('deploy') ||
      lowerMessage.includes('server') ||
      lowerMessage.includes('infrastructure')
    ) {
      return 'infrastructure';
    }
    if (
      lowerMessage.includes('cost') ||
      lowerMessage.includes('pricing') ||
      lowerMessage.includes('billing')
    ) {
      return 'business';
    }
    if (
      lowerMessage.includes('test') ||
      lowerMessage.includes('quality') ||
      lowerMessage.includes('bug')
    ) {
      return 'quality';
    }

    return 'general';
  }

  /**
   * Extract subject/topic from message
   */
  private extractSubject(
    message: string,
    lowerMessage: string,
  ): string | undefined {
    // Look for quoted text
    const quotedMatch =
      message.match(/"([^"]+)"/) || message.match(/'([^']+)'/);
    if (quotedMatch) {
      return quotedMatch[1];
    }

    // Look for specific nouns after keywords
    const keywords = ['about', 'regarding', 'concerning', 'for', 'with'];
    for (const keyword of keywords) {
      const index = lowerMessage.indexOf(keyword);
      if (index !== -1) {
        const afterKeyword = message.substring(index + keyword.length).trim();
        const words = afterKeyword.split(' ').slice(0, 5).join(' ');
        if (words.length > 3) {
          return words;
        }
      }
    }

    return undefined;
  }

  /**
   * Calculate confidence in the analysis
   */
  private calculateConfidence(
    message: string,
    intent: string,
    domain: string,
  ): number {
    let confidence = 0.5; // Base confidence

    // Higher confidence if intent is specific
    if (intent !== 'general') confidence += 0.2;

    // Higher confidence if domain is specific
    if (domain !== 'general') confidence += 0.2;

    // Higher confidence for longer messages
    if (message.length > 50) confidence += 0.1;

    return Math.min(confidence, 1.0);
  }

  /**
   * Determine message complexity
   */
  private determineComplexity(
    message: string,
  ): 'simple' | 'medium' | 'complex' {
    const wordCount = message.split(' ').length;
    const sentenceCount = (message.match(/[.!?]+/g) || []).length;

    if (wordCount < 10 && sentenceCount <= 1) return 'simple';
    if (wordCount < 30 && sentenceCount <= 3) return 'medium';
    return 'complex';
  }

  /**
   * Simple sentiment analysis
   */
  private determineSentiment(
    lowerMessage: string,
  ): 'positive' | 'negative' | 'neutral' {
    const positiveWords = [
      'good',
      'great',
      'excellent',
      'awesome',
      'love',
      'like',
      'best',
      'perfect',
    ];
    const negativeWords = [
      'bad',
      'terrible',
      'awful',
      'hate',
      'worst',
      'broken',
      'fail',
      'error',
    ];

    const positiveCount = positiveWords.filter((word) =>
      lowerMessage.includes(word),
    ).length;
    const negativeCount = negativeWords.filter((word) =>
      lowerMessage.includes(word),
    ).length;

    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  }
}
