import { z } from 'zod';
import { BaseTool, ToolCategory } from '../../base/tool.js';
import { BaseSearchAdapter } from '../../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../../config/index.js';
import { MCPToolSchema } from '../../../types.js';

/**
 * Zod schema for semantic log search arguments
 */
const SemanticLogSearchSchema = {
  query: z.string().describe('Natural language search query'),
  from: z.string().describe('Start time (ISO 8601 or relative format like "now-1h")'),
  to: z.string().describe('End time (ISO 8601 or relative format like "now")'),
  service: z.string().optional().describe('Service name to filter results (optional)'),
  maxResults: z.number().min(1).max(100).optional().describe('Maximum number of results to return (default: 20)')
};

type SemanticLogSearchArgs = MCPToolSchema<typeof SemanticLogSearchSchema>;

/**
 * ML-powered semantic log search tool
 */
export class SemanticLogSearchTool extends BaseTool<typeof SemanticLogSearchSchema> {
  // Static schema property
  static readonly schema = SemanticLogSearchSchema;
  
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'searchLogsSemantic',
      category: ToolCategory.ANALYSIS,
      description: 'Search logs using natural language queries with semantic understanding for intuitive log exploration',
      requiredCapabilities: ['ml', 'search'],
      backendSpecific: null // Available for any backend with ML
    });
  }
  
  protected getSchema() {
    return SemanticLogSearchSchema;
  }
  
  protected async executeImpl(args: SemanticLogSearchArgs): Promise<any> {
    const config = ConfigLoader.get();
    
    // Analyze query intent
    const queryIntent = this.analyzeQueryIntent(args.query);
    
    // Default time range if not provided
    const timeRange = {
      from: args.from || this.suggestTimeRange(queryIntent),
      to: args.to || 'now'
    };
    
    // Build options for semantic search
    const options: any = {
      size: args.maxResults || 20,
      timeRange
    };
    
    if (args.service) {
      options.filter = {
        term: { [config.telemetry.fields.service]: args.service }
      };
    }
    
    const result = await this.adapter.semanticLogSearch(args.query, options);
    
    // Enhance results with contextual search if needed
    const enhancedResult = await this.enhanceWithContext(result, args, queryIntent);
    
    // Analyze the results
    const analysis = this.analyzeSemanticResults(enhancedResult, args.query);
    
    // Generate insights based on intent
    const insights = this.generateIntentBasedInsights(enhancedResult, queryIntent);
    
    return this.formatJsonOutput({
      query: args.query,
      queryIntent,
      timeRange,
      service: args.service,
      results: enhancedResult.hits || [],
      totalHits: enhancedResult.total || 0,
      maxScore: enhancedResult.maxScore || 0,
      analysis,
      insights,
      suggestions: this.generateQuerySuggestions(args.query, enhancedResult),
      relatedSearches: this.suggestRelatedSearches(queryIntent, enhancedResult)
    });
  }
  
  private analyzeSemanticResults(result: any, _query: string): any {
    const hits = result.hits || [];
    
    if (hits.length === 0) {
      return {
        relevance: 'no_results',
        distribution: {},
        themes: []
      };
    }
    
    // Analyze score distribution
    const scores = hits.map((hit: any) => hit._score || 0);
    const avgScore = scores.reduce((sum: number, s: number) => sum + s, 0) / scores.length;
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    
    // Determine relevance quality
    let relevance: string;
    if (avgScore > 0.8) {
      relevance = 'excellent';
    } else if (avgScore > 0.6) {
      relevance = 'good';
    } else if (avgScore > 0.4) {
      relevance = 'moderate';
    } else {
      relevance = 'poor';
    }
    
    // Extract common themes/terms
    const themes = this.extractThemes(hits);
    
    // Service distribution
    const serviceDistribution: Record<string, number> = {};
    hits.forEach((hit: any) => {
      const service = hit._source?.service?.name || hit._source?.resource?.service?.name || 'unknown';
      serviceDistribution[service] = (serviceDistribution[service] || 0) + 1;
    });
    
    return {
      relevance,
      scoreStats: {
        avg: Math.round(avgScore * 100) / 100,
        max: Math.round(maxScore * 100) / 100,
        min: Math.round(minScore * 100) / 100
      },
      serviceDistribution,
      themes
    };
  }
  
  private extractThemes(hits: any[]): string[] {
    // Simple theme extraction based on common terms
    const termFrequency: Record<string, number> = {};
    
    hits.forEach((hit: any) => {
      const message = hit._source?.message || hit._source?.Body || '';
      const words = message.toLowerCase().split(/\s+/);
      
      words.forEach((word: string) => {
        // Skip common words and short words
        if (word.length > 3 && !this.isCommonWord(word)) {
          termFrequency[word] = (termFrequency[word] || 0) + 1;
        }
      });
    });
    
    // Get top themes
    return Object.entries(termFrequency)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([term]) => term);
  }
  
  private isCommonWord(word: string): boolean {
    const commonWords = new Set([
      'this', 'that', 'with', 'from', 'have', 'been',
      'will', 'your', 'more', 'when', 'some', 'there',
      'their', 'would', 'could', 'should', 'about'
    ]);
    return commonWords.has(word);
  }
  
  private generateQuerySuggestions(query: string, result: any): string[] {
    const suggestions: string[] = [];
    
    if (!result.hits || result.hits.length === 0) {
      // No results - suggest broader queries
      suggestions.push(`Try a broader search: "${query.split(' ').slice(0, 2).join(' ')}"`);
      suggestions.push(`Try searching for individual terms from: "${query}"`);
    } else if (result.maxScore < 0.5) {
      // Low relevance - suggest more specific queries
      const themes = this.extractThemes(result.hits);
      if (themes.length > 0) {
        suggestions.push(`Try adding specific terms like: ${themes.slice(0, 3).join(', ')}`);
      }
    }
    
    return suggestions;
  }
  
  private analyzeQueryIntent(query: string): any {
    const lowerQuery = query.toLowerCase();
    const intent: any = {
      type: 'general',
      keywords: [],
      context: {},
      confidence: 0
    };
    
    // Error investigation patterns
    if (lowerQuery.match(/error|exception|fail|crash|timeout|refused|denied/)) {
      intent.type = 'error_investigation';
      intent.confidence = 0.9;
      intent.context.severity = lowerQuery.includes('crash') || lowerQuery.includes('fatal') ? 'high' : 'medium';
    }
    
    // Performance investigation patterns
    else if (lowerQuery.match(/slow|latency|performance|delay|lag|response time/)) {
      intent.type = 'performance_investigation';
      intent.confidence = 0.9;
      intent.context.metric = 'latency';
    }
    
    // Root cause analysis patterns
    else if (lowerQuery.match(/why|cause|reason|debug|investigate|root cause/)) {
      intent.type = 'root_cause_analysis';
      intent.confidence = 0.8;
      intent.context.depth = 'deep';
    }
    
    // Monitoring/status check patterns
    else if (lowerQuery.match(/status|health|monitor|check|verify/)) {
      intent.type = 'status_check';
      intent.confidence = 0.7;
      intent.context.scope = 'overview';
    }
    
    // Extract key entities
    const serviceMatch = query.match(/(\w+)[-_]?service/i);
    if (serviceMatch) {
      intent.keywords.push({ type: 'service', value: serviceMatch[1] });
    }
    
    const timeIndicators = query.match(/last (\d+) (minutes?|hours?|days?)/i);
    if (timeIndicators) {
      intent.keywords.push({ type: 'time', value: timeIndicators[0], amount: timeIndicators[1], unit: timeIndicators[2] });
    }
    
    const errorTypes = query.match(/(\w+Error|\w+Exception)/g);
    if (errorTypes) {
      intent.keywords.push(...errorTypes.map(e => ({ type: 'error_type', value: e })));
    }
    
    return intent;
  }
  
  private suggestTimeRange(queryIntent: any): string {
    // Suggest appropriate time range based on intent
    switch (queryIntent.type) {
      case 'error_investigation':
        return queryIntent.context.severity === 'high' ? 'now-30m' : 'now-1h';
      case 'performance_investigation':
        return 'now-2h'; // Need more data for performance trends
      case 'root_cause_analysis':
        return 'now-4h'; // Need historical context
      case 'status_check':
        return 'now-15m'; // Recent status is most relevant
      default:
        return 'now-1h';
    }
  }
  
  private async enhanceWithContext(result: any, args: SemanticLogSearchArgs, queryIntent: any): Promise<any> {
    // If results are insufficient and intent suggests deeper search
    if (result.hits.length < 5 && queryIntent.type === 'root_cause_analysis') {
      // Expand time range for more context
      const expandedTimeRange = {
        from: 'now-6h',
        to: args.to || 'now'
      };
      
      const expandedOptions: any = {
        size: 50,
        timeRange: expandedTimeRange
      };
      
      if (args.service) {
        expandedOptions.filter = {
          term: { [ConfigLoader.get().telemetry.fields.service]: args.service }
        };
      }
      
      const expandedResult = await this.adapter.semanticLogSearch(args.query, expandedOptions);
      
      return {
        ...result,
        hits: [...result.hits, ...expandedResult.hits.slice(0, 10)],
        total: result.total + expandedResult.total,
        contextExpanded: true,
        expandedTimeRange
      };
    }
    
    // For error investigations, also search for related errors
    if (queryIntent.type === 'error_investigation' && result.hits.length > 0) {
      const errorTraceIds = result.hits
        .map((hit: any) => hit._source?.trace?.id || hit._source?.traceId)
        .filter(Boolean)
        .slice(0, 5);
      
      if (errorTraceIds.length > 0) {
        result.relatedTraces = errorTraceIds;
        result.recommendation = 'Check trace IDs for distributed error context';
      }
    }
    
    return result;
  }
  
  private generateIntentBasedInsights(result: any, queryIntent: any): any {
    const insights: any = {
      summary: '',
      findings: [],
      recommendations: [],
      nextSteps: []
    };
    
    const hits = result.hits || [];
    
    switch (queryIntent.type) {
      case 'error_investigation':
        if (hits.length > 0) {
          // Group errors by type
          const errorGroups: Record<string, number> = {};
          hits.forEach((hit: any) => {
            const msg = hit._source?.message || '';
            const errorType = this.extractErrorType(msg);
            errorGroups[errorType] = (errorGroups[errorType] || 0) + 1;
          });
          
          insights.summary = `Found ${hits.length} error logs with ${Object.keys(errorGroups).length} distinct error types`;
          insights.findings = Object.entries(errorGroups)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([type, count]) => ({
              type: 'error_pattern',
              description: `${type}: ${count} occurrences`,
              severity: count > 10 ? 'high' : 'medium'
            }));
          
          insights.recommendations.push(
            'Investigate the most frequent error types first',
            'Check if errors are correlated with specific services or operations'
          );
          
          insights.nextSteps.push(
            `Search for traces with errors: traceId in [${result.relatedTraces?.join(', ') || 'none found'}]`,
            'Check metrics for the same time period to identify resource issues'
          );
        } else {
          insights.summary = 'No errors found in the specified time range';
          insights.recommendations.push('Expand the time range or refine search terms');
        }
        break;
        
      case 'performance_investigation':
        if (hits.length > 0) {
          const latencyMentions = hits.filter((hit: any) => 
            (hit._source?.message || '').match(/\d+\s*(ms|seconds?)/i)
          );
          
          insights.summary = `Found ${hits.length} performance-related logs`;
          if (latencyMentions.length > 0) {
            insights.findings.push({
              type: 'latency_mentions',
              description: `${latencyMentions.length} logs mention specific latency values`,
              examples: latencyMentions.slice(0, 3).map((h: any) => h._source?.message)
            });
          }
          
          insights.recommendations.push(
            'Correlate with trace data for detailed timing breakdown',
            'Check if performance issues coincide with deployment events'
          );
        }
        break;
        
      case 'root_cause_analysis':
        if (hits.length > 0) {
          // Look for causality indicators
          const causalityIndicators = hits.filter((hit: any) => {
            const msg = (hit._source?.message || '').toLowerCase();
            return msg.includes('caused by') || msg.includes('due to') || msg.includes('because');
          });
          
          insights.summary = `Analyzing ${hits.length} logs for root cause indicators`;
          
          if (causalityIndicators.length > 0) {
            insights.findings.push({
              type: 'causality_found',
              description: `Found ${causalityIndicators.length} logs with explicit cause indicators`,
              examples: causalityIndicators.slice(0, 2).map((h: any) => h._source?.message)
            });
          }
          
          // Time-based analysis
          const timeSpread = this.analyzeTimeDistribution(hits);
          insights.findings.push({
            type: 'time_distribution',
            description: timeSpread.summary,
            pattern: timeSpread.pattern
          });
          
          insights.recommendations.push(
            'Focus on the earliest errors in the time sequence',
            'Look for configuration changes or deployments before the issue started'
          );
        }
        break;
        
      default:
        insights.summary = `Found ${hits.length} relevant logs`;
    }
    
    return insights;
  }
  
  private extractErrorType(message: string): string {
    // Extract error type from message
    const errorMatch = message.match(/(\w+Error|\w+Exception|ERROR|FATAL|CRITICAL)/);
    if (errorMatch) return errorMatch[1];
    
    if (message.toLowerCase().includes('timeout')) return 'TimeoutError';
    if (message.toLowerCase().includes('connection')) return 'ConnectionError';
    if (message.toLowerCase().includes('null pointer')) return 'NullPointerError';
    if (message.toLowerCase().includes('out of memory')) return 'OutOfMemoryError';
    
    return 'UnknownError';
  }
  
  private analyzeTimeDistribution(hits: any[]): any {
    if (hits.length === 0) {
      return { summary: 'No time distribution data', pattern: 'none' };
    }
    
    // Sort by timestamp
    const sortedHits = hits.sort((a, b) => {
      const timeA = new Date(a._source?.['@timestamp'] || 0).getTime();
      const timeB = new Date(b._source?.['@timestamp'] || 0).getTime();
      return timeA - timeB;
    });
    
    const firstTime = new Date(sortedHits[0]._source?.['@timestamp']).getTime();
    const lastTime = new Date(sortedHits[sortedHits.length - 1]._source?.['@timestamp']).getTime();
    const duration = lastTime - firstTime;
    
    // Analyze distribution pattern
    let pattern = 'unknown';
    let summary = '';
    
    if (duration < 60000) { // Less than 1 minute
      pattern = 'burst';
      summary = 'All logs occurred within 1 minute - indicates sudden issue';
    } else if (duration < 300000) { // Less than 5 minutes
      pattern = 'rapid';
      summary = 'Logs spread over several minutes - rapid escalation';
    } else {
      // Check for clusters
      const timeDiffs = [];
      for (let i = 1; i < sortedHits.length; i++) {
        const diff = new Date(sortedHits[i]._source?.['@timestamp']).getTime() - 
                    new Date(sortedHits[i-1]._source?.['@timestamp']).getTime();
        timeDiffs.push(diff);
      }
      
      const avgDiff = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;
      const maxDiff = Math.max(...timeDiffs);
      
      if (maxDiff > avgDiff * 5) {
        pattern = 'intermittent';
        summary = 'Logs show intermittent pattern - possible recurring issue';
      } else {
        pattern = 'continuous';
        summary = 'Logs show continuous pattern - ongoing issue';
      }
    }
    
    return { summary, pattern, duration, firstTime, lastTime };
  }
  
  private suggestRelatedSearches(queryIntent: any, result: any): string[] {
    const suggestions = [];
    
    switch (queryIntent.type) {
      case 'error_investigation':
        if (result.hits.length > 0) {
          const services = [...new Set(result.hits.map((h: any) => 
            h._source?.service?.name || h._source?.resource?.service?.name
          ).filter(Boolean))];
          
          if (services.length > 0) {
            suggestions.push(`"${services[0]} trace errors" in traces`);
            suggestions.push(`"${services[0]} metrics anomaly" for performance correlation`);
          }
          
          suggestions.push('deployment events in the same timeframe');
        }
        break;
        
      case 'performance_investigation':
        suggestions.push('database query performance logs');
        suggestions.push('network latency or timeout errors');
        suggestions.push('resource utilization (CPU/memory) metrics');
        break;
        
      case 'root_cause_analysis':
        suggestions.push('configuration changes before the incident');
        suggestions.push('similar patterns in the past week');
        suggestions.push('service dependency errors');
        break;
    }
    
    // Add general suggestions based on findings
    if (result.contextExpanded) {
      suggestions.push('narrow down time range once root cause is identified');
    }
    
    return suggestions.slice(0, 5);
  }
}