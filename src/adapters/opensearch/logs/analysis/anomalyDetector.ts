import { logger } from '../../../../utils/logger.js';
import { ILogsAdapter } from '../core/interface.js';
import { LogAnalyzer, LogEntry } from './logAnalyzer.js';

/**
 * Anomaly detection options
 */
export interface AnomalyDetectionOptions {
  timeRange?: { from: string; to: string };
  service?: string | string[];
  level?: string | string[];
  method?: 'frequency' | 'pattern' | 'ml' | 'all';
  threshold?: number;
  limit?: number;
  includeContext?: boolean;
}

/**
 * Anomaly result
 */
export interface LogAnomaly {
  log: LogEntry;
  anomalyScore: number;
  type: string;
  reason: string;
  context?: {
    before: LogEntry[];
    after: LogEntry[];
  };
}

/**
 * Clean log anomaly detection
 */
export class LogAnomalyDetector {
  constructor(
    private readonly adapter: ILogsAdapter,
    private readonly analyzer: LogAnalyzer
  ) {}

  /**
   * Detect anomalies in logs
   */
  public async detectAnomalies(
    options: AnomalyDetectionOptions = {}
  ): Promise<{
    anomalies: LogAnomaly[];
    stats: {
      total: number;
      anomalyRate: number;
      byType: Record<string, number>;
      byService: Record<string, number>;
    };
    summary: string;
  }> {
    const method = options.method || 'all';
    const limit = options.limit || 100;
    
    logger.info('[LogAnomalyDetector] Detecting anomalies', { options });

    try {
      // Fetch logs for analysis
      const logs = await this.fetchLogs(options);
      
      if (logs.length === 0) {
        return {
          anomalies: [],
          stats: {
            total: 0,
            anomalyRate: 0,
            byType: {},
            byService: {}
          },
          summary: 'No logs found in the specified time range'
        };
      }

      // Collect anomalies from different methods
      const allAnomalies: LogAnomaly[] = [];

      // Frequency-based anomalies
      if (method === 'frequency' || method === 'all') {
        const freqAnomalies = await this.detectFrequencyAnomalies(logs, options);
        allAnomalies.push(...freqAnomalies);
      }

      // Pattern-based anomalies
      if (method === 'pattern' || method === 'all') {
        const patternAnomalies = this.analyzer.detectAnomalies(logs, {
          method: 'pattern',
          threshold: options.threshold
        });
        
        allAnomalies.push(...patternAnomalies.map(a => ({
          ...a,
          type: 'pattern',
          anomalyScore: a.anomalyScore
        })));
      }

      // ML-based anomalies
      if (method === 'ml' || method === 'all') {
        const mlAnomalies = await this.detectMLAnomalies(logs, options);
        allAnomalies.push(...mlAnomalies);
      }

      // Deduplicate and sort by score
      const uniqueAnomalies = this.deduplicateAnomalies(allAnomalies);
      const sortedAnomalies = uniqueAnomalies
        .sort((a, b) => b.anomalyScore - a.anomalyScore)
        .slice(0, limit);

      // Add context if requested
      if (options.includeContext) {
        for (const anomaly of sortedAnomalies) {
          anomaly.context = await this.getAnomalyContext(anomaly.log);
        }
      }

      // Calculate statistics
      const stats = this.calculateAnomalyStats(sortedAnomalies, logs.length);
      const summary = this.generateAnomalySummary(stats, sortedAnomalies);

      return {
        anomalies: sortedAnomalies,
        stats,
        summary
      };
    } catch (error) {
      logger.error('[LogAnomalyDetector] Error detecting anomalies', { error });
      throw error;
    }
  }

