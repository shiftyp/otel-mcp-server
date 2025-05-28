import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { registerMcpTool } from '../../utils/registerTool.js';
import { LogFieldsTool } from './logFields.js';
import { ElasticGuards } from '../../utils/guards/index.js';
import { registerLogAnomaliesDetectTool } from './logAnomaliesDetect.js';
  
/**
 * Register log-related tools with the MCP server
 */
export function registerLogTools(server: McpServer, esAdapter: ElasticsearchAdapter) {
  const logFieldsTool = new LogFieldsTool(esAdapter);


  registerLogAnomaliesDetectTool(server, esAdapter)

  // Log fields schema with co-occurring fields
  registerMcpTool(
    server,
    'logFieldsGet',
    { 
      search: z.string().describe('Filter fields by name pattern. Pass an empty string to return all fields'),
      service: z.string().optional().describe('Filter to fields from a specific service. Use servicesGet tool to find available services'),
      services: z.array(z.string()).optional().describe('Filter to fields from multiple services (overrides service parameter). Use servicesGet tool to find available services'),
      useSourceDocument: z.boolean().optional().default(true).describe('Include source document fields in results')
    },
    async (args: { search?: string, service?: string, services?: string[], useSourceDocument?: boolean } = {}, extra: unknown) => {
      try {
        logger.info('[MCP TOOL] logFieldsSchema called', { args });
        
        // Determine which services to use
        let serviceFilter: string | string[] | undefined = undefined;
        if (args.services && args.services.length > 0) {
          serviceFilter = args.services;
        } else if (args.service) {
          serviceFilter = args.service;
        }
        
        // Get log fields, filtered by service if specified
        // Pass the parameters as-is, letting the implementation handle defaults
        const fields = await logFieldsTool.getLogFields(args.search, serviceFilter, args.useSourceDocument);
        
        // Format the output
        const result = {
          totalFields: fields.length,
          fields: fields.map(field => ({
            name: field.name,
            type: field.type,
            count: field.count,
            schema: field.schema,
            coOccurringFields: field.coOccurringFields || []
          }))
        };
        
        return { 
          content: [{ 
            type: 'text', 
            text: JSON.stringify(result, null, 2) 
          }] 
        };
      } catch (error) {
        logger.error('[MCP TOOL] logFieldsSchema error', { 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
        
        // Return structured error response using ElasticGuards utility
        return ElasticGuards.formatErrorResponse(error, {
          search: args.search,
          service: args.service,
          services: args.services,
          useSourceDocument: args.useSourceDocument
        });
      }
    }
  );

  // Register logs query tool for direct Elasticsearch access
  registerMcpTool(
    server,
    'logsQuery',
    { query: z.object({
      query: z.record(z.unknown()).optional().describe('Elasticsearch query object'),
      size: z.number().optional().describe('Maximum number of results to return'),
      from: z.number().optional().describe('Starting offset for pagination'),
      sort: z.any().optional().describe('Sort order for results'),
      aggs: z.record(z.unknown()).optional().describe('Aggregation definitions'),
      _source: z.union([z.array(z.string()), z.boolean()]).optional().default(true).describe('Fields to include in results'),
      search: z.string().optional().describe('Logical query string supporting Elasticsearch query syntax (AND, OR, NOT operators, field:value syntax, wildcards, ranges). NOTE: If provided, this overwrites any passed query object with a query_string query optimized for logs data. Examples: "error AND service.name:frontend", "@timestamp:[now-1h TO now] AND severity_text:ERROR", "resource.attributes.service.name:cart AND NOT timeout".'),
      agg: z.record(z.unknown()).optional().describe('Simplified aggregation definition'),
      runtime_mappings: z.record(z.unknown()).optional().describe('Dynamic field definitions'),
      script_fields: z.record(z.unknown()).optional().describe('Computed fields using scripts'),
      track_total_hits: z.union([z.boolean(), z.number()]).optional().describe('Controls how the total number of hits is tracked. Set to true for accurate counts, false for performance, or a number for a maximum count threshold.'),
      timeout: z.string().optional().describe('Timeout for the search request (e.g., "30s"). Prevents long-running queries.'),
      highlight: z.record(z.unknown()).optional().describe('Highlight configuration for search terms in results. Example: {"fields": {"body": {}}, "pre_tags": ["<em>"], "post_tags": ["</em>"]}.'),
      collapse: z.record(z.unknown()).optional().describe('Field collapsing configuration to remove duplicate results. Example: {"field": "service.name"}.'),
      search_after: z.array(z.unknown()).optional().describe('Efficient pagination through large result sets using values from a previous search.')
    }).strict().describe('Execute custom Elasticsearch query against log data') },
    async (args: { query?: any }) => {
      try {
        const resp = await esAdapter.queryLogs(args.query);
        const output: MCPToolOutput = { content: [{ type: 'text', text: JSON.stringify(resp) }] };
        logger.info('[MCP TOOL] logs result', { args, hits: resp.hits?.total?.value || 0 });
        return output;
      } catch (error) {
        logger.error('[MCP TOOL] logs query error', { 
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
}
