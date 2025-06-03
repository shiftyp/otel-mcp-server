import { logger } from '../../../../utils/logger.js';
import { LogsCoreAdapter } from '../core/adapter.js';
import { LogEntry } from '../core/types.js';

/**
 * Log pattern structure
 */
export interface LogPattern {
  pattern: string;
  count: number;
  percentage: number;
  examples: string[];
  services: string[];
  levels: string[];
  signature: string;
}

/**
 * Pattern extraction options
 */
export interface PatternExtractionOptions {
  timeRange?: { from: string; to: string };
  service?: string | string[];
  level?: string | string[];
  minSupport?: number;
  maxPatterns?: number;
  includeNumbers?: boolean;
  includeTimestamps?: boolean;
}

/**
 * Pattern change detection
 */
export interface PatternChange {
  pattern: string;
  changeType: 'new' | 'missing' | 'frequency';
  oldCount: number;
  newCount: number;
  percentageChange: number;
}

/**
 * Log pattern extractor
 */
export class LogPatternExtractor {
  constructor(private readonly adapter: LogsCoreAdapter) {}

  /**
   * Extract patterns from logs
   */
  public async extractPatterns(
    options: PatternExtractionOptions = {}
  ): Promise<LogPattern[]> {
    logger.info('[LogPatternExtractor] Extracting patterns', { options });

    const logs = await this.fetchLogs(options);
    
    if (logs.length === 0) {
      return [];
    }

    // Extract patterns from messages
    const patternMap = new Map<string, {
      pattern: string;
      count: number;
      examples: Set<string>;
      services: Set<string>;
      levels: Set<string>;
    }>();

    for (const log of logs) {
      const normalized = this.normalizeMessage(log.message, options);
      const signature = this.generateSignature(normalized);
      
      if (!patternMap.has(signature)) {
        patternMap.set(signature, {
          pattern: normalized,
          count: 0,
          examples: new Set(),
          services: new Set(),
          levels: new Set()
        });
      }
      
      const pattern = patternMap.get(signature)!;
      pattern.count++;
      
      if (pattern.examples.size < 3) {
        pattern.examples.add(log.message);
      }
      
      if (log.service) {
        pattern.services.add(log.service);
      }
      
      pattern.levels.add(log.level);
    }

    // Convert to array and calculate percentages
    const totalLogs = logs.length;
    const patterns: LogPattern[] = [];
    const minSupport = options.minSupport || 0.01; // 1% by default

    for (const [signature, data] of patternMap) {
      const percentage = data.count / totalLogs;
      
      if (percentage >= minSupport) {
        patterns.push({
          pattern: data.pattern,
          count: data.count,
          percentage,
          examples: Array.from(data.examples),
          services: Array.from(data.services),
          levels: Array.from(data.levels),
          signature
        });
      }
    }

    // Sort by count and limit
    patterns.sort((a, b) => b.count - a.count);
    
    return patterns.slice(0, options.maxPatterns || 100);
  }

  /**
   * Compare patterns between time periods
   */
  public async comparePatterns(
    baselineTimeRange: { from: string; to: string },
    comparisonTimeRange: { from: string; to: string },
    options: Omit<PatternExtractionOptions, 'timeRange'> = {}
  ): Promise<{
    baselinePatterns: LogPattern[];
    comparisonPatterns: LogPattern[];
    changes: PatternChange[];
    summary: string;
  }> {
    logger.info('[LogPatternExtractor] Comparing patterns between periods');

    // Extract patterns for both periods
    const [baselinePatterns, comparisonPatterns] = await Promise.all([
      this.extractPatterns({ ...options, timeRange: baselineTimeRange }),
      this.extractPatterns({ ...options, timeRange: comparisonTimeRange })
    ]);

    // Build maps for comparison
    const baselineMap = new Map(
      baselinePatterns.map(p => [p.signature, p])
    );
    const comparisonMap = new Map(
      comparisonPatterns.map(p => [p.signature, p])
    );

    const changes: PatternChange[] = [];

    // Find new patterns
    for (const [sig, pattern] of comparisonMap) {
      if (!baselineMap.has(sig)) {
        changes.push({
          pattern: pattern.pattern,
          changeType: 'new',
          oldCount: 0,
          newCount: pattern.count,
          percentageChange: 100
        });
      }
    }

    // Find missing and changed patterns
    for (const [sig, basePattern] of baselineMap) {
      const compPattern = comparisonMap.get(sig);
      
      if (!compPattern) {
        changes.push({
          pattern: basePattern.pattern,
          changeType: 'missing',
          oldCount: basePattern.count,
          newCount: 0,
          percentageChange: -100
        });
      } else {
        const percentageChange = 
          ((compPattern.count - basePattern.count) / basePattern.count) * 100;
        
        if (Math.abs(percentageChange) > 20) { // Significant change
          changes.push({
            pattern: basePattern.pattern,
            changeType: 'frequency',
            oldCount: basePattern.count,
            newCount: compPattern.count,
            percentageChange
          });
        }
      }
    }

    // Sort changes by impact
    changes.sort((a, b) => 
      Math.abs(b.percentageChange) - Math.abs(a.percentageChange)
    );

    const summary = this.generateComparisonSummary(
      baselinePatterns,
      comparisonPatterns,
      changes
    );

    return {
      baselinePatterns,
      comparisonPatterns,
      changes,
      summary
    };
  }

