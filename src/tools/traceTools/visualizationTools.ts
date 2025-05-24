import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { SpanVisualizerTool } from '../spanVisualizer.js';
import { registerMcpTool } from '../../utils/registerTool.js';

/**
 * Register trace visualization tools with the MCP server
 */
export function registerTraceVisualizationTools(server: McpServer, esAdapter: ElasticsearchAdapter) {
  const spanVisualizerTool = new SpanVisualizerTool(esAdapter);

  // Service dependency graph
  registerMcpTool(
    server,
    'generateServiceDependencyGraph',
    {
      startTime: z.string().describe('Start time (ISO 8601)'),
      endTime: z.string().describe('End time (ISO 8601)')
    },
    async (args: {
      startTime: string;
      endTime: string;
    }, extra: unknown) => {
      const edges: Array<{ parent: string, child: string, count: number, errorCount?: number, errorRate?: number }> = await esAdapter.serviceDependencyGraph(args.startTime, args.endTime);
      logger.info('[MCP TOOL] service.dependency.graph result', { args, edgeCount: edges.length, edges });
      if (!edges.length) {
        logger.info('[MCP TOOL] service.dependency.graph: No service dependencies found.', { args });
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
      
      // Assign simple sequential IDs to services
      Array.from(allServices).forEach((service, index) => {
        // Create a simple sequential ID
        const simpleId = `service${index + 1}`;
        serviceIds.set(service, simpleId);
      });
      
      // Second pass: add node definitions with descriptive labels
      for (const service of allServices) {
        const id = serviceIds.get(service) || `service${serviceIds.size + 1}`;
        mermaidLines.push(`  ${id}["${service}"]`);
      }
      
      // Third pass: add edges between services
      for (const edge of edges) {
        const fromId = serviceIds.get(edge.parent) || 'unknown';
        const toId = serviceIds.get(edge.child) || 'unknown';
        
        // Build the edge label
        let label = '';
        const countLabel = typeof edge.count === 'number' ? `${edge.count}` : '';
        let successLabel = '';
        let errorLabel = '';
        
        if (typeof edge.count === 'number' && edge.count > 0) {
          const errorPct = Math.round((edge.errorRate || 0) * 100);
          const successPct = 100 - errorPct;
          
          if (edge.errorRate && edge.errorRate > 0) {
            errorLabel = ` (${errorPct}% err)`;
          }
        }
        
        if (countLabel || errorLabel) {
          label = `|${countLabel}${errorLabel}|`;
        }
        
        // Add the edge
        mermaidLines.push(`  ${fromId} -->${label} ${toId}`);
      }
      
      // Add styling for services with errors
      mermaidLines.push('  classDef error fill:#f96,stroke:#333,stroke-width:2');
      
      // Apply error styling to services with errors
      const errorServices = Array.from(serviceHasError.entries())
        .filter(([_, hasError]) => hasError)
        .map(([service, _]) => serviceIds.get(service))
        .filter(id => id) // Filter out undefined IDs
        .join(',');
      
      if (errorServices) {
        mermaidLines.push(`  class ${errorServices} error`);
      }
      
      const mermaid = mermaidLines.join('\n');
      
      const output: MCPToolOutput = {
        content: [{
          type: 'text',
          text: JSON.stringify({ edges, mermaid }, null, 2)
        }]
      };
      
      logger.info('[MCP TOOL] service.dependency.graph output', { output });
      return output;
    }
  );

  // Span Gantt chart
  registerMcpTool(
    server,
    'generateSpanGanttChart',
    {
      spanId: z.string().describe('Span ID to visualize'),
      query: z.string().optional().describe('Optional query to filter related spans (e.g. "Resource.service.name:payment")')
    },
    async (args: { spanId: string, query?: string }, extra: unknown) => {
      logger.info('[MCP TOOL] span-gantt-chart called', { args });
      try {
        // Validate the span ID format
        if (!args.spanId || args.spanId.trim() === '') {
          logger.warn('[MCP TOOL] span-gantt-chart called with empty spanId');
          return { 
            content: [{ 
              type: 'text', 
              text: 'Error: Span ID is required' 
            }] 
          };
        }
        
        const mermaidChart = await spanVisualizerTool.generateGanntChart(args.spanId, args.query);
        
        // Check if the result is an error message
        if (mermaidChart.startsWith('No span found') || 
            mermaidChart.startsWith('Error generating') ||
            mermaidChart.startsWith('No spans found')) {
          logger.warn('[MCP TOOL] span-gantt-chart returned error', { message: mermaidChart });
          return { 
            content: [{ 
              type: 'text', 
              text: mermaidChart 
            }] 
          };
        }
        
        // Create a markdown representation with the mermaid diagram
        const markdown = '```mermaid\n' + mermaidChart + '\n```';
        
        const output: MCPToolOutput = { 
          content: [
            { type: 'text', text: markdown }
          ] 
        };
        
        logger.info('[MCP TOOL] span-gantt-chart result generated successfully');
        return output;
      } catch (error) {
        logger.error('[MCP TOOL] span-gantt-chart error', { 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
        return { 
          content: [{ 
            type: 'text', 
            text: `Error generating span Gantt chart: ${error instanceof Error ? error.message : String(error)}` 
          }] 
        };
      }
    }
  );
}
