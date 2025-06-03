import { logger } from '../../../../utils/logger.js';

/**
 * Log entry structure
 */
export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  service?: string;
  traceId?: string;
  spanId?: string;
  attributes?: Record<string, any>;
}

/**
 * Log pattern result
 */
export interface LogPattern {
  pattern: string;
  count: number;
  frequency: number;
  examples: string[];
  template?: string;
}

/**
 * Log statistics
 */
export interface LogStats {
  total: number;
  levels: Record<string, number>;
  services: Record<string, number>;
  errorRate: number;
  avgMessageLength: number;
  uniquePatterns: number;
}

/**
 * Core log analysis functionality
 */
export class LogAnalyzer {
  /**
   * Extract patterns from logs using template extraction
   */
  public extractPatterns(logs: LogEntry[], options: {
    minSupport?: number;
    maxPatterns?: number;
  } = {}): LogPattern[] {
    const minSupport = options.minSupport || 2;
    const maxPatterns = options.maxPatterns || 100;
    
    const patternMap = new Map<string, {
      count: number;
      examples: string[];
      template: string;
    }>();

    // Process each log message
    for (const log of logs) {
      const template = this.extractTemplate(log.message);
      
      if (!patternMap.has(template)) {
        patternMap.set(template, {
          count: 0,
          examples: [],
          template
        });
      }
      
      const pattern = patternMap.get(template)!;
      pattern.count++;
      if (pattern.examples.length < 5) {
        pattern.examples.push(log.message);
      }
    }

    // Convert to array and filter by support
    const patterns = Array.from(patternMap.entries())
      .filter(([_, pattern]) => pattern.count >= minSupport)
      .map(([template, data]) => ({
        pattern: template,
        count: data.count,
        frequency: data.count / logs.length,
        examples: data.examples,
        template: data.template
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, maxPatterns);

    return patterns;
  }

  /**
   * Calculate log statistics
   */
  public calculateStats(logs: LogEntry[]): LogStats {
    const levels: Record<string, number> = {};
    const services: Record<string, number> = {};
    let totalLength = 0;
    let errorCount = 0;

    for (const log of logs) {
      // Count levels
      const level = log.level.toLowerCase();
      levels[level] = (levels[level] || 0) + 1;
      
      if (level === 'error' || level === 'fatal') {
        errorCount++;
      }

      // Count services
      if (log.service) {
        services[log.service] = (services[log.service] || 0) + 1;
      }

      // Message length
      totalLength += log.message.length;
    }

    const patterns = this.extractPatterns(logs, { minSupport: 1 });

    return {
      total: logs.length,
      levels,
      services,
      errorRate: logs.length > 0 ? errorCount / logs.length : 0,
      avgMessageLength: logs.length > 0 ? totalLength / logs.length : 0,
      uniquePatterns: patterns.length
    };
  }

  /**
   * Group logs by time windows
   */
  public groupByTimeWindow(
    logs: LogEntry[],
    windowSize: string = '5m'
  ): Map<string, LogEntry[]> {
    const groups = new Map<string, LogEntry[]>();
    const windowMs = this.parseInterval(windowSize);

    for (const log of logs) {
      const timestamp = new Date(log.timestamp).getTime();
      const windowStart = Math.floor(timestamp / windowMs) * windowMs;
      const windowKey = new Date(windowStart).toISOString();

      if (!groups.has(windowKey)) {
        groups.set(windowKey, []);
      }
      groups.get(windowKey)!.push(log);
    }

    return groups;
  }

  /**
   * Find correlated log patterns
   */
  public findCorrelatedPatterns(
    logs: LogEntry[],
    options: {
      windowSize?: string;
      minCorrelation?: number;
    } = {}
  ): Array<{
    pattern1: string;
    pattern2: string;
    correlation: number;
    coOccurrences: number;
  }> {
    const windowSize = options.windowSize || '1m';
    const minCorrelation = options.minCorrelation || 0.7;
    
    // Group logs by time window
    const timeGroups = this.groupByTimeWindow(logs, windowSize);
    
    // Extract patterns per window
    const windowPatterns = new Map<string, Set<string>>();
    
    for (const [window, windowLogs] of timeGroups) {
      const patterns = this.extractPatterns(windowLogs, { minSupport: 1 });
      windowPatterns.set(
        window, 
        new Set(patterns.map(p => p.pattern))
      );
    }

    // Calculate pattern co-occurrences
    const coOccurrences = new Map<string, number>();
    const patternCounts = new Map<string, number>();
    
    for (const patterns of windowPatterns.values()) {
      const patternArray = Array.from(patterns);
      
      // Count individual patterns
      for (const pattern of patternArray) {
        patternCounts.set(pattern, (patternCounts.get(pattern) || 0) + 1);
      }
      
      // Count co-occurrences
      for (let i = 0; i < patternArray.length; i++) {
        for (let j = i + 1; j < patternArray.length; j++) {
          const key = [patternArray[i], patternArray[j]].sort().join('|||');
          coOccurrences.set(key, (coOccurrences.get(key) || 0) + 1);
        }
      }
    }

    // Calculate correlations
    const correlations: Array<{
      pattern1: string;
      pattern2: string;
      correlation: number;
      coOccurrences: number;
    }> = [];

    for (const [pairKey, coCount] of coOccurrences) {
      const [pattern1, pattern2] = pairKey.split('|||');
      const count1 = patternCounts.get(pattern1) || 0;
      const count2 = patternCounts.get(pattern2) || 0;
      
      if (count1 > 0 && count2 > 0) {
        // Jaccard similarity
        const correlation = coCount / (count1 + count2 - coCount);
        
        if (correlation >= minCorrelation) {
          correlations.push({
            pattern1,
            pattern2,
            correlation,
            coOccurrences: coCount
          });
        }
      }
    }

    return correlations.sort((a, b) => b.correlation - a.correlation);
  }

  /**
   * Detect log anomalies based on frequency
   */
  public detectAnomalies(
    logs: LogEntry[],
    options: {
      method?: 'frequency' | 'pattern' | 'both';
      threshold?: number;
    } = {}
  ): Array<{
    log: LogEntry;
    anomalyScore: number;
    reason: string;
  }> {
    const method = options.method || 'both';
    const threshold = options.threshold || 0.95;
    const anomalies: Array<{
      log: LogEntry;
      anomalyScore: number;
      reason: string;
    }> = [];

    if (method === 'frequency' || method === 'both') {
      // Frequency-based anomaly detection
      const patterns = this.extractPatterns(logs, { minSupport: 1 });
      const patternFreq = new Map(patterns.map(p => [p.pattern, p.frequency]));
      
      for (const log of logs) {
        const template = this.extractTemplate(log.message);
        const frequency = patternFreq.get(template) || 0;
        
        if (frequency < (1 - threshold)) {
          anomalies.push({
            log,
            anomalyScore: 1 - frequency,
            reason: 'Rare pattern'
          });
        }
      }
    }

    if (method === 'pattern' || method === 'both') {
      // Pattern-based anomaly detection
      const stats = this.calculateStats(logs);
      const avgLength = stats.avgMessageLength;
      const stdDev = this.calculateMessageLengthStdDev(logs, avgLength);
      
      for (const log of logs) {
        const lengthDiff = Math.abs(log.message.length - avgLength);
        if (lengthDiff > 2 * stdDev) {
          anomalies.push({
            log,
            anomalyScore: Math.min(lengthDiff / (3 * stdDev), 1),
            reason: 'Unusual message length'
          });
        }
      }
    }

    // Remove duplicates and sort by score
    const uniqueAnomalies = new Map<string, typeof anomalies[0]>();
    for (const anomaly of anomalies) {
      const key = `${anomaly.log.timestamp}-${anomaly.log.message}`;
      const existing = uniqueAnomalies.get(key);
      if (!existing || existing.anomalyScore < anomaly.anomalyScore) {
        uniqueAnomalies.set(key, anomaly);
      }
    }

    return Array.from(uniqueAnomalies.values())
      .sort((a, b) => b.anomalyScore - a.anomalyScore);
  }

  // Private helper methods

  private extractTemplate(message: string): string {
    return message
      // Replace UUIDs
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{UUID}')
      // Replace hex IDs
      .replace(/\b[0-9a-f]{24}\b/gi, '{HEX_ID}')
      // Replace numbers
      .replace(/\b\d+(\.\d+)?\b/g, '{NUMBER}')
      // Replace IPs
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '{IP}')
      // Replace emails
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '{EMAIL}')
      // Replace URLs
      .replace(/https?:\/\/[^\s]+/g, '{URL}')
      // Replace file paths
      .replace(/\/[^\s]+/g, '{PATH}')
      // Replace quoted strings
      .replace(/"[^"]+"/g, '{STRING}')
      .replace(/'[^']+'/g, '{STRING}');
  }

  private parseInterval(interval: string): number {
    const match = interval.match(/^(\d+)([smhd])$/);
    if (!match) return 5 * 60 * 1000; // Default 5 minutes
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 5 * 60 * 1000;
    }
  }

  private calculateMessageLengthStdDev(logs: LogEntry[], mean: number): number {
    if (logs.length === 0) return 0;
    
    const variance = logs.reduce((sum, log) => {
      return sum + Math.pow(log.message.length - mean, 2);
    }, 0) / logs.length;
    
    return Math.sqrt(variance);
  }
}