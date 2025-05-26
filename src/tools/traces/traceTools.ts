import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { registerMcpTool } from '../../utils/registerTool.js';
import { TraceFieldsTool } from './traceFields.js';
import { ElasticGuards } from '../../utils/elasticGuards.js';

/**
 * Register trace-related tools with the MCP server
 */
export function registerTraceTools(server: McpServer, esAdapter: ElasticsearchAdapter) {
  const traceFieldsTool = new TraceFieldsTool(esAdapter);

  // Direct trace query tool
  registerMcpTool(
    server,
    'tracesQuery',
    { query: z.object({
      query: z.record(z.unknown()).optional().describe('Elasticsearch query object'),
      size: z.number().optional().describe('Maximum number of results to return'),
      from: z.number().optional().describe('Starting offset for pagination'),
      sort: z.any().optional().describe('Sort order for results'),
      aggs: z.record(z.unknown()).optional().describe('Aggregation definitions'),
      _source: z.union([z.array(z.string()), z.boolean()]).optional().default(true).describe('Fields to include in results'),
      search: z.string().optional().describe('Simple text search across fields'),
      agg: z.record(z.unknown()).optional().describe('Simplified aggregation definition'),
      runtime_mappings: z.record(z.unknown()).optional().describe('Dynamic field definitions'),
      script_fields: z.record(z.unknown()).optional().describe('Computed fields using scripts')
    }).strict().describe('Execute custom Elasticsearch query against trace data') },
    async (args: { query: any }, extra: unknown) => {
      try {
        const resp = await esAdapter.queryTraces(args.query);
        const output: MCPToolOutput = { content: [{ type: 'text', text: JSON.stringify(resp) }] };
        logger.info('[MCP TOOL] traces result', { args, hits: resp.hits?.total?.value || 0 });
        return output;
      } catch (error) {
        logger.error('[MCP TOOL] traces query error', { 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
        
        // Return structured error response using ElasticGuards utility
        return ElasticGuards.formatErrorResponse(error, {
          query: args.query
        });
      }
    }
  );

  // Services discovery tool
  registerMcpTool(
    server,
    'servicesGet',
    { search: z.string().optional().describe('Filter services by name pattern. Pass an empty string to get all services') },
    async (args: { search?: string } = {}) => {
      if (!args || typeof args !== 'object') args = {};
      logger.info('[MCP TOOL] services called', { args });
      
      try {
        // Get services from Elasticsearch
        const services = await esAdapter.getServices(args.search);
        
        // Format services for display
        const formattedServices = services.map(service => ({
          name: service.name,
          versions: service.versions
        }));
        
        const output: MCPToolOutput = { content: [{ type: 'text', text: JSON.stringify(formattedServices, null, 2) }] };
        logger.info('[MCP TOOL] services result', { args, serviceCount: services.length });
        return output;
      } catch (error) {
        logger.error('[MCP TOOL] services error', { 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
        
        // Return structured error response using ElasticGuards utility
        return ElasticGuards.formatErrorResponse(error, {
          search: args.search
        });
      }
    }
  );

  // Trace fields discovery tool
  registerMcpTool(
    server,
    'traceFieldsGet',
    { 
      search: z.string().optional().describe('Filter fields by name pattern'),
      service: z.string().optional().describe('Filter to fields from a specific service. Use servicesGet tool to find available services'),
      services: z.array(z.string()).optional().describe('Filter to fields from multiple services (overrides service parameter). Use servicesGet tool to find available services'),
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
        logger.error('[MCP TOOL] traceFieldsSchema error', { 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
        
        // Return structured error response using ElasticGuards utility
        return ElasticGuards.formatErrorResponse(error, {
          search: args.search,
          service: args.service,
          services: args.services,
          includeSourceFields: args.includeSourceFields
        });
      }
    }
  );
}
