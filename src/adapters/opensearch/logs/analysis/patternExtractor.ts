import { logger } from '../../../../utils/logger.js';
import { ILogsAdapter } from '../core/interface.js';
import { LogAnalyzer, LogEntry, LogPattern, LogStats } from './logAnalyzer.js';

/**
 * Pattern extraction options
 */
export interface PatternExtractionOptions {
  timeRange?: { from: string; to: string };
  service?: string | string[];
  level?: string | string[];
  minSupport?: number;
  maxPatterns?: number;
  includeStats?: boolean;
}

/**
 * Pattern change detection result
 */
export interface PatternChange {
  pattern: string;
  change: 'new' | 'removed' | 'increased' | 'decreased';
  previousCount: number;
  currentCount: number;
  changePercent: number;
  significance: 'high' | 'medium' | 'low';
}

/**
 * Clean log pattern extraction and analysis
 */
export class LogPatternExtractor {
  constructor(
    private readonly adapter: ILogsAdapter,
    private readonly analyzer: LogAnalyzer
  ) {}

  /**
   * Extract log patterns
   */
  public async extractPatterns(
    options: PatternExtractionOptions = {}
  ): Promise<{
    patterns: LogPattern[];
    stats: LogStats;
    summary: string;
  }> {
    logger.info('[LogPatternExtractor] Extracting patterns', { options });

    try {
      // Fetch logs for analysis
      const logs = await this.fetchLogs(options);
      
      if (logs.length === 0) {
        return {
          patterns: [],
          stats: {
            total: 0,
            levels: {},
            services: {},
            errorRate: 0,
            avgMessageLength: 0,
            uniquePatterns: 0
          },
          summary: 'No logs found in the specified time range'
        };
      }

      // Extract patterns
      const patterns = this.analyzer.extractPatterns(logs, {
        minSupport: options.minSupport || 2,
        maxPatterns: options.maxPatterns || 100
      });

      // Calculate statistics if requested
      const stats = options.includeStats !== false 
        ? this.analyzer.calculateStats(logs)
        : this.createMinimalStats(logs.length, patterns.length);

      // Generate summary
      const summary = this.generatePatternSummary(patterns, stats);

      return {
        patterns,
        stats,
        summary
      };
    } catch (error) {
      logger.error('[LogPatternExtractor] Error extracting patterns', { error });
      throw error;
    }
  }

  /**
   * Detect pattern changes between two time ranges
   */
  public async detectChanges(
    timeRange1: { from: string; to: string },
    timeRange2: { from: string; to: string },
    options: PatternExtractionOptions = {}
  ): Promise<{
    changes: PatternChange[];
    summary: {
      newPatterns: number;
      removedPatterns: number;
      increasedPatterns: number;
      decreasedPatterns: number;
      totalPatternsBefore: number;
      totalPatternsAfter: number;
    };
    insights: string[];
  }> {
    logger.info('[LogPatternExtractor] Detecting pattern changes', {
      timeRange1,
      timeRange2,
      options
    });

    try {
      // Extract patterns for both time ranges
      const [patterns1, patterns2] = await Promise.all([
        this.extractPatterns({ ...options, timeRange: timeRange1 }),
        this.extractPatterns({ ...options, timeRange: timeRange2 })
      ]);

      // Build pattern maps
      const patternMap1 = new Map(patterns1.patterns.map(p => [p.pattern, p]));
      const patternMap2 = new Map(patterns2.patterns.map(p => [p.pattern, p]));

      // Detect changes
      const changes: PatternChange[] = [];

      // Check for new and changed patterns
      for (const [pattern, data2] of patternMap2) {
        const data1 = patternMap1.get(pattern);
        
        if (!data1) {
          // New pattern
          changes.push({
            pattern,
            change: 'new',
            previousCount: 0,
            currentCount: data2.count,
            changePercent: 100,
            significance: this.calculateSignificance(0, data2.count, patterns1.stats.total, patterns2.stats.total)
          });
        } else {
          // Existing pattern - check for changes
          const changePercent = ((data2.count - data1.count) / data1.count) * 100;
          
          if (Math.abs(changePercent) > 10) {
            changes.push({
              pattern,
              change: changePercent > 0 ? 'increased' : 'decreased',
              previousCount: data1.count,
              currentCount: data2.count,
              changePercent,
              significance: this.calculateSignificance(data1.count, data2.count, patterns1.stats.total, patterns2.stats.total)
            });
          }
        }
      }

      // Check for removed patterns
      for (const [pattern, data1] of patternMap1) {
        if (!patternMap2.has(pattern)) {
          changes.push({
            pattern,
            change: 'removed',
            previousCount: data1.count,
            currentCount: 0,
            changePercent: -100,
            significance: this.calculateSignificance(data1.count, 0, patterns1.stats.total, patterns2.stats.total)
          });
        }
      }

      // Sort by significance and change magnitude
      changes.sort((a, b) => {
        const sigOrder = { high: 3, medium: 2, low: 1 };
        const sigDiff = sigOrder[b.significance] - sigOrder[a.significance];
        if (sigDiff !== 0) return sigDiff;
        return Math.abs(b.changePercent) - Math.abs(a.changePercent);
      });

      // Calculate summary
      const summary = {
        newPatterns: changes.filter(c => c.change === 'new').length,
        removedPatterns: changes.filter(c => c.change === 'removed').length,
        increasedPatterns: changes.filter(c => c.change === 'increased').length,
        decreasedPatterns: changes.filter(c => c.change === 'decreased').length,
        totalPatternsBefore: patterns1.patterns.length,
        totalPatternsAfter: patterns2.patterns.length
      };

      // Generate insights
      const insights = this.generateChangeInsights(changes, summary, patterns1.stats, patterns2.stats);

      return {
        changes,
        summary,
        insights
      };
    } catch (error) {
      logger.error('[LogPatternExtractor] Error detecting changes', { error });
      throw error;
    }
  }

