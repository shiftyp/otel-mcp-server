import { logger } from '../../../../utils/logger.js';
import { TracesAdapterCore } from '../core/adapter.js';
import { Span, SpanEvent } from './traceAnalyzer.js';

/**
 * Span analysis options
 */
export interface SpanAnalysisOptions {
  timeRange?: { from: string; to: string };
  service?: string | string[];
  operation?: string;
  minDuration?: number;
  includeErrors?: boolean;
  limit?: number;
}

/**
 * Span statistics
 */
export interface SpanStats {
  totalSpans: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  p50Duration: number;
  p95Duration: number;
  p99Duration: number;
  errorRate: number;
  operationBreakdown: Record<string, {
    count: number;
    avgDuration: number;
    errorRate: number;
  }>;
}

/**
 * Span bottleneck
 */
export interface SpanBottleneck {
  span: Span;
  impact: number;
  reason: string;
  recommendations: string[];
}

/**
 * Operation performance
 */
export interface OperationPerformance {
  operation: string;
  service: string;
  stats: {
    count: number;
    avgDuration: number;
    p50Duration: number;
    p95Duration: number;
    p99Duration: number;
    errorRate: number;
  };
  trend: {
    durationChange: number;
    errorRateChange: number;
    volumeChange: number;
  };
}

/**
 * Clean span analysis functionality
 */
export class SpanAnalyzer {
  constructor(private readonly adapter: TracesAdapterCore) {}

  /**
   * Analyze span performance
   */
  public async analyzeSpanPerformance(
    options: SpanAnalysisOptions = {}
  ): Promise<{
    stats: SpanStats;
    bottlenecks: SpanBottleneck[];
    operationPerformance: OperationPerformance[];
    summary: string;
  }> {
    logger.info('[SpanAnalyzer] Analyzing span performance', { options });

    try {
      const spans = await this.fetchSpans(options);
      
      if (spans.length === 0) {
        return {
          stats: this.getEmptyStats(),
          bottlenecks: [],
          operationPerformance: [],
          summary: 'No spans found in the specified time range'
        };
      }

      // Calculate statistics
      const stats = this.calculateSpanStats(spans);
      
      // Identify bottlenecks
      const bottlenecks = this.identifyBottlenecks(spans, stats);
      
      // Analyze operation performance
      const operationPerformance = await this.analyzeOperationPerformance(spans, options);
      
      // Generate summary
      const summary = this.generatePerformanceSummary(stats, bottlenecks, operationPerformance);

      return {
        stats,
        bottlenecks: bottlenecks.slice(0, options.limit || 10),
        operationPerformance: operationPerformance.slice(0, options.limit || 20),
        summary
      };
    } catch (error) {
      logger.error('[SpanAnalyzer] Error analyzing span performance', { error });
      throw error;
    }
  }

  /**
   * Analyze span attributes and patterns
   */
  public async analyzeSpanAttributes(
    options: SpanAnalysisOptions = {}
  ): Promise<{
    commonAttributes: Record<string, {
      count: number;
      values: Array<{ value: any; count: number }>;
    }>;
    correlations: Array<{
      attribute1: string;
      attribute2: string;
      correlation: number;
    }>;
    patterns: Array<{
      pattern: string;
      count: number;
      avgDuration: number;
      examples: Span[];
    }>;
  }> {
    logger.info('[SpanAnalyzer] Analyzing span attributes', { options });

    const spans = await this.fetchSpans(options);
    
    // Analyze common attributes
    const commonAttributes = this.analyzeCommonAttributes(spans);
    
    // Find attribute correlations
    const correlations = this.findAttributeCorrelations(spans);
    
    // Extract patterns
    const patterns = this.extractAttributePatterns(spans);

    return {
      commonAttributes,
      correlations,
      patterns
    };
  }

