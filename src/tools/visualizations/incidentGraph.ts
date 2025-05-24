import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';

/**
 * Tool for extracting an incident subgraph from OTEL traces and service dependencies.
 * The incident graph includes only affected nodes/edges (e.g., services/spans with errors or anomalies) for a given time window and optional service.
 */
export class IncidentGraphTool {
  private esAdapter: ElasticsearchAdapter;

  constructor(esAdapter: ElasticsearchAdapter) {
    this.esAdapter = esAdapter;
  }

  /**
   * Extracts the incident subgraph for a given time window and (optionally) service.
   * Nodes: services or spans involved in errors/anomalies
   * Edges: dependency/call relationships between affected nodes
   *
   * @param startTime ISO8601 start of incident window
   * @param endTime ISO8601 end of incident window
   * @param service (optional) focus on a single service
   * @returns MCPToolOutput with the incident graph visualization
   */
  async extractIncidentGraph(
    startTime: string, 
    endTime: string, 
    service?: string,
    query?: string
  ): Promise<MCPToolOutput> {
    // 1. Get all spans in the window (optionally filter by service)
    const must: any[] = [
      {
        range: {
          '@timestamp': {
            gte: startTime,
            lte: endTime,
            format: 'strict_date_optional_time'
          }
        }
      }
    ];
    
    // Add service filter if provided - support multiple service name field patterns
    if (service) {
      must.push({
        bool: {
          should: [
            { term: { 'Resource.service.name': service } },
            { term: { 'resource.attributes.service.name': service } },
            { term: { 'service.name': service } }
          ],
          minimum_should_match: 1
        }
      });
    }
    
    // Add custom query if provided
    if (query) {
      must.push({
        query_string: {
          query: query
        }
      });
    }
    
    // Add filter for error spans
    const errorFilter = {
      bool: {
        should: [
          // OTEL spec status codes
          { term: { 'Status.code': 'ERROR' } },
          { term: { 'TraceStatus': 2 } }, // 2 = ERROR in OTEL
          
          // Error events
          { exists: { field: 'Events.exception' } },
          
          // Error attributes
          { exists: { field: 'Attributes.error' } }
        ],
        minimum_should_match: 1
      }
    };
    must.push(errorFilter);
    
    // Query for error spans
    const esQuery = {
      size: 10000,
      query: { bool: { must } },
      _source: [
        // Support multiple field patterns for span data
        'SpanId', 'span_id', 'span.id',
        'ParentSpanId', 'parent_span_id', 'parent.span.id',
        'Resource.service.name', 'resource.attributes.service.name', 'service.name',
        'TraceStatus', 'Status.code', 'status.code',
        'Events.exception', 'Attributes.error',
        'Name', 'name',
        '@timestamp'
      ]
    };
    
    // Execute the query
    const response = await this.esAdapter.queryTraces(esQuery);
    const spans = response.hits?.hits?.map((h: any) => h._source) || [];

    // 2. Identify affected nodes (spans/services with errors or anomalies)
    // All spans from the query are already error spans due to our filter
    const affectedSpans = spans;
    
    // Extract span IDs using multiple possible field names
    const affectedSpanIds = new Set(
      affectedSpans.map((s: any) => s.SpanId || s.span_id || s['span.id'])
    );
    
    // Extract service names using multiple possible field names
    const affectedServices = new Set(
      affectedSpans.map((s: any) => 
        s['Resource.service.name'] || 
        s['resource.attributes.service.name'] || 
        s['service.name'] || 
        'unknown'
      )
    );

    // 3. Build nodes and edges for subgraph
    const nodes: any[] = [];
    const edges: any[] = [];
    const nodeIds = new Set();
    
    for (const span of affectedSpans) {
      // Extract span ID using multiple possible field names
      const nodeId = span.SpanId || span.span_id || span['span.id'];
      if (!nodeId) continue; // Skip if no valid span ID
      
      if (!nodeIds.has(nodeId)) {
        // Extract service name using multiple possible field names
        const service = 
          span['Resource.service.name'] || 
          span['resource.attributes.service.name'] || 
          span['service.name'] || 
          'unknown';
        
        // Extract span name using multiple possible field names
        const name = span.Name || span.name || 'unknown operation';
        
        // Extract error status using multiple possible field names
        const status = 
          span.TraceStatus || 
          span['Status.code'] || 
          span['status.code'] || 
          'ERROR';
        
        // Extract error details
        const statusMessage = 
          (span.Events?.exception?.exception?.message) || 
          (span.Events?.exception?.exception?.type) || 
          (span.Attributes?.error) || 
          'Error detected';
        
        nodes.push({
          id: nodeId,
          service,
          name,
          status,
          statusMessage,
          timestamp: span['@timestamp']
        });
        nodeIds.add(nodeId);
      }
      
      // Extract parent span ID using multiple possible field names
      const parentSpanId = 
        span.ParentSpanId || 
        span.parent_span_id || 
        span['parent.span.id'];
      
      // Add edge from parent if parent is also affected
      if (parentSpanId && affectedSpanIds.has(parentSpanId)) {
        edges.push({
          from: parentSpanId,
          to: nodeId,
          type: 'span',
        });
      }
    }

    const result = {
      nodes,
      edges,
      affectedServices: Array.from(affectedServices),
      mermaid: this.toIncidentMermaid(nodes, edges)
    };

    // Create a markdown representation with the mermaid diagram
    const markdown = '```mermaid\n' + result.mermaid + '\n```\n\n';
    
    return { 
      content: [
        { type: 'text', text: markdown }
      ] 
    };
  }

  /**
   * Convert incident graph nodes/edges to mermaid flowchart syntax.
   * Canonical edge fields: edge.from, edge.to; optionally edge.label.
   */
  private toIncidentMermaid(nodes: any[], edges: any[]): string {
    const mermaidLines = ["flowchart TD"];
    for (const edge of edges) {
      const fromNode = nodes.find(n => n.id === edge.from);
      const toNode = nodes.find(n => n.id === edge.to);
      const fromLabel = fromNode ? (fromNode.service ? `${fromNode.service}:${fromNode.name}` : fromNode.name) : edge.from;
      const toLabel = toNode ? (toNode.service ? `${toNode.service}:${toNode.name}` : toNode.name) : edge.to;
      let label = '';
      if (edge.label) label = `|${edge.label}|`;
      mermaidLines.push(`${fromLabel} -->${label} ${toLabel}`);
    }
    return mermaidLines.join('\n');
  }
}
