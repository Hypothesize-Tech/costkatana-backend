/**
 * Response Formatters Service
 * Modular response formatting for different agent operation types
 */

import { loggingService } from './logging.service';

export interface ToolOutput {
  success: boolean;
  operation: string;
  data: any;
  message?: string;
}

export class ResponseFormattersService {
  /**
   * Format token usage response
   */
  static formatTokenUsageResponse(data: any): string {
    if (data.summary) {
      const summary = data.summary;
      let response = `${data.message || "Here's your token usage:"}\n\n`;
      response += `📊 **Usage Summary:**\n`;
      response += `• Total tokens: ${summary.totalTokens?.toLocaleString() || 'N/A'}\n`;
      response += `• Prompt tokens: ${summary.promptTokens?.toLocaleString() || 'N/A'}\n`;
      response += `• Completion tokens: ${summary.completionTokens?.toLocaleString() || 'N/A'}\n`;
      response += `• Total cost: $${summary.totalCost || '0.00'}\n`;
      response += `• Total requests: ${summary.totalRequests || 'N/A'}\n`;
      response += `• Avg tokens per request: ${summary.avgTokensPerRequest || 'N/A'}\n`;
      response += `• Cost per token: $${summary.costPerToken || '0.00'}\n\n`;

      if (data.timeRangeAdjusted) {
        response += `💡 **Note:** I adjusted the time range to show your available data.\n\n`;
      }

      if (data.modelBreakdown && data.modelBreakdown.length > 0) {
        response += `🤖 **Top Models:**\n`;
        data.modelBreakdown.slice(0, 3).forEach((model: any, index: number) => {
          response += `${index + 1}. ${model.model}: ${model.totalTokens?.toLocaleString()} tokens ($${model.totalCost})\n`;
        });
        response += '\n';
      }

      if (data.insights && data.insights.length > 0) {
        response += `💡 **Insights:**\n`;
        data.insights.forEach((insight: string) => {
          response += `• ${insight}\n`;
        });
      }

      return response;
    } else if (data.message) {
      return `${data.message}\n\n${data.reasons ? 'Possible reasons:\n• ' + data.reasons.join('\n• ') : ''}\n\n${data.suggestions ? 'Suggestions:\n• ' + data.suggestions.join('\n• ') : ''}\n\n${data.nextSteps || ''}`;
    }

    return 'No token usage data available.';
  }

  /**
   * Format dashboard/cost response
   */
  static formatDashboardResponse(data: any): string {
    if (data.summary) {
      const summary = data.summary;
      return `Here's your cost summary:\n\n• Total requests: ${summary.totalRequests || 'N/A'}\n• Total cost: $${summary.totalCost || '0.00'}\n• Average cost per request: $${summary.avgCostPerRequest || '0.00'}\n• Unique models used: ${summary.uniqueModels || 'N/A'}\n\n${data.insights ? 'Key insights:\n• ' + data.insights.join('\n• ') : ''}`;
    } else if (data.message && data.totalRequests) {
      return `${data.message}\n\n📊 **Quick Stats:**\n• Total requests: ${data.totalRequests}\n\n${data.suggestion || 'Would you like me to get more detailed analytics?'}`;
    } else if (data.message) {
      return data.message;
    }

    return 'No cost data available.';
  }

  /**
   * Format model performance response
   */
  static formatModelPerformanceResponse(data: any): string {
    if (data.models && data.models.length > 0) {
      let response = `🚀 **Model Performance Analysis:**\n\n`;
      data.models.forEach((model: any, index: number) => {
        response += `${index + 1}. **${model.model}**\n`;
        response += `   • Avg Response Time: ${model.avgResponseTime || 'N/A'}s\n`;
        response += `   • Success Rate: ${model.successRate || 'N/A'}%\n`;
        response += `   • Cost Efficiency: ${model.costEfficiency || 'N/A'}\n\n`;
      });
      return response;
    } else if (data.message) {
      return data.message;
    }

    return 'No model performance data available.';
  }