  /**
   * Detect real-time anomalies
   */
  public async detectRealTimeAnomalies(
    windowSize: string = '5m',
    options: AnomalyDetectionOptions = {}
  ): Promise<{
    anomalies: LogAnomaly[];
    baseline: {
      patterns: number;
      errorRate: number;
      avgVolume: number;
    };
    drift: {
      patternDrift: number;
      errorRateDrift: number;
      volumeDrift: number;
    };
  }> {
    logger.info('[LogAnomalyDetector] Detecting real-time anomalies', {
      windowSize,
      options
    });

    const windowMs = this.parseInterval(windowSize);
    const now = new Date();
    const currentWindowEnd = now.toISOString();
    const currentWindowStart = new Date(now.getTime() - windowMs).toISOString();
    const baselineWindowStart = new Date(now.getTime() - 2 * windowMs).toISOString();

    // Fetch logs for current and baseline windows
    const [currentLogs, baselineLogs] = await Promise.all([
      this.fetchLogs({
        ...options,
        timeRange: { from: currentWindowStart, to: currentWindowEnd }
      }),
      this.fetchLogs({
        ...options,
        timeRange: { from: baselineWindowStart, to: currentWindowStart }
      })
    ]);

    // Calculate baseline metrics
    const baselineStats = this.analyzer.calculateStats(baselineLogs);
    const baselinePatterns = this.analyzer.extractPatterns(baselineLogs);
    
    // Detect anomalies in current window
    const currentAnomalies = await this.detectAnomalies({
      ...options,
      timeRange: { from: currentWindowStart, to: currentWindowEnd }
    });

    // Calculate drift metrics
    const currentStats = this.analyzer.calculateStats(currentLogs);
    const currentPatterns = this.analyzer.extractPatterns(currentLogs);

    const baseline = {
      patterns: baselinePatterns.length,
      errorRate: baselineStats.errorRate,
      avgVolume: baselineLogs.length
    };

    const drift = {
      patternDrift: Math.abs(currentPatterns.length - baselinePatterns.length) / Math.max(baselinePatterns.length, 1),
      errorRateDrift: Math.abs(currentStats.errorRate - baselineStats.errorRate),
      volumeDrift: Math.abs(currentLogs.length - baselineLogs.length) / Math.max(baselineLogs.length, 1)
    };

    return {
      anomalies: currentAnomalies.anomalies,
      baseline,
      drift
    };
  }

  // Private helper methods