  /**
   * Find correlated patterns
   */
  public async findCorrelatedPatterns(
    options: PatternExtractionOptions & {
      windowSize?: string;
      minCorrelation?: number;
    } = {}
  ): Promise<{
    correlations: Array<{
      pattern1: string;
      pattern2: string;
      correlation: number;
      coOccurrences: number;
    }>;
    graph: {
      nodes: Array<{ id: string; label: string; count: number }>;
      edges: Array<{ source: string; target: string; weight: number }>;
    };
  }> {
    logger.info('[LogPatternExtractor] Finding correlated patterns', { options });

    try {
      // Fetch logs
      const logs = await this.fetchLogs(options);
      
      // Find correlations
      const correlations = this.analyzer.findCorrelatedPatterns(logs, {
        windowSize: options.windowSize || '1m',
        minCorrelation: options.minCorrelation || 0.7
      });

      // Build graph representation
      const patterns = this.analyzer.extractPatterns(logs);
      const patternMap = new Map(patterns.map(p => [p.pattern, p]));
      
      const nodes = correlations
        .flatMap(c => [c.pattern1, c.pattern2])
        .filter((p, i, arr) => arr.indexOf(p) === i)
        .map(pattern => ({
          id: pattern,
          label: this.truncatePattern(pattern),
          count: patternMap.get(pattern)?.count || 0
        }));

      const edges = correlations.map(c => ({
        source: c.pattern1,
        target: c.pattern2,
        weight: c.correlation
      }));

      return {
        correlations,
        graph: { nodes, edges }
      };
    } catch (error) {
      logger.error('[LogPatternExtractor] Error finding correlations', { error });
      throw error;
    }
  }

  // Private helper methods

  private async fetchLogs(options: PatternExtractionOptions): Promise<LogEntry[]> {
    const query: any = {
      size: 10000, // Get enough logs for pattern analysis
      query: { bool: { must: [], filter: [] } },
      sort: [{ '@timestamp': { order: 'desc' } }]
    };

    if (options.timeRange) {
      query.query.bool.filter.push({
        range: {
          '@timestamp': {
            gte: options.timeRange.from,
            lte: options.timeRange.to
          }
        }
      });
    }

    if (options.service) {
      const services = Array.isArray(options.service) ? options.service : [options.service];
      query.query.bool.filter.push({
        terms: { 'service.name': services }
      });
    }

    if (options.level) {
      const levels = Array.isArray(options.level) ? options.level : [options.level];
      query.query.bool.filter.push({
        terms: { level: levels.map(l => l.toLowerCase()) }
      });
    }

    const response = await this.adapter.searchLogs(query);
    return (response.hits?.hits || []).map((hit: any) => ({
      timestamp: hit._source['@timestamp'] || hit._source.timestamp,
      level: hit._source.level || hit._source.SeverityText || 'info',
      message: hit._source.message || hit._source.Body || '',
      service: hit._source.service?.name || hit._source.resource?.service?.name,
      traceId: hit._source.traceId || hit._source.trace_id,
      spanId: hit._source.spanId || hit._source.span_id,
      attributes: hit._source.attributes || {}
    }));
  }