  /**
   * Analyze span events
   */
  public async analyzeSpanEvents(
    options: SpanAnalysisOptions = {}
  ): Promise<{
    eventTypes: Record<string, {
      count: number;
      avgLatency: number;
      services: string[];
    }>;
    eventSequences: Array<{
      sequence: string[];
      count: number;
      avgDuration: number;
    }>;
    anomalousEvents: Array<{
      event: SpanEvent;
      span: Span;
      reason: string;
    }>;
  }> {
    logger.info('[SpanAnalyzer] Analyzing span events', { options });

    const spans = await this.fetchSpans(options);
    
    // Analyze event types
    const eventTypes: Record<string, any> = {};
    const sequences = new Map<string, any>();
    const anomalousEvents: Array<any> = [];

    for (const span of spans) {
      if (!span.events || span.events.length === 0) continue;

      // Track event types
      for (const event of span.events) {
        if (!eventTypes[event.name]) {
          eventTypes[event.name] = {
            count: 0,
            avgLatency: 0,
            services: new Set<string>()
          };
        }
        
        const eventType = eventTypes[event.name];
        eventType.count++;
        eventType.services.add(span.service);
        
        // Calculate latency from span start
        const eventTime = new Date(event.timestamp).getTime();
        const spanStart = new Date(span.startTime).getTime();
        const latency = eventTime - spanStart;
        
        eventType.avgLatency = 
          (eventType.avgLatency * (eventType.count - 1) + latency) / eventType.count;
      }

      // Track event sequences
      if (span.events.length > 1) {
        const sequence = span.events.map(e => e.name);
        const seqKey = sequence.join(' -> ');
        
        if (!sequences.has(seqKey)) {
          sequences.set(seqKey, {
            sequence,
            count: 0,
            avgDuration: 0
          });
        }
        
        const seq = sequences.get(seqKey)!;
        seq.count++;
        seq.avgDuration = 
          (seq.avgDuration * (seq.count - 1) + span.duration) / seq.count;
      }

      // Detect anomalous events
      for (const event of span.events) {
        if (event.name.toLowerCase().includes('error') ||
            event.name.toLowerCase().includes('exception') ||
            event.name.toLowerCase().includes('failure')) {
          anomalousEvents.push({
            event,
            span,
            reason: 'Error-related event detected'
          });
        }
      }
    }

    // Convert services sets to arrays
    for (const eventType of Object.values(eventTypes)) {
      eventType.services = Array.from(eventType.services);
    }

    return {
      eventTypes,
      eventSequences: Array.from(sequences.values())
        .sort((a, b) => b.count - a.count),
      anomalousEvents: anomalousEvents.slice(0, options.limit || 50)
    };
  }

