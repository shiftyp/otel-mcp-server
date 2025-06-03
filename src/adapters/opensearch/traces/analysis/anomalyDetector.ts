import { logger } from '../../../../utils/logger.js';
import { TracesAdapterCore } from '../core/adapter.js';
import { TraceAnalyzer, Trace, Span } from './traceAnalyzer.js';

/**
 * Trace anomaly detection options
 */
export interface TraceAnomalyDetectionOptions {
  timeRange?: { from: string; to: string };
  service?: string | string[];
  operation?: string;
  method?: 'latency' | 'error' | 'pattern' | 'all';
  threshold?: number;
  limit?: number;
  includeContext?: boolean;
}

/**
 * Trace anomaly result
 */
export interface TraceAnomaly {
  trace: Trace;
  anomalyScore: number;
  type: string;
  reason: string;
  affectedSpans?: Span[];
  context?: {
    similarTraces: Trace[];
    baselineMetrics: {
      avgDuration: number;
      errorRate: number;
      spanCount: number;
    };
  };
}

/**
 * Clean trace anomaly detection
 */
export class TraceAnomalyDetector {
  constructor(
    private readonly adapter: TracesAdapterCore,
    private readonly analyzer: TraceAnalyzer
  ) {}

  /**
   * Detect anomalies in traces
   */
  public async detectAnomalies(
    options: TraceAnomalyDetectionOptions = {}
  ): Promise<{
    anomalies: TraceAnomaly[];
    stats: {
      total: number;
      anomalyRate: number;
      byType: Record<string, number>;
      byService: Record<string, number>;
      byOperation: Record<string, number>;
    };
    summary: string;
  }> {
    const method = options.method || 'all';
    const limit = options.limit || 100;
    
    logger.info('[TraceAnomalyDetector] Detecting anomalies', { options });

    try {
      // Fetch traces for analysis
      const traces = await this.fetchTraces(options);
      
      if (traces.length === 0) {
        return {
          anomalies: [],
          stats: {
            total: 0,
            anomalyRate: 0,
            byType: {},
            byService: {},
            byOperation: {}
          },
          summary: 'No traces found in the specified time range'
        };
      }

      // Collect anomalies from different methods
      const allAnomalies: TraceAnomaly[] = [];

      // Latency-based anomalies
      if (method === 'latency' || method === 'all') {
        const latencyAnomalies = await this.detectLatencyAnomalies(traces, options);
        allAnomalies.push(...latencyAnomalies);
      }

      // Error-based anomalies
      if (method === 'error' || method === 'all') {
        const errorAnomalies = await this.detectErrorAnomalies(traces, options);
        allAnomalies.push(...errorAnomalies);
      }

      // Pattern-based anomalies
      if (method === 'pattern' || method === 'all') {
        const patternAnomalies = await this.detectPatternAnomalies(traces, options);
        allAnomalies.push(...patternAnomalies);
      }

      // Deduplicate and sort by score
      const uniqueAnomalies = this.deduplicateAnomalies(allAnomalies);
      const sortedAnomalies = uniqueAnomalies
        .sort((a, b) => b.anomalyScore - a.anomalyScore)
        .slice(0, limit);

      // Add context if requested
      if (options.includeContext) {
        for (const anomaly of sortedAnomalies) {
          anomaly.context = await this.getAnomalyContext(anomaly.trace);
        }
      }

      // Calculate statistics
      const stats = this.calculateAnomalyStats(sortedAnomalies, traces.length);
      const summary = this.generateAnomalySummary(stats, sortedAnomalies);

      return {
        anomalies: sortedAnomalies,
        stats,
        summary
      };
    } catch (error) {
      logger.error('[TraceAnomalyDetector] Error detecting anomalies', { error });
      throw error;
    }
  }