  /**
   * Format usage patterns response
   */
  static formatUsagePatternsResponse(data: any): string {
    if (data.patterns) {
      let response = `📈 **Usage Patterns Analysis:**\n\n`;
      response += `• Peak Hours: ${data.patterns.peakHours || 'N/A'}\n`;
      response += `• Average Daily Requests: ${data.patterns.avgDaily || 'N/A'}\n`;
      response += `• Most Active Days: ${data.patterns.activeDays || 'N/A'}\n`;
      response += `• Usage Trend: ${data.patterns.trend || 'N/A'}\n\n`;
      if (data.insights) {
        response += `💡 **Insights:**\n`;
        data.insights.forEach((insight: string) => {
          response += `• ${insight}\n`;
        });
      }
      return response;
    } else if (data.message) {
      return data.message;
    }

    return 'No usage patterns data available.';
  }

  /**
   * Format cost trends response
   */
  static formatCostTrendsResponse(data: any): string {
    if (data.trends) {
      let response = `📊 **Cost Trends Analysis:**\n\n`;
      response += `• Monthly Growth: ${data.trends.monthlyGrowth || 'N/A'}%\n`;
      response += `• Average Monthly Cost: $${data.trends.avgMonthlyCost || '0.00'}\n`;
      response += `• Trend Direction: ${data.trends.direction || 'N/A'}\n`;
      if (data.projections) {
        response += `• Next Month Projection: $${data.projections.nextMonth || '0.00'}\n`;
      }
      return response;
    } else if (data.message) {
      return data.message;
    }

    return 'No cost trends data available.';
  }

  /**
   * Format user stats response
   */
  static formatUserStatsResponse(data: any): string {
    if (data.stats) {
      let response = `👤 **Account Statistics:**\n\n`;
      response += `• Total Requests: ${data.stats.totalRequests?.toLocaleString() || 'N/A'}\n`;
      response += `• Total Cost: $${data.stats.totalCost || '0.00'}\n`;
      response += `• Active Days: ${data.stats.activeDays || 'N/A'}\n`;
      response += `• Favorite Model: ${data.stats.favoriteModel || 'N/A'}\n`;
      response += `• Account Age: ${data.stats.accountAge || 'N/A'} days\n\n`;
      if (data.achievements) {
        response += `🏆 **Achievements:**\n`;
        data.achievements.forEach((achievement: string) => {
          response += `• ${achievement}\n`;
        });
      }
      return response;
    } else if (data.message) {
      return data.message;
    }

    return 'No user statistics available.';
  }

  /**
   * Format project analytics response
   */
  static formatProjectAnalyticsResponse(data: any): string {
    if (data.projects && data.projects.length > 0) {
      let response = `🔬 **Project Analytics:**\n\n`;
      data.projects.forEach((project: any, index: number) => {
        response += `${index + 1}. **${project.name}**\n`;
        response += `   • Cost: $${project.cost || '0.00'}\n`;
        response += `   • Requests: ${project.requests || 'N/A'}\n`;
        response += `   • Efficiency: ${project.efficiency || 'N/A'}\n\n`;
      });
      return response;
    } else if (data.message) {
      return data.message;
    }

    return 'No project analytics available.';
  }

  /**
   * Format anomaly detection response
   */
  static formatAnomalyDetectionResponse(data: any): string {
    if (data.anomalies && data.anomalies.length > 0) {
      let response = `⚠️ **Anomalies Detected:**\n\n`;
      data.anomalies.forEach((anomaly: any, index: number) => {
        response += `${index + 1}. **${anomaly.type}** on ${anomaly.date}\n`;
        response += `   • Description: ${anomaly.description}\n`;
        response += `   • Impact: ${anomaly.impact}\n`;
        response += `   • Recommendation: ${anomaly.recommendation}\n\n`;
      });
      return response;
    } else if (data.message) {
      return data.message;
    }

    return 'No anomalies detected.';
  }

  /**
   * Format forecasting response
   */
  static formatForecastingResponse(data: any): string {
    if (data.forecast) {
      let response = `🔮 **Cost Forecast:**\n\n`;
      response += `• Next Month: $${data.forecast.nextMonth || '0.00'}\n`;
      response += `• Next Quarter: $${data.forecast.nextQuarter || '0.00'}\n`;
      response += `• Confidence Level: ${data.forecast.confidence || 'N/A'}%\n`;
      response += `• Growth Rate: ${data.forecast.growthRate || 'N/A'}%\n\n`;
      if (data.recommendations) {
        response += `💡 **Recommendations:**\n`;
        data.recommendations.forEach((rec: string) => {
          response += `• ${rec}\n`;
        });
      }
      return response;
    } else if (data.message) {
      return data.message;
    }

    return 'No forecast data available.';
  }