  /**
   * Find rare patterns (potential issues)
   */
  public async findRarePatterns(
    options: PatternExtractionOptions = {}
  ): Promise<LogPattern[]> {
    logger.info('[LogPatternExtractor] Finding rare patterns');

    // Extract all patterns with very low minimum support
    const patterns = await this.extractPatterns({
      ...options,
      minSupport: 0.0001, // 0.01%
      maxPatterns: 1000
    });

    // Filter for rare patterns
    const rarePatterns = patterns.filter(p => 
      p.percentage < 0.001 && // Less than 0.1%
      p.count > 1 // But seen more than once
    );

    // Prioritize error patterns
    rarePatterns.sort((a, b) => {
      const aErrorScore = a.levels.includes('error') ? 1 : 0;
      const bErrorScore = b.levels.includes('error') ? 1 : 0;
      
      if (aErrorScore !== bErrorScore) {
        return bErrorScore - aErrorScore;
      }
      
      return b.count - a.count;
    });

    return rarePatterns.slice(0, 50);
  }

  /**
   * Group similar patterns
   */
  public async groupSimilarPatterns(
    options: PatternExtractionOptions = {}
  ): Promise<Array<{
    group: string;
    patterns: LogPattern[];
    totalCount: number;
    totalPercentage: number;
  }>> {
    logger.info('[LogPatternExtractor] Grouping similar patterns');

    const patterns = await this.extractPatterns(options);
    const groups = new Map<string, LogPattern[]>();

    for (const pattern of patterns) {
      const groupKey = this.getPatternGroup(pattern.pattern);
      
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      
      groups.get(groupKey)!.push(pattern);
    }

    // Convert to array with statistics
    const groupedPatterns = Array.from(groups.entries()).map(([group, patterns]) => {
      const totalCount = patterns.reduce((sum, p) => sum + p.count, 0);
      const totalPercentage = patterns.reduce((sum, p) => sum + p.percentage, 0);
      
      return {
        group,
        patterns: patterns.sort((a, b) => b.count - a.count),
        totalCount,
        totalPercentage
      };
    });

    return groupedPatterns.sort((a, b) => b.totalCount - a.totalCount);
  }

  // Private helper methods

  private async fetchLogs(options: PatternExtractionOptions): Promise<LogEntry[]> {
    const query: any = {
      size: 10000, // Get more logs for pattern analysis
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

  private normalizeMessage(message: string, options: PatternExtractionOptions): string {
    let normalized = message;

    // Replace numbers with placeholders
    if (!options.includeNumbers) {
      normalized = normalized.replace(/\b\d+\b/g, '<NUM>');
      normalized = normalized.replace(/\b\d+\.\d+\b/g, '<FLOAT>');
    }

    // Replace timestamps
    if (!options.includeTimestamps) {
      // ISO timestamps
      normalized = normalized.replace(
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?/g,
        '<TIMESTAMP>'
      );
      // Common timestamp formats
      normalized = normalized.replace(
        /\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}/g,
        '<TIMESTAMP>'
      );
    }

    // Replace common variable patterns
    normalized = normalized.replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, '<UUID>');
    normalized = normalized.replace(/\b[a-f0-9]{32}\b/gi, '<HASH>');
    normalized = normalized.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '<EMAIL>');
    normalized = normalized.replace(/\bhttps?:\/\/[^\s]+/g, '<URL>');
    normalized = normalized.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '<IP>');
    normalized = normalized.replace(/\/[^\/\s]+\/[^\/\s]+\/[^\/\s]+/g, '<PATH>');

    return normalized.trim();
  }

  private generateSignature(normalizedMessage: string): string {
    // Create a simple hash/signature for the pattern
    let hash = 0;
    for (let i = 0; i < normalizedMessage.length; i++) {
      const char = normalizedMessage.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  private getPatternGroup(pattern: string): string {
    // Extract the main operation or component from the pattern
    const tokens = pattern.split(/\s+/);
    
    // Look for common grouping indicators
    for (const token of tokens) {
      if (token.includes('Error') || token.includes('Exception')) {
        return 'Errors';
      }
      if (token.includes('Start') || token.includes('Begin')) {
        return 'Lifecycle - Start';
      }
      if (token.includes('Stop') || token.includes('End') || token.includes('Complete')) {
        return 'Lifecycle - End';
      }
      if (token.includes('Request') || token.includes('Response')) {
        return 'HTTP';
      }
      if (token.includes('Query') || token.includes('Database') || token.includes('SQL')) {
        return 'Database';
      }
      if (token.includes('Cache')) {
        return 'Cache';
      }
      if (token.includes('Auth') || token.includes('Login') || token.includes('Permission')) {
        return 'Authentication';
      }
    }
    
    // Default group based on first significant word
    const significantWord = tokens.find(t => 
      t.length > 3 && !['<NUM>', '<FLOAT>', '<UUID>', '<TIMESTAMP>'].includes(t)
    );
    
    return significantWord || 'Other';
  }

  private generateComparisonSummary(
    baselinePatterns: LogPattern[],
    comparisonPatterns: LogPattern[],
    changes: PatternChange[]
  ): string {
    const parts = [];
    
    parts.push(`Baseline: ${baselinePatterns.length} patterns, Comparison: ${comparisonPatterns.length} patterns.`);
    
    const newPatterns = changes.filter(c => c.changeType === 'new').length;
    const missingPatterns = changes.filter(c => c.changeType === 'missing').length;
    const changedPatterns = changes.filter(c => c.changeType === 'frequency').length;
    
    if (newPatterns > 0) {
      parts.push(`${newPatterns} new patterns emerged.`);
    }
    if (missingPatterns > 0) {
      parts.push(`${missingPatterns} patterns disappeared.`);
    }
    if (changedPatterns > 0) {
      parts.push(`${changedPatterns} patterns changed significantly.`);
    }
    
    if (changes.length === 0) {
      parts.push('No significant pattern changes detected.');
    }
    
    return parts.join(' ');
  }
}