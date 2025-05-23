import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { SpanVisualizerTool } from '../spanVisualizer.js';
import { TraceFieldsTool } from '../traceFields.js';

/**
 * Register trace-related tools with the MCP server
 */
export function registerTraceTools(server: McpServer, esAdapter: ElasticsearchAdapter) {
  const spanVisualizerTool = new SpanVisualizerTool(esAdapter);
  const traceFieldsTool = new TraceFieldsTool(esAdapter);

  // Analyze trace
  server.tool(
    'analyzeTrace',
    { traceId: z.string() },
    async (args, extra) => {
      const analysis = await esAdapter.analyzeTrace(args.traceId);
      let result;
      if (typeof analysis === 'string') {
        result = analysis;
      } else if (analysis && analysis.message) {
        result = analysis.message;
      } else {
        result = JSON.stringify(analysis, null, 2);
      }
      const output: MCPToolOutput = { content: [{ type: 'text', text: result }] };
      logger.info('[MCP TOOL] analyze-trace result', { args, output });
      return output;
    }
  );

  // Span lookup
  server.tool(
    'lookupSpan',
    { 'SpanId': z.string() },
    async (args, extra) => {
      const span = await esAdapter.spanLookup(args['SpanId']);
      const output: MCPToolOutput = { content: [{ type: 'text', text: span ? JSON.stringify(span, null, 2) : 'Span not found.' }] };
      logger.info('[MCP TOOL] span.lookup result', { args, output });
      return output;
    }
  );

  // Service dependency graph
  server.tool(
    'generateServiceDependencyGraph',
    {
      startTime: z.string().describe('Start time (ISO 8601)'),
      endTime: z.string().describe('End time (ISO 8601)')
    },
    async (args, extra) => {
      const edges: Array<{ parent: string, child: string, count: number, errorCount?: number, errorRate?: number }> = await esAdapter.serviceDependencyGraph(args.startTime, args.endTime);
      logger.info('[MCP TOOL] service.dependency.graph result', { args, edgeCount: edges.length, edges });
      if (!edges.length) {
        logger.info('[MCP TOOL] service.dependency.graph: No service dependencies found.', { args });
        return { content: [{ type: 'text', text: 'No service dependencies found.' }] } as MCPToolOutput;
      }
      
      // Build mermaid syntax for the service map
      const mermaidLines = ["flowchart TD"];
      
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

  // Define interface for enhanced error object
  interface EnhancedError {
    error: string;
    count: number;
    level?: string;
    service?: string;
    timestamp?: string;
    trace_id?: string;
    span_id?: string;
    trace?: {
      id: string;
      duration: number;
      spanCount: number;
      services: string[];
      rootOperation: string;
    };
    metrics?: Record<string, any>;
  }

  // Top errors
  server.tool(
    'listTopErrors',
    {
      startTime: z.string().describe('Start time (ISO 8601) - The beginning of the time window.'),
      endTime: z.string().describe('End time (ISO 8601) - The end of the time window.'),
      N: z.number().optional().default(10).describe('Number of top errors to return (default: 10).'),
      service: z.string().optional().describe('Service name (optional) - The service whose errors to analyze. If not provided, errors from all services will be included unless services array is specified.'),
      services: z.array(z.string()).optional().describe('Services array (optional) - Multiple services whose errors to analyze. Takes precedence over service parameter if both are provided.')
    },
    async (args, extra) => {
      try {
        // Determine which services to use
        let serviceFilter: string | string[] | undefined = undefined;
        if (args.services && args.services.length > 0) {
          serviceFilter = args.services;
        } else if (args.service) {
          serviceFilter = args.service;
        }
        
        // Get top errors
        const top = await esAdapter.topErrors(args.startTime, args.endTime, args.N, serviceFilter);
        
        if (!top.length) {
          return { content: [{ type: 'text', text: 'No errors found.' }] } as MCPToolOutput;
        }
        
        // Enhance with trace information where available
        const enhancedErrors = await Promise.all(top.map(async (error): Promise<EnhancedError> => {
          const enhancedError: EnhancedError = { ...error };
          
          // If we have a trace ID, get more information about it
          if (enhancedError.trace_id) {
            try {
              const traceInfo = await esAdapter.analyzeTrace(enhancedError.trace_id);
              if (traceInfo) {
                enhancedError.trace = {
                  id: enhancedError.trace_id,
                  duration: traceInfo.duration,
                  spanCount: traceInfo.spanCount,
                  services: traceInfo.services,
                  rootOperation: traceInfo.rootOperation
                };
              }
            } catch (e) {
              logger.warn(`Could not get trace info for ${enhancedError.trace_id}`, { error: e });
            }
          }
          
          // Try to get related metrics for the service around the error time
          if (enhancedError.service && enhancedError.service !== 'unknown' && enhancedError.timestamp) {
            try {
              // Get metrics for a window around the error
              const errorTime = new Date(enhancedError.timestamp);
              const metricStartTime = new Date(errorTime.getTime() - 5 * 60000).toISOString(); // 5 minutes before
              const metricEndTime = new Date(errorTime.getTime() + 5 * 60000).toISOString(); // 5 minutes after
              
              // Get CPU and memory metrics if available
              const metricFields = ['system.cpu.usage', 'system.memory.usage', 'http.server.duration'];
              const metrics: Record<string, any> = {};
              
              for (const field of metricFields) {
                try {
                  const metricData = await esAdapter.aggregateOtelMetricsRange(
                    metricStartTime,
                    metricEndTime,
                    field,
                    enhancedError.service
                  );
                  
                  if (metricData && metricData.length > 0) {
                    // Parse the JSON string
                    const parsedMetrics = metricData.map(m => JSON.parse(m));
                    if (parsedMetrics.length > 0) {
                      metrics[field] = parsedMetrics[0];
                    }
                  }
                } catch (e) {
                  logger.warn(`Could not get metrics for ${field}`, { error: e });
                }
              }
              
              if (Object.keys(metrics).length > 0) {
                enhancedError.metrics = metrics;
              }
            } catch (e) {
              logger.warn(`Could not get metrics for ${enhancedError.service}`, { error: e });
            }
          }
          
          return enhancedError;
        }));
        
        const output = { content: [{ type: 'text', text: JSON.stringify(enhancedErrors, null, 2) }] } as MCPToolOutput;
        logger.info('[MCP TOOL] listTopErrors result', { 
          startTime: args.startTime,
          endTime: args.endTime,
          service: args.service,
          services: args.services,
          N: args.N,
          errorCount: enhancedErrors.length
        });
        return output;
      } catch (error) {
        logger.error('[MCP TOOL] listTopErrors error', { error });
        return { content: [{ type: 'text', text: `Error retrieving top errors: ${error}` }] } as MCPToolOutput;
      }
    }
  );

  // Services
  server.tool(
    'listServices',
    { search: z.string().optional() },
    async (args: { search?: string } = {}) => {
      if (!args || typeof args !== 'object') args = {};
      logger.info('[MCP TOOL] services tool called with args', { args });
      try {
        const services = await esAdapter.getServices(args.search);
        logger.info('[MCP TOOL] services returned from adapter', { count: services.length, services });
        
        // Format the output to display services with their versions
        const formattedServices = services.map(service => {
          return {
            name: service.name,
            versions: service.versions.length > 0 ? service.versions : ['unknown']
          };
        });
        
        const output: MCPToolOutput = { content: [{ type: 'text', text: JSON.stringify(formattedServices, null, 2) }] };
        logger.info('[MCP TOOL] services result', { args, output });
        return output;
      } catch (error) {
        logger.error('[MCP TOOL] services error', { error });
        return { content: [{ type: 'text', text: `Error getting services: ${error}` }] };
      }
    }
  );

  // Span flowchart
  server.tool(
    'generateSpanFlowchart',
    {
      spanId: z.string().describe('Span ID to visualize'),
      query: z.string().optional().describe('Optional query to filter related spans (e.g. "Resource.service.name:payment")')
    },
    async (args: { spanId: string, query?: string }, extra: unknown) => {
      logger.info('[MCP TOOL] span-flowchart called', { args });
      try {
        // Validate the span ID format
        if (!args.spanId || args.spanId.trim() === '') {
          logger.warn('[MCP TOOL] span-flowchart called with empty spanId');
          return { 
            content: [{ 
              type: 'text', 
              text: 'Error: Span ID is required' 
            }] 
          };
        }
        
        const mermaidChart = await spanVisualizerTool.generateSpanFlowchart(args.spanId, args.query);
        
        // Check if the result is an error message
        if (mermaidChart.startsWith('No span found') || 
            mermaidChart.startsWith('Error generating') ||
            mermaidChart.startsWith('No spans found')) {
          logger.warn('[MCP TOOL] span-flowchart returned error', { message: mermaidChart });
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
        
        logger.info('[MCP TOOL] span-flowchart result generated successfully');
        return output;
      } catch (error) {
        logger.error('[MCP TOOL] span-flowchart error', { 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
        return { 
          content: [{ 
            type: 'text', 
            text: `Error generating span flowchart: ${error instanceof Error ? error.message : String(error)}` 
          }] 
        };
      }
    }
  );

  // Traces query
  server.tool(
    'queryTraces',
    { query: z.object({
      query: z.record(z.unknown()).optional(),
      size: z.number().optional(),
      from: z.number().optional(),
      sort: z.any().optional(),
      aggs: z.record(z.unknown()).optional(),
      _source: z.union([z.array(z.string()), z.boolean()]).optional(),
      search: z.string().optional(),
      agg: z.record(z.unknown()).optional()
    }).strict().describe('Query OTEL traces in Elasticsearch. Use the same query format as Elasticsearch. Run searchForTraceFields to get a list of available fields and their schemas.') },
    async (args: { query?: any }) => {
      const resp = await esAdapter.queryTraces(args.query);
      const output: MCPToolOutput = { content: [{ type: 'text', text: JSON.stringify(resp) }] };
      logger.info('[MCP TOOL] traces result', { args, output });
      return output;
    }
  );
  
  // Trace fields schema
  server.tool(
    'searchForTraceFields',
    { 
      search: z.string().optional().describe('Search term to filter trace fields.'),
      service: z.string().optional().describe('Service name (optional) - Filter fields to only those present in data from this service.'),
      services: z.array(z.string()).optional().describe('Services array (optional) - Filter fields to only those present in data from these services. Takes precedence over service parameter if both are provided.')
    },
    async (args: { search?: string, service?: string, services?: string[] }, _extra: unknown) => {
      try {
        logger.info('[MCP TOOL] traceFieldsSchema called', { args });
        
        // Determine which services to use
        let serviceFilter: string | string[] | undefined = undefined;
        if (args.services && args.services.length > 0) {
          serviceFilter = args.services;
        } else if (args.service) {
          serviceFilter = args.service;
        }
        
        // Get trace fields, filtered by service if specified
        const fields = await traceFieldsTool.getTraceFields(args.search, serviceFilter);
        
        // Format the output
        const result = {
          totalFields: fields.length,
          fields: fields.map(field => ({
            name: field.name,
            type: field.type,
            count: field.count,
            schema: field.schema,
            coOccurringFields: field.coOccurringFields?.slice(0, 20) || []
          }))
        };
        
        return { 
          content: [{ 
            type: 'text', 
            text: JSON.stringify(result, null, 2) 
          }] 
        };
      } catch (error) {
        logger.error('[MCP TOOL] traceFieldsSchema error', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        
        return { 
          content: [{ 
            type: 'text', 
            text: `Error retrieving trace fields schema: ${error instanceof Error ? error.message : String(error)}` 
          }] 
        };
      }
    }
  );
}