  /**
   * Format comparative analysis response
   */
  static formatComparativeAnalysisResponse(data: any): string {
    if (data.comparison) {
      let response = `📊 **Comparative Analysis:**\n\n`;
      response += `• Current Period: $${data.comparison.current || '0.00'}\n`;
      response += `• Previous Period: $${data.comparison.previous || '0.00'}\n`;
      response += `• Change: ${data.comparison.change || 'N/A'}%\n`;
      response += `• Trend: ${data.comparison.trend || 'N/A'}\n\n`;
      if (data.insights) {
        response += `💡 **Key Changes:**\n`;
        data.insights.forEach((insight: string) => {
          response += `• ${insight}\n`;
        });
      }
      return response;
    } else if (data.message) {
      return data.message;
    }

    return 'No comparison data available.';
  }

  /**
   * Main formatter dispatcher
   */
  static formatResponse(toolOutput: ToolOutput): string {
    try {
      const { operation, data } = toolOutput;

      loggingService.info('🎨 Formatting response for operation:', {
        operation,
      });

      switch (operation) {
        case 'token_usage':
          return this.formatTokenUsageResponse(data);
        case 'dashboard_analytics':
          return this.formatDashboardResponse(data);
        case 'model_performance':
          return this.formatModelPerformanceResponse(data);
        case 'usage_patterns':
          return this.formatUsagePatternsResponse(data);
        case 'cost_trends':
          return this.formatCostTrendsResponse(data);
        case 'user_stats':
          return this.formatUserStatsResponse(data);
        case 'project_analytics':
          return this.formatProjectAnalyticsResponse(data);
        case 'anomaly_detection':
          return this.formatAnomalyDetectionResponse(data);
        case 'forecasting':
          return this.formatForecastingResponse(data);
        case 'comparative_analysis':
          return this.formatComparativeAnalysisResponse(data);
        default:
          // Generic successful response
          if (data.summary || data.message) {
            return data.summary || data.message;
          }
          return `Operation ${operation} completed successfully.`;
      }
    } catch (error) {
      loggingService.error('Error formatting response:', {
        error: error instanceof Error ? error.message : String(error),
        operation: toolOutput.operation,
      });
      return 'I successfully retrieved your data, but encountered a formatting issue. The operation completed successfully.';
    }
  }

  /**
   * Generate fallback response based on query type
   */
  static generateFallbackResponse(query: string): string {
    const queryLower = query.toLowerCase();

    if (queryLower.includes('token')) {
      return "I couldn't find any token usage data for your account. This might mean you're new to the platform or haven't made API calls recently. Would you like me to help you set up API tracking?";
    } else if (
      queryLower.includes('cost') ||
      queryLower.includes('spend') ||
      queryLower.includes('budget')
    ) {
      return "I couldn't find any cost data for the specified period. This might mean you haven't made any API calls yet or the data is in a different time range. Would you like me to check a different time period?";
    } else if (
      queryLower.includes('model') ||
      queryLower.includes('performance')
    ) {
      return "I couldn't find any model performance data for your account. This might mean you need more usage data to generate performance metrics. Try making some API calls first.";
    } else if (queryLower.includes('pattern') || queryLower.includes('usage')) {
      return "I couldn't find any usage patterns for your account. This typically requires at least a few days of API activity to establish patterns.";
    } else if (
      queryLower.includes('trend') ||
      queryLower.includes('forecast')
    ) {
      return "I couldn't generate trend analysis or forecasts. This requires historical data over multiple time periods. Try using the platform for a few weeks first.";
    } else if (
      queryLower.includes('anomal') ||
      queryLower.includes('unusual')
    ) {
      return "I couldn't detect any anomalies in your usage. This is actually good news! Anomaly detection requires baseline usage patterns to identify unusual activity.";
    } else if (queryLower.includes('project')) {
      return "I couldn't find any project-specific analytics. Make sure you have projects set up and have been using them for API calls.";
    } else if (
      queryLower.includes('compare') ||
      queryLower.includes('comparison')
    ) {
      return "I couldn't perform the requested comparison. This might be due to insufficient data in one or both periods being compared.";
    } else {
      return "I was unable to complete your request fully, but I'm here to help. Could you please rephrase your question to be more specific? For example:\n\n• 'Show my token usage this month'\n• 'What did I spend on Claude vs GPT?'\n• 'Which model performs best?'\n• 'Show my usage patterns'\n• 'Compare this month to last month'";
    }
  }
}