  /**
   * Detect real-time trace anomalies
   */
  public async detectRealTimeAnomalies(
    windowSize: string = '5m',
    options: TraceAnomalyDetectionOptions = {}
  ): Promise<{
    anomalies: TraceAnomaly[];
    baseline: {
      avgDuration: number;
      errorRate: number;
      traceCount: number;
      spanCount: number;
    };
    drift: {
      durationDrift: number;
      errorRateDrift: number;
      volumeDrift: number;
      spanCountDrift: number;
    };
  }> {
    logger.info('[TraceAnomalyDetector] Detecting real-time anomalies', {
      windowSize,
      options
    });

    const windowMs = this.parseInterval(windowSize);
    const now = new Date();
    const currentWindowEnd = now.toISOString();
    const currentWindowStart = new Date(now.getTime() - windowMs).toISOString();
    const baselineWindowStart = new Date(now.getTime() - 2 * windowMs).toISOString();

    // Fetch traces for current and baseline windows
    const [currentTraces, baselineTraces] = await Promise.all([
      this.fetchTraces({
        ...options,
        timeRange: { from: currentWindowStart, to: currentWindowEnd }
      }),
      this.fetchTraces({
        ...options,
        timeRange: { from: baselineWindowStart, to: currentWindowStart }
      })
    ]);

    // Calculate baseline metrics
    const baselineStats = this.analyzer.calculateStats(baselineTraces);
    
    // Detect anomalies in current window
    const currentAnomalies = await this.detectAnomalies({
      ...options,
      timeRange: { from: currentWindowStart, to: currentWindowEnd }
    });

    // Calculate drift metrics
    const currentStats = this.analyzer.calculateStats(currentTraces);

    const baseline = {
      avgDuration: baselineStats.avgDuration,
      errorRate: baselineStats.errorRate,
      traceCount: baselineTraces.length,
      spanCount: baselineStats.avgSpanCount
    };

    const drift = {
      durationDrift: Math.abs(currentStats.avgDuration - baselineStats.avgDuration) / Math.max(baselineStats.avgDuration, 1),
      errorRateDrift: Math.abs(currentStats.errorRate - baselineStats.errorRate),
      volumeDrift: Math.abs(currentTraces.length - baselineTraces.length) / Math.max(baselineTraces.length, 1),
      spanCountDrift: Math.abs(currentStats.avgSpanCount - baselineStats.avgSpanCount) / Math.max(baselineStats.avgSpanCount, 1)
    };

    return {
      anomalies: currentAnomalies.anomalies,
      baseline,
      drift
    };
  }

  /**
   * Detect span-level anomalies within traces
   */
  public async detectSpanAnomalies(
    traceId: string
  ): Promise<{
    anomalousSpans: Array<{
      span: Span;
      anomalyScore: number;
      reason: string;
    }>;
    traceHealth: {
      score: number;
      issues: string[];
    };
  }> {
    logger.info('[TraceAnomalyDetector] Detecting span anomalies', { traceId });

    const trace = await this.fetchTraceById(traceId);
    if (!trace) {
      throw new Error(`Trace ${traceId} not found`);
    }

    const anomalousSpans: Array<{
      span: Span;
      anomalyScore: number;
      reason: string;
    }> = [];

    // Analyze span durations
    const spans = trace.spans || [];
    const durations = spans.map(s => s.duration);
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const stdDev = Math.sqrt(
      durations.reduce((sum, d) => sum + Math.pow(d - avgDuration, 2), 0) / durations.length
    );

    for (const span of spans) {
      const issues: string[] = [];
      let anomalyScore = 0;

      // Check for duration anomalies
      if (stdDev > 0) {
        const zscore = Math.abs((span.duration - avgDuration) / stdDev);
        if (zscore > 3) {
          issues.push(`Duration ${span.duration}ms is ${zscore.toFixed(1)}σ from average`);
          anomalyScore = Math.max(anomalyScore, Math.min(zscore / 4, 1));
        }
      }

      // Check for errors
      if (span.error) {
        issues.push('Span has error status');
        anomalyScore = Math.max(anomalyScore, 0.8);
      }

      // Check for missing parent spans
      if (span.parentSpanId && !spans.find(s => s.spanId === span.parentSpanId)) {
        issues.push('Parent span not found in trace');
        anomalyScore = Math.max(anomalyScore, 0.7);
      }

      if (issues.length > 0) {
        anomalousSpans.push({
          span,
          anomalyScore,
          reason: issues.join('; ')
        });
      }
    }

    // Calculate trace health score
    const errorCount = spans.filter(s => s.error).length;
    const healthScore = 1 - (anomalousSpans.length / spans.length);
    const healthIssues: string[] = [];

    if (errorCount > 0) {
      healthIssues.push(`${errorCount} spans with errors`);
    }
    if (anomalousSpans.length > spans.length * 0.3) {
      healthIssues.push('High percentage of anomalous spans');
    }
    if (trace.duration > 10000) {
      healthIssues.push('Trace duration exceeds 10s');
    }

    return {
      anomalousSpans: anomalousSpans.sort((a, b) => b.anomalyScore - a.anomalyScore),
      traceHealth: {
        score: healthScore,
        issues: healthIssues
      }
    };
  }

