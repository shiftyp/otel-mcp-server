import type { MCPToolOutput } from '../../types.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { logger } from '../../utils/logger.js';

interface ErrorResponse {
  error: string;
  count: number;
  service?: string;
  level?: string;
  timestamp?: string;
  trace_id?: string;
  span_id?: string;
  // Additional fields we'll use if available
  related_services?: string[];
}

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
   * Extract an incident subgraph from OTEL traces and service dependencies.
   * This identifies affected nodes and edges based on error filters.
   * 
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param service Optional service name to focus on
   * @param query Optional query string to filter incidents
   * @returns Mermaid diagram of the incident graph
   */
  async extractIncidentGraph(
    startTime: string, 
    endTime: string, 
    service?: string,
    query?: string
  ): Promise<MCPToolOutput> {
    try {
      // Use the topErrors functionality to get the top errors
      const limit = 100; // Get a large number of errors to build a comprehensive graph
      
      // Prepare service filter - if provided, ensure it's properly formatted for fuzzy matching
      let serviceFilter = service;
      if (serviceFilter && typeof serviceFilter === 'string') {
        // No need to modify here as the adapter will handle the fuzzy matching
        // The topErrors method will use the consistent wildcard pattern internally
      }
      
      // Query the errors index using the adapter with proper parameters
      const errorResponse = await this.esAdapter.topErrors(
        startTime,  // Start time as string
        endTime,    // End time as string
        limit,      // Number of errors to return
        serviceFilter,    // Optional service filter with fuzzy matching
        query       // Optional query pattern
      );
      
      if (!errorResponse || !Array.isArray(errorResponse) || errorResponse.length === 0) {
        // No errors found
        logger.info('[IncidentGraphTool] No errors found in the specified time range');
        return { 
          content: [
            { type: 'text', text: '```mermaid\nflowchart TD\n```\n\nNo errors found in the specified time range.' }
          ] 
        };
      }
      
      // Extract service information and error counts from the response
      const serviceErrorCounts = new Map<string, number>();
      
      // Also try to find related services from trace data if available
      const serviceRelationships = new Map<string, Set<string>>();
      
      // Process each error to build the graph
      for (const error of errorResponse) {
        const service = error.service || 'unknown';
        
        // Count errors per service
        serviceErrorCounts.set(service, (serviceErrorCounts.get(service) || 0) + error.count);
        
        // If the error has a trace_id, try to find related services
        if (error.trace_id) {
          // We'll need to query for this trace to get related services
          try {
            const traceQuery = {
              query: {
                bool: {
                  must: [
                    { term: { 'trace.id': error.trace_id } }
                  ]
                }
              },
              size: 100,
              _source: ['resource.service.name', 'Resource.service.name', 'service.name']
            };
            
            // Query for spans in this trace
            const traceResponse = await this.esAdapter.queryTraces(traceQuery);
            const traceSpans = traceResponse.hits?.hits?.map((h: any) => h._source) || [];
            
            // Extract unique services from the trace
            const servicesInTrace = new Set<string>();
            for (const span of traceSpans) {
              const spanService = 
                span['resource.service.name'] || 
                span['Resource.service.name'] || 
                span['service.name'] || 
                'unknown';
              
              if (spanService !== 'unknown') {
                servicesInTrace.add(spanService);
              }
            }
            
            // If we found multiple services, create relationships
            if (servicesInTrace.size > 1) {
              // Make sure the error service is in the set
              if (service !== 'unknown') {
                servicesInTrace.add(service);
              }
              
              // Create relationships between all services in the trace
              const serviceArray = Array.from(servicesInTrace);
              for (let i = 0; i < serviceArray.length; i++) {
                const fromService = serviceArray[i];
                
                // Initialize the set of related services if needed
                if (!serviceRelationships.has(fromService)) {
                  serviceRelationships.set(fromService, new Set<string>());
                }
                
                // Add relationships to other services in the trace
                for (let j = 0; j < serviceArray.length; j++) {
                  if (i !== j) {
                    const toService = serviceArray[j];
                    serviceRelationships.get(fromService)?.add(toService);
                  }
                }
              }
            }
          } catch (traceError) {
            logger.warn('[IncidentGraphTool] Error querying trace', { 
              trace_id: error.trace_id, 
              error: traceError 
            });
          }
        }
      }
      
      // If we couldn't find any service relationships, try to infer them from error patterns
      if (serviceRelationships.size === 0 && serviceErrorCounts.size > 1) {
        // Create a simple chain of services based on error counts
        const sortedServices = Array.from(serviceErrorCounts.entries())
          .sort((a, b) => b[1] - a[1]) // Sort by error count, descending
          .map(entry => entry[0]);
        
        // Create a chain of services
        for (let i = 0; i < sortedServices.length - 1; i++) {
          const fromService = sortedServices[i];
          const toService = sortedServices[i + 1];
          
          // Initialize the set of related services if needed
          if (!serviceRelationships.has(fromService)) {
            serviceRelationships.set(fromService, new Set<string>());
          }
          
          // Add the relationship
          serviceRelationships.get(fromService)?.add(toService);
        }
      }
      
      // Generate the mermaid diagram
      const mermaidDiagram = this.generateMermaidDiagram(serviceErrorCounts, serviceRelationships);
      
      return { 
        content: [
          { type: 'text', text: '```mermaid\n' + mermaidDiagram + '\n```' }
        ] 
      };
    } catch (error) {
      logger.error('[IncidentGraphTool] Error generating incident graph', { error });
      return { 
        content: [
          { type: 'text', text: `Error generating incident graph: ${error instanceof Error ? error.message : String(error)}` }
        ] 
      };
    }
  }

  /**
   * Generate a mermaid diagram from service error counts and relationships
   */
  private generateMermaidDiagram(
    serviceErrorCounts: Map<string, number>,
    serviceRelationships: Map<string, Set<string>>
  ): string {
    const mermaidLines = ["flowchart TD"];
    
    // Create nodes for each service with error count
    for (const [service, errorCount] of serviceErrorCounts.entries()) {
      // Create a sanitized service name for the node ID (remove special chars)
      const safeServiceName = service.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      
      // Create a node for this service with error count
      mermaidLines.push(`  ${safeServiceName}["${service}\n${errorCount} errors"]`);
    }
    
    // Add service-level edges with counts
    const edgeCounts = new Map<string, number>();
    
    // Count edges between services
    for (const [fromService, toServices] of serviceRelationships.entries()) {
      // Create sanitized service name
      const fromServiceId = fromService.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      
      for (const toService of toServices) {
        // Skip if we don't have error data for this service
        if (!serviceErrorCounts.has(toService)) continue;
        
        // Create sanitized service name
        const toServiceId = toService.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        
        // Skip self-loops
        if (fromServiceId === toServiceId) continue;
        
        // Create a unique key for this edge
        const edgeKey = `${fromServiceId}->${toServiceId}`;
        
        // Increment the count for this edge
        edgeCounts.set(edgeKey, (edgeCounts.get(edgeKey) || 0) + 1);
      }
    }
    
    // Add edges to the diagram
    for (const [edgeKey, count] of edgeCounts.entries()) {
      const [fromServiceId, toServiceId] = edgeKey.split('->');
      
      // Add a label for the edge if there are multiple calls
      let label = count > 1 ? `|"${count} calls"|` : '';
      
      // Add the edge to the mermaid diagram
      mermaidLines.push(`  ${fromServiceId} -->${label} ${toServiceId}`);
    }
    
    // Add styling for error nodes
    mermaidLines.push('');
    mermaidLines.push('  classDef error fill:#f96, stroke:#333, stroke-width:2px;');
    
    // Apply the error class to all service nodes
    const serviceList = Array.from(serviceErrorCounts.keys())
      .map(service => service.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase())
      .join(',');
    
    if (serviceList) {
      mermaidLines.push(`  class ${serviceList} error;`);
    }
    
    return mermaidLines.join('\n');
  }
}
