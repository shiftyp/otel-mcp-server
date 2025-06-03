import { TracesAdapterCore } from '../core/adapter.js';

/**
 * Trace structure
 */
export interface Trace {
  traceId: string;
  startTime: string;
  endTime: string;
  duration: number;
  service: string;
  rootSpan?: Span;
  spans?: Span[];
  attributes?: Record<string, any>;
}

/**
 * Span structure
 */
export interface Span {
  spanId: string;
  parentSpanId?: string;
  traceId: string;
  name: string;
  service: string;
  startTime: string;
  endTime: string;
  duration: number;
  error?: boolean;
  attributes?: Record<string, any>;
  events?: SpanEvent[];
}

/**
 * Span event structure
 */
export interface SpanEvent {
  name: string;
  timestamp: string;
  attributes?: Record<string, any>;
}

/**
 * Trace pattern
 */
export interface TracePattern {
  pattern: string;
  count: number;
  services: string[];
  avgDuration: number;
  errorRate: number;
  examples: Trace[];
}

/**
 * Service dependency
 */
export interface ServiceDependency {
  source: string;
  target: string;
  callCount: number;
  avgDuration: number;
  errorRate: number;
}

/**
 * Clean trace analysis functionality
 */
export class TraceAnalyzer {
  constructor(private readonly adapter: TracesAdapterCore) {}  // adapter will be used in future implementations

  /**
   * Process raw trace response into structured traces
   */
  public processTraceResponse(response: any): Trace[] {
    const spansByTrace = new Map<string, Span[]>();
    
    // Group spans by trace ID
    for (const hit of response.hits?.hits || []) {
      const source = hit._source;
      const traceId = source.traceId || source.trace_id;
      
      if (!traceId) continue;
      
      const span: Span = {
        spanId: source.spanId || source.span_id,
        parentSpanId: source.parentSpanId || source.parent_span_id,
        traceId,
        name: source.name || source.operationName,
        service: source.resource?.service?.name || source.service?.name || 'unknown',
        startTime: source.startTime || source.start_time,
        endTime: source.endTime || source.end_time,
        duration: source.duration || this.calculateDuration(source.startTime, source.endTime),
        error: source.status?.code === 2 || source.error === true,
        attributes: this.extractAttributes(source),
        events: this.extractEvents(source)
      };
      
      if (!spansByTrace.has(traceId)) {
        spansByTrace.set(traceId, []);
      }
      spansByTrace.get(traceId)!.push(span);
    }
    
    // Build traces from spans
    const traces: Trace[] = [];
    for (const [traceId, spans] of spansByTrace) {
      const rootSpan = this.findRootSpan(spans);
      if (!rootSpan) continue;
      
      const trace: Trace = {
        traceId,
        startTime: rootSpan.startTime,
        endTime: rootSpan.endTime,
        duration: rootSpan.duration,
        service: rootSpan.service,
        rootSpan,
        spans: spans.sort((a, b) => 
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
        )
      };
      
      traces.push(trace);
    }
    
    return traces;
  }

  /**
   * Calculate trace statistics
   */
  public calculateStats(traces: Trace[]): {
    totalTraces: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
    errorRate: number;
    avgSpanCount: number;
    serviceBreakdown: Record<string, number>;
  } {
    if (traces.length === 0) {
      return {
        totalTraces: 0,
        avgDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        errorRate: 0,
        avgSpanCount: 0,
        serviceBreakdown: {}
      };
    }

    const durations = traces.map(t => t.duration);
    const errorCount = traces.filter(t => 
      t.spans?.some(s => s.error) || false
    ).length;
    const spanCounts = traces.map(t => t.spans?.length || 0);
    
    const serviceBreakdown: Record<string, number> = {};
    for (const trace of traces) {
      serviceBreakdown[trace.service] = (serviceBreakdown[trace.service] || 0) + 1;
    }

    return {
      totalTraces: traces.length,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      errorRate: errorCount / traces.length,
      avgSpanCount: spanCounts.reduce((a, b) => a + b, 0) / spanCounts.length,
      serviceBreakdown
    };
  }

