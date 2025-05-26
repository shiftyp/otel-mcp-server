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
        // Add error rate if available with color coding based on error rate
        let label = '';
        let edgeStyle = '';
        
        if (edge.errorRate !== undefined) {
          const errorRateFormatted = (edge.errorRate * 100).toFixed(1) + '%';
          label = ` |${edge.count} calls`;
          
          // Add error information if there are errors
          if (edge.errorRate > 0) {
            label += `, ${errorRateFormatted} errors|`;
            
            // Add color coding based on error rate
            if (edge.errorRate >= 0.5) { // >= 50% errors
              edgeStyle = ' style stroke:red,stroke-width:2px';
            } else if (edge.errorRate >= 0.2) { // >= 20% errors
              edgeStyle = ' style stroke:orange,stroke-width:1.5px';
            } else { // < 20% errors
              edgeStyle = ' style stroke:#FF9900,stroke-width:1px';
            }
          } else {
            label += '|';
          }
        } else if (edge.count) {
          label = ` |${edge.count} calls|`;
        }
        
        mermaidLines.push(`  ${sourceId} -->${label} ${targetId}${edgeStyle}`);
      }
    }
    
    // Add styling for services with errors
    // Track services with different error levels
    const highErrorServices: string[] = [];
    const mediumErrorServices: string[] = [];
    const lowErrorServices: string[] = [];
    
    // Calculate error rates per service
    const serviceErrorRates = new Map<string, number>();
    for (const edge of edges) {
      if (edge.errorRate && edge.errorRate > 0) {
        // Update parent service error rate
        const parentId = serviceIds.get(edge.parent);
        if (parentId) {
          const currentRate = serviceErrorRates.get(edge.parent) || 0;
          serviceErrorRates.set(edge.parent, Math.max(currentRate, edge.errorRate));
        }
        
        // Update child service error rate
        const childId = serviceIds.get(edge.child);
        if (childId) {
          const currentRate = serviceErrorRates.get(edge.child) || 0;
          serviceErrorRates.set(edge.child, Math.max(currentRate, edge.errorRate));
        }
      }
    }
    
    // Categorize services by error rate
    for (const [service, errorRate] of serviceErrorRates.entries()) {
      const serviceId = serviceIds.get(service);
      if (serviceId) {
        if (errorRate >= 0.5) { // >= 50% errors
          highErrorServices.push(serviceId);
        } else if (errorRate >= 0.2) { // >= 20% errors
          mediumErrorServices.push(serviceId);
        } else { // < 20% errors
          lowErrorServices.push(serviceId);
        }
      }
    }
    
    // Add styling classes for different error levels
    if (highErrorServices.length > 0) {
      mermaidLines.push(`  class ${highErrorServices.join(',')} highError`);
    }
    
    if (mediumErrorServices.length > 0) {
      mermaidLines.push(`  class ${mediumErrorServices.join(',')} mediumError`);
    }
    
    if (lowErrorServices.length > 0) {
      mermaidLines.push(`  class ${lowErrorServices.join(',')} lowError`);
    }
    
    // Add CSS styling for the error classes
    mermaidLines.push('  classDef highError fill:#ffcccc,stroke:#ff0000,stroke-width:2px,color:#990000');
    mermaidLines.push('  classDef mediumError fill:#fff2cc,stroke:#ff9900,stroke-width:1.5px,color:#cc7700');
    mermaidLines.push('  classDef lowError fill:#fff9e6,stroke:#ffcc66,stroke-width:1px,color:#cc9900');
    
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