  /**
   * Compare span performance between time periods
   */
  public async compareSpanPerformance(
    baselineTimeRange: { from: string; to: string },
    comparisonTimeRange: { from: string; to: string },
    options: Omit<SpanAnalysisOptions, 'timeRange'> = {}
  ): Promise<{
    baseline: SpanStats;
    comparison: SpanStats;
    changes: {
      durationChange: number;
      errorRateChange: number;
      volumeChange: number;
      p95Change: number;
      p99Change: number;
    };
    degradedOperations: OperationPerformance[];
    improvedOperations: OperationPerformance[];
  }> {
    logger.info('[SpanAnalyzer] Comparing span performance between periods');

    // Fetch spans for both periods
    const [baselineSpans, comparisonSpans] = await Promise.all([
      this.fetchSpans({ ...options, timeRange: baselineTimeRange }),
      this.fetchSpans({ ...options, timeRange: comparisonTimeRange })
    ]);

    // Calculate stats for both periods
    const baselineStats = this.calculateSpanStats(baselineSpans);
    const comparisonStats = this.calculateSpanStats(comparisonSpans);

    // Calculate changes
    const changes = {
      durationChange: (comparisonStats.avgDuration - baselineStats.avgDuration) / 
        Math.max(baselineStats.avgDuration, 1),
      errorRateChange: comparisonStats.errorRate - baselineStats.errorRate,
      volumeChange: (comparisonStats.totalSpans - baselineStats.totalSpans) / 
        Math.max(baselineStats.totalSpans, 1),
      p95Change: (comparisonStats.p95Duration - baselineStats.p95Duration) / 
        Math.max(baselineStats.p95Duration, 1),
      p99Change: (comparisonStats.p99Duration - baselineStats.p99Duration) / 
        Math.max(baselineStats.p99Duration, 1)
    };

    // Identify degraded and improved operations
    const baselineOps = await this.analyzeOperationPerformance(baselineSpans, options);
    const comparisonOps = await this.analyzeOperationPerformance(comparisonSpans, options);

    const degradedOperations: OperationPerformance[] = [];
    const improvedOperations: OperationPerformance[] = [];

    for (const compOp of comparisonOps) {
      const baseOp = baselineOps.find(
        op => op.operation === compOp.operation && op.service === compOp.service
      );
      
      if (baseOp) {
        const durationChange = (compOp.stats.avgDuration - baseOp.stats.avgDuration) / 
          Math.max(baseOp.stats.avgDuration, 1);
        
        if (durationChange > 0.1) { // 10% degradation
          compOp.trend = {
            durationChange,
            errorRateChange: compOp.stats.errorRate - baseOp.stats.errorRate,
            volumeChange: (compOp.stats.count - baseOp.stats.count) / 
              Math.max(baseOp.stats.count, 1)
          };
          degradedOperations.push(compOp);
        } else if (durationChange < -0.1) { // 10% improvement
          compOp.trend = {
            durationChange,
            errorRateChange: compOp.stats.errorRate - baseOp.stats.errorRate,
            volumeChange: (compOp.stats.count - baseOp.stats.count) / 
              Math.max(baseOp.stats.count, 1)
          };
          improvedOperations.push(compOp);
        }
      }
    }

    return {
      baseline: baselineStats,
      comparison: comparisonStats,
      changes,
      degradedOperations: degradedOperations
        .sort((a, b) => b.trend.durationChange - a.trend.durationChange)
        .slice(0, 10),
      improvedOperations: improvedOperations
        .sort((a, b) => a.trend.durationChange - b.trend.durationChange)
        .slice(0, 10)
    };
  }

  // Private helper methods

