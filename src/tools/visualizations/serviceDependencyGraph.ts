import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';

/**
 * Tool for generating service dependency graph visualizations
 */
export class ServiceDependencyGraphTool {
  private esAdapter: ElasticsearchAdapter;

  constructor(esAdapter: ElasticsearchAdapter) {
    this.esAdapter = esAdapter;
  }

  /**
   * Generate a service dependency graph for a given time range
   */
  public async generateServiceDependencyGraph(
    startTime: string,
    endTime: string,
    query?: string
  ): Promise<MCPToolOutput> {
    const edges: Array<{ parent: string, child: string, count: number, errorCount?: number, errorRate?: number }> = 
      await this.esAdapter.serviceDependencyGraph(startTime, endTime);
    
    logger.info('[ServiceDependencyGraphTool] result', { edgeCount: edges.length });
    
    if (!edges.length) {
      logger.info('[ServiceDependencyGraphTool] No service dependencies found.');
      return { content: [{ type: 'text', text: 'No service dependencies found.' }] } as MCPToolOutput;
    }
    
    // Build mermaid syntax for the service map
    const mermaidLines = ["graph TD"];
    
    // Create a map of service names to simple IDs
    const serviceIds = new Map<string, string>();
    const serviceHasError = new Map<string, boolean>();
    
    // First pass: collect all unique services and assign simple IDs
    const allServices = new Set<string>();
    for (const edge of edges) {
      allServices.add(edge.parent);
      allServices.add(edge.child);
      
      // Track services with errors
      if (edge.errorRate && edge.errorRate > 0) {
        serviceHasError.set(edge.parent, true);
        serviceHasError.set(edge.child, true);
      }
    }
    
    // Assign simple IDs to services (A, B, C, etc.)
    let idCounter = 0;
    for (const service of allServices) {
      // Use letters A-Z for first 26 services, then A1, B1, etc.
      const idBase = String.fromCharCode(65 + (idCounter % 26));
      const idSuffix = Math.floor(idCounter / 26) > 0 ? Math.floor(idCounter / 26).toString() : '';
      const id = idBase + idSuffix;
      serviceIds.set(service, id);
      idCounter++;
      
      // Add node definition with service name
      mermaidLines.push(`  ${id}["${service}"]`);
    }
    
    // Second pass: add all edges
    for (const edge of edges) {
      const sourceId = serviceIds.get(edge.parent);
      const targetId = serviceIds.get(edge.child);
      
      if (sourceId && targetId) {
        // Add error rate if available
        let label = '';
        if (edge.errorRate !== undefined) {
          const errorRateFormatted = (edge.errorRate * 100).toFixed(1) + '%';
          label = ` |${edge.count} calls${edge.errorRate > 0 ? `, ${errorRateFormatted} errors` : ''}|`;
        } else if (edge.count) {
          label = ` |${edge.count} calls|`;
        }
        
        mermaidLines.push(`  ${sourceId} -->${label} ${targetId}`);
      }
    }
    
    // Add styling for services with errors
    const errorServices = Array.from(serviceHasError.entries())
      .filter(([_, hasError]) => hasError)
      .map(([service, _]) => serviceIds.get(service))
      .filter(id => id) // Filter out undefined IDs
      .join(',');
    
    if (errorServices) {
      mermaidLines.push(`  class ${errorServices} error`);
    }
    
    const mermaid = mermaidLines.join('\n');
    
    // Create a markdown representation with the mermaid diagram
    const markdown = '```mermaid\n' + mermaid + '\n```\n\n';
    
    return { 
      content: [
        { type: 'text', text: markdown }
      ] 
    };
  }
}
