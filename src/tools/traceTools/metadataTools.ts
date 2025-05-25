import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { TraceFieldsTool } from '../traceFields.js';
import { EnhancedError } from './types.js';
import { registerMcpTool } from '../../utils/registerTool.js';

/**
 * Register trace metadata tools with the MCP server
 */
export function registerTraceMetadataTools(server: McpServer, esAdapter: ElasticsearchAdapter) {
  const traceFieldsTool = new TraceFieldsTool(esAdapter);

  // Services
  registerMcpTool(
    server,
    'servicesGet',
    { search: z.string().optional().describe('Filter services by name pattern') },
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

  // Top errors
  registerMcpTool(
    server,
    'errorsGetTop',
    {
      timeRange: z.object({
        start: z.string().describe('Start time in ISO 8601 format'),
        end: z.string().describe('End time in ISO 8601 format')
      }).describe('Time window for analysis'),
      limit: z.number().optional().default(10).describe('Maximum number of errors to return'),
      service: z.string().optional().describe('Filter to errors from a specific service'),
      services: z.array(z.string()).optional().describe('Filter to errors from multiple services (overrides service parameter)'),
      pattern: z.string().optional().describe('Filter errors by text pattern')
    },
    async (args: any, extra: unknown) => {
      try {
        // Determine which services to use
        let serviceFilter: string | string[] | undefined = undefined;
        if (args.services && args.services.length > 0) {
          serviceFilter = args.services;
        } else if (args.service) {
          serviceFilter = args.service;
        }
        
        // Extract time range and parameters
        const startTime = args.timeRange?.start || args.startTime;
        const endTime = args.timeRange?.end || args.endTime;
        const limit = args.limit || args.N || 10;
        const searchPattern = args.pattern || args.search;
        
        if (!startTime || !endTime) {
          throw new Error('Time range is required (either as timeRange object or startTime/endTime parameters)');
        }
        
        // Get top errors with optional search pattern
        const top = await esAdapter.topErrors(startTime, endTime, limit, serviceFilter, searchPattern);
        
        if (!top.length) {
          const searchInfo = args.search ? ` matching pattern "${args.search}"` : '';
          return { content: [{ type: 'text', text: `No errors found${searchInfo}.` }] } as MCPToolOutput;
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

  // Trace fields
  registerMcpTool(
    server,
    'traceFieldsGet',
    { 
      search: z.string().optional().describe('Filter fields by name pattern'),
      service: z.string().optional().describe('Filter to fields from a specific service'),
      services: z.array(z.string()).optional().describe('Filter to fields from multiple services (overrides service parameter)'),
      includeSourceFields: z.boolean().optional().default(false).describe('Include source document fields in results')
    },
    async (args: { search?: string, service?: string, services?: string[], includeSourceFields?: boolean }, _extra: unknown) => {
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
        // Use the new parameter name, with fallback to default value
        const includeSourceFields = args.includeSourceFields !== undefined ? args.includeSourceFields : false;
        const fields = await traceFieldsTool.getTraceFields(args.search, serviceFilter, includeSourceFields);
        
        const output: MCPToolOutput = { content: [{ type: 'text', text: JSON.stringify(fields, null, 2) }] };
        logger.info('[MCP TOOL] traceFieldsSchema result', { args, fieldCount: fields.length });
        return output;
      } catch (error) {
        logger.error('[MCP TOOL] traceFieldsSchema error', { error });
        return { content: [{ type: 'text', text: `Error getting trace fields: ${error}` }] };
      }
    }
  );
}