  private async fetchSpans(options: SpanAnalysisOptions): Promise<Span[]> {
    const query: any = {
      size: 10000,
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

    if (options.minDuration) {
      query.query.bool.filter.push({
        range: { duration: { gte: options.minDuration } }
      });
    }

    if (options.includeErrors) {
      query.query.bool.filter.push({
        term: { 'status.code': 2 }
      });
    }

    const response = await this.adapter.searchTraces(query);
    const spans: Span[] = [];

    for (const hit of response.hits?.hits || []) {
      const source = hit._source;
      spans.push({
        spanId: source.spanId || source.span_id,
        parentSpanId: source.parentSpanId || source.parent_span_id,
        traceId: source.traceId || source.trace_id,
        name: source.name || source.operationName,
        service: source.resource?.service?.name || source.service?.name || 'unknown',
        startTime: source.startTime || source.start_time,
        endTime: source.endTime || source.end_time,
        duration: source.duration || this.calculateDuration(source.startTime, source.endTime),
        error: source.status?.code === 2 || source.error === true,
        attributes: this.extractAttributes(source),
        events: this.extractEvents(source)
      });
    }

    return spans;
  }

  private calculateSpanStats(spans: Span[]): SpanStats {
    if (spans.length === 0) {
      return this.getEmptyStats();
    }

    const durations = spans.map(s => s.duration).sort((a, b) => a - b);
    const errorCount = spans.filter(s => s.error).length;

    // Calculate operation breakdown
    const operationBreakdown: Record<string, any> = {};
    for (const span of spans) {
      const key = `${span.service}:${span.name}`;
      if (!operationBreakdown[key]) {
        operationBreakdown[key] = {
          count: 0,
          totalDuration: 0,
          errorCount: 0
        };
      }
      
      const op = operationBreakdown[key];
      op.count++;
      op.totalDuration += span.duration;
      if (span.error) op.errorCount++;
    }

    // Convert to final format
    for (const [key, value] of Object.entries(operationBreakdown)) {
      operationBreakdown[key] = {
        count: value.count,
        avgDuration: value.totalDuration / value.count,
        errorRate: value.errorCount / value.count
      };
    }

    return {
      totalSpans: spans.length,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: durations[0],
      maxDuration: durations[durations.length - 1],
      p50Duration: this.calculatePercentile(durations, 50),
      p95Duration: this.calculatePercentile(durations, 95),
      p99Duration: this.calculatePercentile(durations, 99),
      errorRate: errorCount / spans.length,
      operationBreakdown
    };
  }

  private identifyBottlenecks(spans: Span[], stats: SpanStats): SpanBottleneck[] {
    const bottlenecks: SpanBottleneck[] = [];

    for (const span of spans) {
      const reasons: string[] = [];
      const recommendations: string[] = [];
      let impact = 0;

      // Check for slow spans
      if (span.duration > stats.p99Duration) {
        reasons.push(`Duration ${span.duration}ms exceeds P99 (${stats.p99Duration}ms)`);
        recommendations.push('Optimize operation performance');
        impact = Math.max(impact, 0.9);
      } else if (span.duration > stats.p95Duration) {
        reasons.push(`Duration ${span.duration}ms exceeds P95 (${stats.p95Duration}ms)`);
        recommendations.push('Consider caching or parallelization');
        impact = Math.max(impact, 0.7);
      }

      // Check for errors
      if (span.error) {
        reasons.push('Span has error status');
        recommendations.push('Investigate and fix error cause');
        impact = Math.max(impact, 0.8);
      }

      // Check for high attribute count (complexity)
      const attrCount = Object.keys(span.attributes || {}).length;
      if (attrCount > 50) {
        reasons.push(`High attribute count (${attrCount})`);
        recommendations.push('Review span instrumentation');
        impact = Math.max(impact, 0.5);
      }

      if (reasons.length > 0) {
        bottlenecks.push({
          span,
          impact,
          reason: reasons.join('; '),
          recommendations
        });
      }
    }

    return bottlenecks.sort((a, b) => b.impact - a.impact);
  }

  private async analyzeOperationPerformance(
    spans: Span[],
    options: SpanAnalysisOptions
  ): Promise<OperationPerformance[]> {
    const operationMap = new Map<string, {
      spans: Span[];
      durations: number[];
    }>();

    // Group spans by operation
    for (const span of spans) {
      const key = `${span.service}:${span.name}`;
      if (!operationMap.has(key)) {
        operationMap.set(key, { spans: [], durations: [] });
      }
      
      const op = operationMap.get(key)!;
      op.spans.push(span);
      op.durations.push(span.duration);
    }

    // Calculate performance for each operation
    const operations: OperationPerformance[] = [];

    for (const [key, data] of operationMap) {
      const [service, ...nameParts] = key.split(':');
      const operation = nameParts.join(':');
      
      data.durations.sort((a, b) => a - b);
      const errorCount = data.spans.filter(s => s.error).length;

      operations.push({
        operation,
        service,
        stats: {
          count: data.spans.length,
          avgDuration: data.durations.reduce((a, b) => a + b, 0) / data.durations.length,
          p50Duration: this.calculatePercentile(data.durations, 50),
          p95Duration: this.calculatePercentile(data.durations, 95),
          p99Duration: this.calculatePercentile(data.durations, 99),
          errorRate: errorCount / data.spans.length
        },
        trend: {
          durationChange: 0,
          errorRateChange: 0,
          volumeChange: 0
        }
      });
    }

    return operations.sort((a, b) => b.stats.count - a.stats.count);
  }

  private analyzeCommonAttributes(spans: Span[]): Record<string, any> {
    const attributeStats: Record<string, Map<any, number>> = {};

    for (const span of spans) {
      for (const [key, value] of Object.entries(span.attributes || {})) {
        if (!attributeStats[key]) {
          attributeStats[key] = new Map();
        }
        
        const valueStr = JSON.stringify(value);
        attributeStats[key].set(valueStr, (attributeStats[key].get(valueStr) || 0) + 1);
      }
    }

    const result: Record<string, any> = {};
    for (const [key, valueMap] of Object.entries(attributeStats)) {
      const values = Array.from(valueMap.entries())
        .map(([value, count]) => ({
          value: JSON.parse(value),
          count
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      result[key] = {
        count: spans.filter(s => key in (s.attributes || {})).length,
        values
      };
    }

    return result;
  }

  private findAttributeCorrelations(spans: Span[]): Array<any> {
    // Simplified correlation analysis
    const correlations: Array<any> = [];
    
    // This is a placeholder - in a real implementation,
    // you would calculate actual statistical correlations
    
    return correlations;
  }

  private extractAttributePatterns(spans: Span[]): Array<any> {
    const patternMap = new Map<string, any>();

    for (const span of spans) {
      // Create pattern from sorted attribute keys
      const attrKeys = Object.keys(span.attributes || {}).sort();
      const pattern = attrKeys.join(',');
      
      if (!patternMap.has(pattern)) {
        patternMap.set(pattern, {
          pattern,
          count: 0,
          totalDuration: 0,
          examples: []
        });
      }
      
      const p = patternMap.get(pattern)!;
      p.count++;
      p.totalDuration += span.duration;
      
      if (p.examples.length < 3) {
        p.examples.push(span);
      }
    }

    return Array.from(patternMap.values())
      .map(p => ({
        ...p,
        avgDuration: p.totalDuration / p.count
      }))
      .sort((a, b) => b.count - a.count);
  }

  private calculateDuration(startTime: string, endTime: string): number {
    return new Date(endTime).getTime() - new Date(startTime).getTime();
  }

  private calculatePercentile(sortedValues: number[], percentile: number): number {
    const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, index)];
  }

  private extractAttributes(source: any): Record<string, any> {
    const attributes: Record<string, any> = {};
    
    const attrFields = ['attributes', 'tags', 'fields'];
    for (const field of attrFields) {
      if (source[field] && typeof source[field] === 'object') {
        Object.assign(attributes, source[field]);
      }
    }
    
    if (source.http) attributes.http = source.http;
    if (source.db) attributes.db = source.db;
    if (source.rpc) attributes.rpc = source.rpc;
    
    return attributes;
  }

  private extractEvents(source: any): SpanEvent[] {
    const events: SpanEvent[] = [];
    
    if (Array.isArray(source.events)) {
      for (const event of source.events) {
        events.push({
          name: event.name || event.event_name || 'unknown',
          timestamp: event.timestamp || event.time,
          attributes: event.attributes || {}
        });
      }
    }
    
    return events;
  }

  private getEmptyStats(): SpanStats {
    return {
      totalSpans: 0,
      avgDuration: 0,
      minDuration: 0,
      maxDuration: 0,
      p50Duration: 0,
      p95Duration: 0,
      p99Duration: 0,
      errorRate: 0,
      operationBreakdown: {}
    };
  }

  private generatePerformanceSummary(
    stats: SpanStats,
    bottlenecks: SpanBottleneck[],
    operations: OperationPerformance[]
  ): string {
    const parts = [];
    
    parts.push(`Analyzed ${stats.totalSpans} spans with average duration ${stats.avgDuration.toFixed(0)}ms.`);
    
    if (stats.errorRate > 0) {
      parts.push(`Error rate: ${(stats.errorRate * 100).toFixed(1)}%.`);
    }
    
    if (bottlenecks.length > 0) {
      parts.push(`Found ${bottlenecks.length} performance bottlenecks.`);
    }
    
    if (operations.length > 0) {
      const slowestOp = operations
        .sort((a, b) => b.stats.avgDuration - a.stats.avgDuration)[0];
      parts.push(`Slowest operation: ${slowestOp.operation} (${slowestOp.stats.avgDuration.toFixed(0)}ms avg).`);
    }
    
    return parts.join(' ');
  }
}