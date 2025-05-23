import { ElasticsearchAdapter } from '../adapters/elasticsearch/index.js';
import { logger } from '../utils/logger.js';

/**
 * Tool for visualizing spans and their relationships as Mermaid flowcharts
 */
export class SpanVisualizerTool {
  private esAdapter: ElasticsearchAdapter;

  constructor(esAdapter: ElasticsearchAdapter) {
    this.esAdapter = esAdapter;
  }

  /**
   * Generate a Mermaid flowchart for a span and its connections
   * @param spanId The ID of the span to visualize
   * @param query Optional query to filter related spans
   * @returns Mermaid flowchart representation
   */
  async generateSpanFlowchart(spanId: string, query?: string): Promise<string> {
    try {
      logger.info('[SpanVisualizer] Generating flowchart for span', { spanId, query });
      
      // Get the target span
      const span = await this.esAdapter.spanLookup(spanId);
      if (!span) {
        logger.warn('[SpanVisualizer] No span found', { spanId });
        return `No span found with ID: ${spanId}`;
      }
      
      logger.info('[SpanVisualizer] Found span', { 
        spanId, 
        name: span.Name,
        service: span.Resource?.service?.name
      });
      
      // Get the trace ID for this span
      const traceId = span.TraceId;
      if (!traceId) {
        logger.warn('[SpanVisualizer] Span has no trace ID', { spanId });
        return `Span ${spanId} does not have a trace ID`;
      }
      
      // Get all spans in this trace
      const allSpans = await this.getSpansForTrace(traceId, query);
      if (!allSpans || allSpans.length === 0) {
        logger.warn('[SpanVisualizer] No spans found for trace', { traceId });
        return `No spans found for trace ID: ${traceId}`;
      }
      
      logger.info('[SpanVisualizer] Building flowchart', { 
        spanId, 
        traceId, 
        spanCount: allSpans.length 
      });
      
      // Build the Mermaid flowchart
      const flowchart = this.buildMermaidFlowchart(span, allSpans);
      logger.info('[SpanVisualizer] Flowchart generated successfully');
      return flowchart;
    } catch (error) {
      logger.error('[SpanVisualizer] Error generating flowchart', { 
        spanId, 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      return `Error generating flowchart: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  
  /**
   * Get all spans for a trace, optionally filtered by a query
   */
  private async getSpansForTrace(traceId: string, query?: string): Promise<any[]> {
    logger.info('[SpanVisualizer] Getting spans for trace', { traceId, query });
    
    // Build the Elasticsearch query
    const esQuery: any = {
      size: 1000,
      query: {
        bool: {
          must: [
            { term: { 'TraceId.keyword': traceId } }
          ]
        }
      },
      sort: [
        { 'Resource.service.name.keyword': { order: 'asc' } },
        { 'Name.keyword': { order: 'asc' } }
      ]
    };
    
    // Add additional query if provided
    if (query && query.trim() !== '') {
      esQuery.query.bool.must.push({
        query_string: {
          query: query
        }
      });
    }
    
    logger.info('[SpanVisualizer] Executing trace query', { esQuery });
    
    // Execute the query
    const response = await this.esAdapter.queryTraces(esQuery);
    
    // Extract and return the spans
    const spans = response.hits?.hits?.map((hit: any) => hit._source) || [];
    logger.info('[SpanVisualizer] Found spans for trace', { traceId, count: spans.length });
    
    return spans;
  }
  
  /**
   * Build a Mermaid flowchart from spans
   */
  private buildMermaidFlowchart(targetSpan: any, allSpans: any[]): string {
    // Log the structure of the first span to help with debugging
    if (allSpans.length > 0) {
      logger.info('[SpanVisualizer] Sample span structure', { 
        spanId: allSpans[0].SpanId,
        fields: Object.keys(allSpans[0]).filter(k => k.includes('service'))
      });
    }
    
    // Create a map of span IDs to spans for quick lookup
    const spanMap = new Map<string, any>();
    for (const span of allSpans) {
      spanMap.set(span.SpanId, span);
    }
    
    // Start building the Mermaid flowchart
    const mermaidLines = ['flowchart TD'];
    
    // Track processed span relationships to avoid duplicates
    const processedEdges = new Set<string>();
    
    // Add nodes for each service
    const serviceNodes = new Map<string, string>();
    const serviceSpans = new Map<string, string[]>();
    
    // First pass: identify all services
    for (const span of allSpans) {
      // Try different paths to find the service name
      let service = 'unknown';
      
      if (span['Resource.service.name']) {
        // Flattened structure (field names with dots)
        service = span['Resource.service.name'];
      } else if (span.Resource?.service?.name) {
        // Nested structure
        service = span.Resource.service.name;
      } else if (span.Scope?.name) {
        // Fallback to scope name
        service = span.Scope.name;
      }
      
      if (!serviceNodes.has(service)) {
        // Create a simple, sanitized ID for the service
        const nodeId = `svc_${serviceNodes.size + 1}`;
        serviceNodes.set(service, nodeId);
        if (!serviceSpans.has(service)) {
          serviceSpans.set(service, []);
        }
      }
      
      // Add this span to its service's span list
      const spans = serviceSpans.get(service) || [];
      spans.push(span.SpanId);
      serviceSpans.set(service, spans);
    }
    
    // Add service nodes with simple IDs and descriptive labels
    for (const [service, nodeId] of serviceNodes.entries()) {
      const spanCount = serviceSpans.get(service)?.length || 0;
      // Use simple node ID with a descriptive label
      mermaidLines.push(`  ${nodeId}["${service} (${spanCount} spans)"]`);
    }
    
    // Add nodes for each span with simple IDs
    let spanNodeCounter = 1;
    const spanNodeIds = new Map<string, string>();
    
    for (const span of allSpans) {
      const spanId = span.SpanId;
      const name = span.Name || 'unnamed';
      
      // Create a simple ID for the span
      const spanNodeId = `span_${spanNodeCounter++}`;
      spanNodeIds.set(spanId, spanNodeId);
      
      // Determine the service name using the same logic as above
      let service = 'unknown';
      if (span['Resource.service.name']) {
        service = span['Resource.service.name'];
      } else if (span.Resource?.service?.name) {
        service = span.Resource.service.name;
      } else if (span.Scope?.name) {
        service = span.Scope.name;
      }
      
      const serviceNodeId = serviceNodes.get(service) || serviceNodes.get('unknown') || 'unknown';
      
      // Highlight the target span
      const isTargetSpan = spanId === targetSpan.SpanId;
      
      // Add the span node with a simple ID and descriptive label
      mermaidLines.push(`  ${spanNodeId}["${name}"]`);
      
      // Connect span to its service
      mermaidLines.push(`  ${serviceNodeId} --> ${spanNodeId}`);
    }
    
    // Second pass: connect spans to their parents
    for (const span of allSpans) {
      const spanId = span.SpanId;
      const spanNodeId = spanNodeIds.get(spanId);
      if (!spanNodeId) continue;
      
      // Connect span to its parent if it exists
      const parentSpanId = span.ParentSpanId;
      if (parentSpanId) {
        const parentNodeId = spanNodeIds.get(parentSpanId);
        if (parentNodeId) {
          const edgeKey = `${parentSpanId}->${spanId}`;
          if (!processedEdges.has(edgeKey)) {
            mermaidLines.push(`  ${parentNodeId} --> ${spanNodeId}`);
            processedEdges.add(edgeKey);
          }
        }
      }
    }
    
    // Highlight the target span using a class
    const targetNodeId = spanNodeIds.get(targetSpan.SpanId);
    if (targetNodeId) {
      mermaidLines.push('  classDef targetSpan fill:#f96,stroke:#333,stroke-width:2');
      mermaidLines.push(`  class ${targetNodeId} targetSpan`);
    }
    
    return mermaidLines.join('\n');
  }
}
