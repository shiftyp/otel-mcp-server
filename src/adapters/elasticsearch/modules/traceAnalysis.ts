import { ElasticsearchCore, ElasticsearchAdapterOptions } from '../core/core.js';
import { logger } from '../../../utils/logger.js';
import { createErrorResponse, ErrorResponse, isErrorResponse } from '../../../utils/errorHandling.js';
import { createBoolQuery, createTermQuery } from '../../../utils/queryBuilder.js';

/**
 * Trace analysis functionality for the Elasticsearch Adapter
 */
export class TraceAnalysis {
  private coreAdapter: ElasticsearchCore;
  
  constructor(options: ElasticsearchAdapterOptions) {
    this.coreAdapter = new ElasticsearchCore(options);
  }
  
  /**
   * Analyze a trace by its trace ID
   * @param traceId Trace ID to analyze
   * @returns Analyzed trace data with spans and critical path
   */
  public async analyzeTrace(traceId: string): Promise<any | ErrorResponse> {
    try {
      logger.info('[TraceAnalysis] Analyzing trace', { traceId });
      
      if (!traceId) {
        return createErrorResponse('Trace ID is required');
      }
      
      // Build query
      const query = {
        query: createTermQuery('TraceId', traceId),
        size: 10000,
        sort: [
          { '@timestamp': { order: 'asc' } }
        ]
      };
      
      // Execute query
      const result = await this.coreAdapter.callEsRequest('POST', '/.ds-traces-*/_search', query);
      
      if (!result || result.error) {
        const errorMessage = result?.error?.reason || 'Unknown error';
        return createErrorResponse(`Error analyzing trace: ${errorMessage}`);
      }
      
      // Extract spans
      const hits = result.hits?.hits || [];
      const spans = hits.map((hit: any) => hit._source);
      
      if (spans.length === 0) {
        return createErrorResponse(`No spans found for trace ID: ${traceId}`);
      }
      
      // Build span map for faster lookups
      const spanMap = new Map();
      for (const span of spans) {
        spanMap.set(span.SpanId, span);
      }
      
      // Find root span (span with no parent or parent not in the trace)
      let rootSpan = spans.find((span: any) => {
        return !span.ParentSpanId || !spanMap.has(span.ParentSpanId);
      });
      
      if (!rootSpan) {
        // If no clear root, use the earliest span
        rootSpan = spans[0];
      }
      
      // Build span tree
      const spanTree = this.buildSpanTree(spans);
      
      // Find critical path
      const criticalPath = this.findCriticalPath(spans, spanMap, rootSpan);
      
      // Calculate trace metrics
      const traceMetrics = this.calculateTraceMetrics(spans, rootSpan);
      
      return {
        traceId,
        rootSpan,
        spans,
        spanTree,
        criticalPath,
        metrics: traceMetrics
      };
    } catch (error) {
      return createErrorResponse(`Error analyzing trace: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Lookup a span by its span ID
   * @param spanId Span ID to lookup
   * @returns Span data and its trace context
   */
  public async spanLookup(spanId: string): Promise<any | ErrorResponse> {
    try {
      logger.info('[TraceAnalysis] Looking up span', { spanId });
      
      if (!spanId) {
        return createErrorResponse('Span ID is required');
      }
      
      // Build query
      const query = {
        query: createTermQuery('SpanId', spanId),
        size: 1
      };
      
      // Execute query
      const result = await this.coreAdapter.callEsRequest('POST', '/.ds-traces-*/_search', query);
      
      if (!result || result.error) {
        const errorMessage = result?.error?.reason || 'Unknown error';
        return createErrorResponse(`Error looking up span: ${errorMessage}`);
      }
      
      // Extract span
      const hits = result.hits?.hits || [];
      
      if (hits.length === 0) {
        return createErrorResponse(`No span found with ID: ${spanId}`);
      }
      
      const span = hits[0]._source;
      const traceId = span.TraceId;
      
      // Get trace context
      const traceContext = await this.getTraceContext(traceId, spanId);
      
      return {
        span,
        traceContext
      };
    } catch (error) {
      return createErrorResponse(`Error looking up span: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get trace context for a specific span
   * @param traceId Trace ID
   * @param spanId Span ID
   * @returns Trace context with parent and child spans
   */
  private async getTraceContext(traceId: string, spanId: string): Promise<any | ErrorResponse> {
    try {
      // Build query
      const query = {
        query: createBoolQuery({
          must: [
            createTermQuery('TraceId', traceId)
          ]
        }),
        size: 1000,
        sort: [
          { '@timestamp': { order: 'asc' } }
        ]
      };
      
      // Execute query
      const result = await this.coreAdapter.callEsRequest('POST', '/.ds-traces-*/_search', query);
      
      if (!result || result.error) {
        const errorMessage = result?.error?.reason || 'Unknown error';
        return createErrorResponse(`Error getting trace context: ${errorMessage}`);
      }
      
      // Extract spans
      const hits = result.hits?.hits || [];
      const spans = hits.map((hit: any) => hit._source);
      
      // Build span map for faster lookups
      const spanMap = new Map();
      for (const span of spans) {
        spanMap.set(span.SpanId, span);
      }
      
      // Find target span
      const targetSpan = spanMap.get(spanId);
      
      if (!targetSpan) {
        return createErrorResponse(`Span not found in trace: ${spanId}`);
      }
      
      // Find parent span
      const parentSpan = targetSpan.ParentSpanId ? spanMap.get(targetSpan.ParentSpanId) : null;
      
      // Find child spans
      const childSpans = spans.filter((span: any) => span.ParentSpanId === spanId);
      
      return {
        targetSpan,
        parentSpan,
        childSpans,
        allSpans: spans
      };
    } catch (error) {
      return createErrorResponse(`Error getting trace context: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Build a span tree from a list of spans
   * @param spans List of spans
   * @returns Hierarchical span tree
   */
  private buildSpanTree(spans: any[]): any {
    // Build span map for faster lookups
    const spanMap = new Map();
    for (const span of spans) {
      spanMap.set(span.SpanId, {
        ...span,
        children: []
      });
    }
    
    // Build tree
    const roots = [];
    
    for (const span of spans) {
      const spanWithChildren = spanMap.get(span.SpanId);
      
      if (!span.ParentSpanId || !spanMap.has(span.ParentSpanId)) {
        // This is a root span
        roots.push(spanWithChildren);
      } else {
        // Add as child to parent
        const parent = spanMap.get(span.ParentSpanId);
        parent.children.push(spanWithChildren);
      }
    }
    
    return roots;
  }
  
  /**
   * Find the critical path in a trace
   * @param spans List of spans
   * @param spanMap Map of spans for faster lookups
   * @param rootSpan Root span of the trace
   * @returns Critical path as a list of spans
   */
  private findCriticalPath(spans: any[], spanMap: Map<string, any>, rootSpan: any): any[] {
    // Helper function to calculate span duration
    const getSpanDuration = (span: any) => {
      const startTime = new Date(span['@timestamp']).getTime();
      const endTime = new Date(span.EndTimestamp || span['@timestamp']).getTime();
      return endTime - startTime;
    };
    
    // Helper function to find the longest path from a span
    const findLongestPath = (spanId: string, visited = new Set<string>()): any[] => {
      if (visited.has(spanId)) {
        return [];
      }
      
      visited.add(spanId);
      const span = spanMap.get(spanId);
      
      if (!span) {
        return [];
      }
      
      // Find child spans
      const childSpans = spans.filter((s: any) => s.ParentSpanId === spanId);
      
      if (childSpans.length === 0) {
        return [span];
      }
      
      // Find the child with the longest path
      let longestPath: any[] = [];
      let maxDuration = 0;
      
      for (const childSpan of childSpans) {
        const childPath = findLongestPath(childSpan.SpanId, new Set(visited));
        const pathDuration = childPath.reduce((sum, s) => sum + getSpanDuration(s), 0);
        
        if (pathDuration > maxDuration) {
          maxDuration = pathDuration;
          longestPath = childPath;
        }
      }
      
      return [span, ...longestPath];
    };
    
    // Find the longest path from the root span
    return findLongestPath(rootSpan.SpanId);
  }
  
  /**
   * Calculate metrics for a trace
   * @param spans List of spans
   * @param rootSpan Root span of the trace
   * @returns Trace metrics
   */
  private calculateTraceMetrics(spans: any[], rootSpan: any): any {
    // Calculate total duration
    const rootStartTime = new Date(rootSpan['@timestamp']).getTime();
    const rootEndTime = new Date(rootSpan.EndTimestamp || rootSpan['@timestamp']).getTime();
    const totalDuration = rootEndTime - rootStartTime;
    
    // Count spans by type
    const spanTypes = new Map<string, number>();
    for (const span of spans) {
      const type = span.Kind || 'INTERNAL';
      spanTypes.set(type, (spanTypes.get(type) || 0) + 1);
    }
    
    // Count spans by service
    const services = new Map<string, number>();
    for (const span of spans) {
      const service = span.Resource?.service?.name || 'unknown';
      services.set(service, (services.get(service) || 0) + 1);
    }
    
    // Count errors
    const errorCount = spans.filter((span: any) => span.Status?.code === 2).length;
    
    return {
      totalSpans: spans.length,
      totalDuration,
      totalDurationMs: totalDuration,
      totalDurationFormatted: `${(totalDuration / 1000).toFixed(2)}s`,
      errorCount,
      errorRate: spans.length > 0 ? errorCount / spans.length : 0,
      spanTypes: Object.fromEntries(spanTypes),
      services: Object.fromEntries(services)
    };
  }
  
  /**
   * Query traces with a custom query
   * @param query Custom query
   * @returns Query results
   */
  public async queryTraces(query: any): Promise<any | ErrorResponse> {
    try {
      logger.info('[TraceAnalysis] Querying traces');
      
      // Execute query
      const result = await this.coreAdapter.callEsRequest('POST', '/.ds-traces-*/_search', query);
      
      if (!result || result.error) {
        const errorMessage = result?.error?.reason || 'Unknown error';
        return createErrorResponse(`Error querying traces: ${errorMessage}`);
      }
      
      return result;
    } catch (error) {
      return createErrorResponse(`Error querying traces: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