  /**
   * Extract trace patterns
   */
  public extractPatterns(traces: Trace[]): TracePattern[] {
    const patternMap = new Map<string, TracePattern>();
    
    for (const trace of traces) {
      // Create pattern signature from span names and services
      const signature = this.createTraceSignature(trace);
      
      if (!patternMap.has(signature)) {
        patternMap.set(signature, {
          pattern: signature,
          count: 0,
          services: [],
          avgDuration: 0,
          errorRate: 0,
          examples: []
        });
      }
      
      const pattern = patternMap.get(signature)!;
      pattern.count++;
      pattern.avgDuration = 
        (pattern.avgDuration * (pattern.count - 1) + trace.duration) / pattern.count;
      
      const hasError = trace.spans?.some(s => s.error) || false;
      pattern.errorRate = 
        (pattern.errorRate * (pattern.count - 1) + (hasError ? 1 : 0)) / pattern.count;
      
      // Add unique services
      const traceServices = new Set(trace.spans?.map(s => s.service) || []);
      for (const service of traceServices) {
        if (!pattern.services.includes(service)) {
          pattern.services.push(service);
        }
      }
      
      // Keep up to 3 examples
      if (pattern.examples.length < 3) {
        pattern.examples.push(trace);
      }
    }
    
    return Array.from(patternMap.values())
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Group traces by time window
   */
  public groupByTimeWindow(
    traces: Trace[],
    windowSize: string
  ): Map<string, Trace[]> {
    const windowMs = this.parseInterval(windowSize);
    const groups = new Map<string, Trace[]>();
    
    for (const trace of traces) {
      const timestamp = new Date(trace.startTime).getTime();
      const windowStart = Math.floor(timestamp / windowMs) * windowMs;
      const windowKey = new Date(windowStart).toISOString();
      
      if (!groups.has(windowKey)) {
        groups.set(windowKey, []);
      }
      groups.get(windowKey)!.push(trace);
    }
    
    return groups;
  }

  /**
   * Analyze service dependencies from traces
   */
  public analyzeServiceDependencies(traces: Trace[]): ServiceDependency[] {
    const dependencies = new Map<string, ServiceDependency>();
    
    for (const trace of traces) {
      if (!trace.spans) continue;
      
      // Build parent-child relationships
      const spanMap = new Map<string, Span>();
      for (const span of trace.spans) {
        spanMap.set(span.spanId, span);
      }
      
      for (const span of trace.spans) {
        if (span.parentSpanId) {
          const parentSpan = spanMap.get(span.parentSpanId);
          if (parentSpan && parentSpan.service !== span.service) {
            const key = `${parentSpan.service}->${span.service}`;
            
            if (!dependencies.has(key)) {
              dependencies.set(key, {
                source: parentSpan.service,
                target: span.service,
                callCount: 0,
                avgDuration: 0,
                errorRate: 0
              });
            }
            
            const dep = dependencies.get(key)!;
            dep.callCount++;
            dep.avgDuration = 
              (dep.avgDuration * (dep.callCount - 1) + span.duration) / dep.callCount;
            dep.errorRate = 
              (dep.errorRate * (dep.callCount - 1) + (span.error ? 1 : 0)) / dep.callCount;
          }
        }
      }
    }
    
    return Array.from(dependencies.values())
      .sort((a, b) => b.callCount - a.callCount);
  }

  /**
   * Find critical path in a trace
   */
  public findCriticalPath(trace: Trace): Span[] {
    if (!trace.spans || trace.spans.length === 0) {
      return [];
    }

    // Build span tree
    const spanMap = new Map<string, Span>();
    const childrenMap = new Map<string, Span[]>();
    
    for (const span of trace.spans) {
      spanMap.set(span.spanId, span);
      
      if (span.parentSpanId) {
        if (!childrenMap.has(span.parentSpanId)) {
          childrenMap.set(span.parentSpanId, []);
        }
        childrenMap.get(span.parentSpanId)!.push(span);
      }
    }

    // Find critical path recursively
    const findPath = (spanId: string): { duration: number; path: Span[] } => {
      const span = spanMap.get(spanId);
      if (!span) return { duration: 0, path: [] };

      const children = childrenMap.get(spanId) || [];
      if (children.length === 0) {
        return { duration: span.duration, path: [span] };
      }

      let maxChild = { duration: 0, path: [] as Span[] };
      for (const child of children) {
        const childPath = findPath(child.spanId);
        if (childPath.duration > maxChild.duration) {
          maxChild = childPath;
        }
      }

      return {
        duration: span.duration + maxChild.duration,
        path: [span, ...maxChild.path]
      };
    };

    const rootSpan = this.findRootSpan(trace.spans);
    if (!rootSpan) return [];

    return findPath(rootSpan.spanId).path;
  }

  // Private helper methods

  private findRootSpan(spans: Span[]): Span | null {
    // Root span has no parent
    return spans.find(s => !s.parentSpanId) || null;
  }

  private calculateDuration(startTime: string, endTime: string): number {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    return end - start;
  }

  private extractAttributes(source: any): Record<string, any> {
    const attributes: Record<string, any> = {};
    
    // Common attribute fields
    const attrFields = ['attributes', 'tags', 'fields'];
    for (const field of attrFields) {
      if (source[field] && typeof source[field] === 'object') {
        Object.assign(attributes, source[field]);
      }
    }
    
    // Add standard fields
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

  private createTraceSignature(trace: Trace): string {
    if (!trace.spans || trace.spans.length === 0) {
      return 'empty';
    }
    
    // Create signature from span operation names in order
    const operations = trace.spans
      .map(s => `${s.service}:${s.name}`)
      .sort()
      .join(',');
    
    return operations;
  }

  private parseInterval(interval: string): number {
    const match = interval.match(/^(\d+)([smhd])$/);
    if (!match) return 60000; // Default 1 minute
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 60000;
    }
  }
}