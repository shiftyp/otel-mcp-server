import { logger } from '../../../../utils/logger.js';
import { TraceCore } from './traceCore.js';

/**
 * Functionality for analyzing traces and spans
 */
export class TraceAnalysis extends TraceCore {
  /**
   * Analyze a trace by traceId
   */
  public async analyzeTrace(traceId: string): Promise<any> {
    // First get the root span
    const rootSpan = await this.getRootSpan(traceId);
    if (!rootSpan) {
      throw new Error(`Trace ${traceId} not found`);
    }
    
    // Get all spans for the trace
    const spans = await this.getAllSpansForTrace(traceId);
    
    // Extract service name from the root span
    const serviceName = this.extractServiceName(rootSpan);
    
    // Calculate duration in milliseconds
    const durationMs = rootSpan.duration / 1000000; // Convert nanoseconds to milliseconds
    
    // Count errors
    const errorCount = spans.filter(span => 
      span.status?.code === 2 || // OTEL mapping
      span.Status?.Code === 2 || // ECS mapping
      span.attributes?.error === true ||
      span.Attributes?.error === true
    ).length;
    
    // Extract operation name
    const operationName = rootSpan.name || rootSpan.Name || 'unknown';
    
    // Build the trace analysis
    const analysis = {
      trace_id: traceId,
      root_span: rootSpan,
      service: serviceName,
      operation: operationName,
      timestamp: new Date(rootSpan['@timestamp'] || rootSpan.timestamp || rootSpan.start_time).toISOString(),
      duration_ms: durationMs,
      span_count: spans.length,
      error_count: errorCount,
      has_errors: errorCount > 0,
      error_rate: spans.length > 0 ? (errorCount / spans.length) : 0,
      spans: spans
    };
    
    return analysis;
  }
  
  /**
   * Get the root span for a trace
   */
  public async getRootSpan(traceId: string): Promise<any> {
    // Query for the root span (parent span ID is empty or equals to trace ID)
    const query = {
      query: {
        bool: {
          must: [
            { term: { trace_id: traceId } }
          ],
          should: [
            { bool: { must_not: { exists: { field: 'parent_span_id' } } } },
            { bool: { must_not: { exists: { field: 'ParentSpanId' } } } },
            { term: { parent_span_id: traceId } },
            { term: { ParentSpanId: traceId } }
          ],
          minimum_should_match: 1
        }
      },
      size: 1
    };
    
    const response = await this.request('POST', `/${this.traceIndexPattern}/_search`, query);
    
    if (response.hits?.hits?.length > 0) {
      return response.hits.hits[0]._source;
    }
    
    return null;
  }
  
  /**
   * Get all spans for a trace
   */
  public async getAllSpansForTrace(traceId: string): Promise<any[]> {
    const query = {
      query: {
        bool: {
          must: [
            { term: { trace_id: traceId } }
          ]
        }
      },
      size: 1000, // Assuming traces won't have more than 1000 spans
      sort: [
        { '@timestamp': { order: 'asc' } }
      ]
    };
    
    const response = await this.request('POST', `/${this.traceIndexPattern}/_search`, query);
    
    if (response.hits?.hits?.length > 0) {
      return response.hits.hits.map((hit: any) => hit._source);
    }
    
    return [];
  }
  
  /**
   * Lookup a span by spanId
   */
  public async spanLookup(spanId: string): Promise<any | null> {
    // Query for the span with the given spanId
    const query = {
      query: {
        bool: {
          should: [
            { term: { span_id: spanId } },
            { term: { SpanId: spanId } }
          ],
          minimum_should_match: 1
        }
      },
      size: 1
    };
    
    const response = await this.request('POST', `/${this.traceIndexPattern}/_search`, query);
    
    if (response.hits?.hits?.length > 0) {
      return response.hits.hits[0]._source;
    }
    
    return null;
  }
}