  private async fetchLogs(options: AnomalyDetectionOptions): Promise<LogEntry[]> {
    const query: any = {
      size: 10000, // Get more logs for better anomaly detection
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

  private async detectFrequencyAnomalies(
    logs: LogEntry[],
    options: AnomalyDetectionOptions
  ): Promise<LogAnomaly[]> {
    const threshold = options.threshold || 0.95;
    const anomalies: LogAnomaly[] = [];

    // Group logs by time window to detect volume anomalies
    const timeGroups = this.analyzer.groupByTimeWindow(logs, '1m');
    const groupSizes = Array.from(timeGroups.values()).map(g => g.length);
    
    if (groupSizes.length > 0) {
      const mean = groupSizes.reduce((a, b) => a + b, 0) / groupSizes.length;
      const stdDev = Math.sqrt(
        groupSizes.reduce((sum, size) => sum + Math.pow(size - mean, 2), 0) / groupSizes.length
      );

      for (const [window, windowLogs] of timeGroups) {
        const zscore = Math.abs((windowLogs.length - mean) / stdDev);
        if (zscore > 3) { // 3 standard deviations
          // Add the most representative log from this window
          const representativeLog = windowLogs[Math.floor(windowLogs.length / 2)];
          anomalies.push({
            log: representativeLog,
            anomalyScore: Math.min(zscore / 4, 1),
            type: 'frequency',
            reason: `Unusual log volume in time window: ${windowLogs.length} logs (${zscore.toFixed(1)}σ from mean)`
          });
        }
      }
    }

    return anomalies;
  }

  private async detectMLAnomalies(
    logs: LogEntry[],
    options: AnomalyDetectionOptions
  ): Promise<LogAnomaly[]> {
    // For now, use a simple approach
    // In a real implementation, this would use OpenSearch ML capabilities
    const anomalies: LogAnomaly[] = [];
    
    // Detect logs with unusual attributes
    const attributeCounts = new Map<string, number>();
    
    for (const log of logs) {
      const attrKeys = Object.keys(log.attributes || {}).sort().join(',');
      attributeCounts.set(attrKeys, (attributeCounts.get(attrKeys) || 0) + 1);
    }
    
    const totalLogs = logs.length;
    
    for (const log of logs) {
      const attrKeys = Object.keys(log.attributes || {}).sort().join(',');
      const frequency = (attributeCounts.get(attrKeys) || 0) / totalLogs;
      
      if (frequency < 0.01) { // Less than 1% occurrence
        anomalies.push({
          log,
          anomalyScore: 1 - frequency,
          type: 'ml',
          reason: 'Unusual attribute combination'
        });
      }
    }
    
    return anomalies;
  }

  private deduplicateAnomalies(anomalies: LogAnomaly[]): LogAnomaly[] {
    const seen = new Set<string>();
    const unique: LogAnomaly[] = [];
    
    for (const anomaly of anomalies) {
      const key = `${anomaly.log.timestamp}-${anomaly.log.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(anomaly);
      }
    }
    
    return unique;
  }

  private async getAnomalyContext(
    log: LogEntry
  ): Promise<{ before: LogEntry[]; after: LogEntry[] }> {
    const contextSize = 3;
    const timeWindow = 60000; // 1 minute
    const logTime = new Date(log.timestamp).getTime();

    const query = {
      size: contextSize * 2 + 1,
      query: {
        bool: {
          filter: [
            {
              range: {
                '@timestamp': {
                  gte: new Date(logTime - timeWindow).toISOString(),
                  lte: new Date(logTime + timeWindow).toISOString()
                }
              }
            }
          ]
        }
      },
      sort: [{ '@timestamp': { order: 'asc' } }]
    };

    if (log.service) {
      query.query.bool.filter.push({
        term: { 'service.name': log.service }
      } as any);
    }

    const response = await this.adapter.searchLogs(query);
    const contextLogs: LogEntry[] = (response.hits?.hits || []).map((hit: any) => ({
      timestamp: hit._source['@timestamp'] || hit._source.timestamp,
      level: hit._source.level || hit._source.SeverityText || 'info',
      message: hit._source.message || hit._source.Body || '',
      service: hit._source.service?.name || hit._source.resource?.service?.name,
      traceId: hit._source.traceId || hit._source.trace_id,
      spanId: hit._source.spanId || hit._source.span_id,
      attributes: hit._source.attributes || {}
    }));

    // Find the index of the current log
    const currentIndex = contextLogs.findIndex(
      (l) => l.timestamp === log.timestamp && l.message === log.message
    );

    if (currentIndex === -1) {
      return { before: [], after: [] };
    }

    return {
      before: contextLogs.slice(Math.max(0, currentIndex - contextSize), currentIndex),
      after: contextLogs.slice(currentIndex + 1, currentIndex + 1 + contextSize)
    };
  }

  private calculateAnomalyStats(
    anomalies: LogAnomaly[],
    totalLogs: number
  ): {
    total: number;
    anomalyRate: number;
    byType: Record<string, number>;
    byService: Record<string, number>;
  } {
    const byType: Record<string, number> = {};
    const byService: Record<string, number> = {};

    for (const anomaly of anomalies) {
      byType[anomaly.type] = (byType[anomaly.type] || 0) + 1;
      if (anomaly.log.service) {
        byService[anomaly.log.service] = (byService[anomaly.log.service] || 0) + 1;
      }
    }

    return {
      total: anomalies.length,
      anomalyRate: totalLogs > 0 ? anomalies.length / totalLogs : 0,
      byType,
      byService
    };
  }

  private generateAnomalySummary(
    stats: any,
    anomalies: LogAnomaly[]
  ): string {
    const parts = [];
    
    parts.push(`Found ${stats.total} anomalies (${(stats.anomalyRate * 100).toFixed(1)}% anomaly rate).`);
    
    const topType = Object.entries(stats.byType)
      .sort(([, a], [, b]) => (b as number) - (a as number))[0];
    if (topType) {
      parts.push(`Most common anomaly type: ${topType[0]} (${topType[1]} occurrences).`);
    }
    
    if (anomalies.length > 0 && anomalies[0].anomalyScore > 0.9) {
      parts.push(`Highest anomaly score: ${anomalies[0].anomalyScore.toFixed(2)} - ${anomalies[0].reason}.`);
    }
    
    return parts.join(' ');
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
}