  // Private helper methods

  private async fetchTraces(options: TraceAnomalyDetectionOptions): Promise<Trace[]> {
    const query: any = {
      size: 1000,
      query: { bool: { must: [], filter: [] } },
      sort: [{ startTime: { order: 'desc' } }]
    };

    if (options.timeRange) {
      query.query.bool.filter.push({
        range: {
          startTime: {
            gte: options.timeRange.from,
            lte: options.timeRange.to
          }
        }
      });
    }

    if (options.service) {
      const services = Array.isArray(options.service) ? options.service : [options.service];
      query.query.bool.filter.push({
        terms: { 'resource.service.name': services }
      });
    }

    if (options.operation) {
      query.query.bool.filter.push({
        term: { name: options.operation }
      });
    }

    const response = await this.adapter.searchTraces(query);
    return this.analyzer.processTraceResponse(response);
  }

  private async fetchTraceById(traceId: string): Promise<Trace | null> {
    const query = {
      size: 1000,
      query: {
        term: { traceId }
      }
    };

    const response = await this.adapter.searchTraces(query);
    const traces = this.analyzer.processTraceResponse(response);
    return traces.length > 0 ? traces[0] : null;
  }

  private async detectLatencyAnomalies(
    traces: Trace[],
    options: TraceAnomalyDetectionOptions
  ): Promise<TraceAnomaly[]> {
    const anomalies: TraceAnomaly[] = [];
    const threshold = options.threshold || 0.95;

    // Group traces by service and operation
    const groups = new Map<string, Trace[]>();
    for (const trace of traces) {
      const key = `${trace.service}:${trace.rootSpan?.name || 'unknown'}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(trace);
    }

    // Detect anomalies within each group
    for (const [groupKey, groupTraces] of groups) {
      if (groupTraces.length < 5) continue; // Need enough samples

      const durations = groupTraces.map(t => t.duration);
      const percentile = this.calculatePercentile(durations, threshold * 100);

      for (const trace of groupTraces) {
        if (trace.duration > percentile) {
          anomalies.push({
            trace,
            anomalyScore: Math.min((trace.duration / percentile - 1) * 0.5, 1),
            type: 'latency',
            reason: `Duration ${trace.duration}ms exceeds ${(threshold * 100).toFixed(0)}th percentile (${percentile.toFixed(0)}ms)`,
            affectedSpans: trace.spans?.filter(s => s.duration > percentile * 0.1)
          });
        }
      }
    }

    return anomalies;
  }

  private async detectErrorAnomalies(
    traces: Trace[],
    options: TraceAnomalyDetectionOptions
  ): Promise<TraceAnomaly[]> {
    const anomalies: TraceAnomaly[] = [];

    for (const trace of traces) {
      const errorSpans = trace.spans?.filter(s => s.error) || [];
      if (errorSpans.length > 0) {
        const errorRate = errorSpans.length / (trace.spans?.length || 1);
        anomalies.push({
          trace,
          anomalyScore: Math.min(errorRate * 2, 1),
          type: 'error',
          reason: `${errorSpans.length} error spans detected (${(errorRate * 100).toFixed(0)}% error rate)`,
          affectedSpans: errorSpans
        });
      }
    }

    return anomalies;
  }

  private async detectPatternAnomalies(
    traces: Trace[],
    options: TraceAnomalyDetectionOptions
  ): Promise<TraceAnomaly[]> {
    const anomalies: TraceAnomaly[] = [];

    // Detect traces with unusual span patterns
    const spanCountGroups = new Map<number, number>();
    for (const trace of traces) {
      const spanCount = trace.spans?.length || 0;
      spanCountGroups.set(spanCount, (spanCountGroups.get(spanCount) || 0) + 1);
    }

    const totalTraces = traces.length;
    for (const trace of traces) {
      const spanCount = trace.spans?.length || 0;
      const frequency = (spanCountGroups.get(spanCount) || 0) / totalTraces;

      if (frequency < 0.05) { // Less than 5% occurrence
        anomalies.push({
          trace,
          anomalyScore: 1 - frequency,
          type: 'pattern',
          reason: `Unusual span count (${spanCount}) - only ${(frequency * 100).toFixed(1)}% of traces have this pattern`
        });
      }
    }

    return anomalies;
  }

  private deduplicateAnomalies(anomalies: TraceAnomaly[]): TraceAnomaly[] {
    const seen = new Set<string>();
    const unique: TraceAnomaly[] = [];
    
    for (const anomaly of anomalies) {
      const key = anomaly.trace.traceId;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(anomaly);
      }
    }
    
    return unique;
  }

  private async getAnomalyContext(trace: Trace): Promise<any> {
    const timeWindow = 300000; // 5 minutes
    const traceTime = new Date(trace.startTime).getTime();

    const query = {
      size: 10,
      query: {
        bool: {
          filter: [
            {
              range: {
                startTime: {
                  gte: new Date(traceTime - timeWindow).toISOString(),
                  lte: new Date(traceTime + timeWindow).toISOString()
                }
              }
            },
            {
              term: { 'resource.service.name': trace.service }
            },
            {
              term: { name: trace.rootSpan?.name }
            }
          ],
          must_not: [
            { term: { traceId: trace.traceId } }
          ]
        }
      }
    };

    const response = await this.adapter.searchTraces(query);
    const similarTraces = this.analyzer.processTraceResponse(response);

    // Calculate baseline metrics
    const durations = similarTraces.map(t => t.duration);
    const errorRates = similarTraces.map(t => {
      const errorSpans = t.spans?.filter(s => s.error).length || 0;
      return errorSpans / (t.spans?.length || 1);
    });

    return {
      similarTraces: similarTraces.slice(0, 5),
      baselineMetrics: {
        avgDuration: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
        errorRate: errorRates.length > 0 ? errorRates.reduce((a, b) => a + b, 0) / errorRates.length : 0,
        spanCount: similarTraces.length > 0 ? 
          similarTraces.reduce((sum, t) => sum + (t.spans?.length || 0), 0) / similarTraces.length : 0
      }
    };
  }

  private calculateAnomalyStats(
    anomalies: TraceAnomaly[],
    totalTraces: number
  ): any {
    const byType: Record<string, number> = {};
    const byService: Record<string, number> = {};
    const byOperation: Record<string, number> = {};

    for (const anomaly of anomalies) {
      byType[anomaly.type] = (byType[anomaly.type] || 0) + 1;
      byService[anomaly.trace.service] = (byService[anomaly.trace.service] || 0) + 1;
      if (anomaly.trace.rootSpan?.name) {
        byOperation[anomaly.trace.rootSpan.name] = (byOperation[anomaly.trace.rootSpan.name] || 0) + 1;
      }
    }

    return {
      total: anomalies.length,
      anomalyRate: totalTraces > 0 ? anomalies.length / totalTraces : 0,
      byType,
      byService,
      byOperation
    };
  }

  private generateAnomalySummary(stats: any, anomalies: TraceAnomaly[]): string {
    const parts = [];
    
    parts.push(`Found ${stats.total} anomalous traces (${(stats.anomalyRate * 100).toFixed(1)}% anomaly rate).`);
    
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

  private calculatePercentile(values: number[], percentile: number): number {
    const sorted = values.slice().sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
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