  private createMinimalStats(total: number, uniquePatterns: number): LogStats {
    return {
      total,
      levels: {},
      services: {},
      errorRate: 0,
      avgMessageLength: 0,
      uniquePatterns
    };
  }

  private generatePatternSummary(patterns: LogPattern[], stats: LogStats): string {
    const parts = [];
    
    parts.push(`Found ${patterns.length} unique patterns in ${stats.total} logs.`);
    
    if (patterns.length > 0) {
      const topPattern = patterns[0];
      parts.push(`Most common pattern appears ${topPattern.count} times (${(topPattern.frequency * 100).toFixed(1)}%).`);
      
      const highFreqPatterns = patterns.filter(p => p.frequency > 0.1);
      if (highFreqPatterns.length > 0) {
        parts.push(`${highFreqPatterns.length} patterns account for >10% of logs each.`);
      }
    }
    
    return parts.join(' ');
  }

  private calculateSignificance(
    prevCount: number,
    currCount: number,
    prevTotal: number,
    currTotal: number
  ): 'high' | 'medium' | 'low' {
    // Normalize counts by total logs
    const prevFreq = prevTotal > 0 ? prevCount / prevTotal : 0;
    const currFreq = currTotal > 0 ? currCount / currTotal : 0;
    
    // Calculate relative change
    const relativeChange = prevFreq > 0 
      ? Math.abs(currFreq - prevFreq) / prevFreq
      : (currFreq > 0 ? 1 : 0);
    
    // Determine significance
    if (relativeChange > 0.5 || currFreq > 0.1 || prevFreq > 0.1) {
      return 'high';
    } else if (relativeChange > 0.25 || currFreq > 0.05 || prevFreq > 0.05) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  private generateChangeInsights(
    changes: PatternChange[],
    summary: any,
    stats1: LogStats,
    stats2: LogStats
  ): string[] {
    const insights: string[] = [];
    
    // Overall pattern change
    const patternChangeRate = Math.abs(summary.totalPatternsAfter - summary.totalPatternsBefore) / summary.totalPatternsBefore;
    if (patternChangeRate > 0.3) {
      insights.push(`Significant pattern diversity change: ${(patternChangeRate * 100).toFixed(0)}% ${summary.totalPatternsAfter > summary.totalPatternsBefore ? 'increase' : 'decrease'}`);
    }
    
    // New patterns insight
    if (summary.newPatterns > 5) {
      const topNewPatterns = changes
        .filter(c => c.change === 'new' && c.significance === 'high')
        .slice(0, 3);
      if (topNewPatterns.length > 0) {
        insights.push(`${summary.newPatterns} new patterns emerged, indicating potential new behaviors or issues`);
      }
    }
    
    // Removed patterns insight
    if (summary.removedPatterns > 5) {
      insights.push(`${summary.removedPatterns} patterns disappeared, suggesting resolved issues or changed behavior`);
    }
    
    // High significance changes
    const highSigChanges = changes.filter(c => c.significance === 'high');
    if (highSigChanges.length > 0) {
      const errorRelated = highSigChanges.filter(c => 
        c.pattern.toLowerCase().includes('error') || 
        c.pattern.toLowerCase().includes('exception')
      );
      if (errorRelated.length > 0) {
        insights.push(`${errorRelated.length} significant changes in error-related patterns detected`);
      }
    }
    
    // Volume change
    const volumeChange = ((stats2.total - stats1.total) / stats1.total) * 100;
    if (Math.abs(volumeChange) > 50) {
      insights.push(`Log volume ${volumeChange > 0 ? 'increased' : 'decreased'} by ${Math.abs(volumeChange).toFixed(0)}%`);
    }
    
    return insights;
  }

  private truncatePattern(pattern: string, maxLength: number = 50): string {
    if (pattern.length <= maxLength) return pattern;
    return pattern.substring(0, maxLength - 3) + '...';
  }
}