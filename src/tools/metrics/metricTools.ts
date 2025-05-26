import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { MetricFieldsTool } from './metricFields.js';
import { registerMcpTool } from '../../utils/registerTool.js';
import { ElasticGuards } from '../../utils/elasticGuards.js';

/**
 * Register metrics-related tools with the MCP server
 */
export function registerMetricTools(server: McpServer, esAdapter: ElasticsearchAdapter) {
  // Anomaly detection tools have been removed
  const metricFieldsTool = new MetricFieldsTool(esAdapter);

  // Search for metrics fields
  registerMcpTool(
    server,
    'metricsFieldsGet',
    { 
      search: z.string().optional().describe('Search term to filter metric fields'),
      service: z.string().optional().describe('Service name - Filter fields to only those present in data from this service. Use servicesGet tool to find available services'),
      services: z.array(z.string()).optional().describe('Services array - Filter fields to only those present in data from these services. Takes precedence over service parameter if both are provided. Use servicesGet tool to find available services'),
      useSourceDocument: z.boolean().optional().default(false).describe('Whether to include source document fields (default: false for metrics)')
    },
    async (args: { search?: string, service?: string, services?: string[], useSourceDocument?: boolean }, _extra: unknown) => {
      try {
        logger.info('[MCP TOOL] searchMetricsFields called', { args });
        
        // Determine which services to use
        let serviceFilter: string | string[] | undefined = undefined;
        if (args.services && args.services.length > 0) {
          serviceFilter = args.services;
        } else if (args.service) {
          serviceFilter = args.service;
        }
        
        // Get actual field types from Elasticsearch using the MetricsAdapter
        const metricFields = await esAdapter.listMetricFields();
        
        // Create a map of field names to their types
        const fieldTypeMap = new Map<string, string>();
        metricFields.forEach(field => {
          fieldTypeMap.set(field.name, field.type);
        });
        
        // Log the field types for debugging
        logger.debug('[MCP TOOL] searchMetricsFields field types', { 
          fieldCount: metricFields.length,
          sampleFields: metricFields.slice(0, 5)
        });
        
        // Filter fields by search term if provided
        let filteredFields = metricFields;
        if (args.search) {
          const searchLower = args.search.toLowerCase();
          filteredFields = metricFields.filter(field => 
            field.name.toLowerCase().includes(searchLower)
          );
        }
        
        // Filter by service if provided
        if (serviceFilter) {
          // TODO: Implement service filtering for metrics
          // This would require additional queries to find which fields exist in data from the specified service(s)
          logger.warn('[MCP TOOL] Service filtering for metrics not yet implemented', { serviceFilter });
        }
        
        // Sort fields by name
        filteredFields.sort((a, b) => a.name.localeCompare(b.name));
        
        // Format the output
        const result = {
          totalFields: filteredFields.length,
          fields: filteredFields.map(field => ({
            name: field.name,
            type: field.type,
            count: (field as any).count || 0,
            schema: (field as any).schema || {}
          }))
        };
        
        return { 
          content: [{ 
            type: 'text', 
            text: JSON.stringify(result, null, 2) 
          }] 
        };
      } catch (error) {
        logger.error('[MCP TOOL] searchMetricsFields error', { 
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

  // Metrics query
  registerMcpTool(
    server,
    'metricsQuery',
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
    }).strict().describe('Query OTEL metrics in Elasticsearch. Use the same query format as Elasticsearch. Run searchMetricsFields to get a list of available fields and their schemas.') },
    async (args: { query?: any }) => {
      try {
        logger.info('[MCP TOOL] queryMetrics called', { args });
        
        // Construct the Elasticsearch query
        const query = args.query || {};
        const indexPattern = '.ds-metrics-*';
        
        // Execute the query
        const response = await esAdapter.callEsRequest('POST', `/${indexPattern}/_search`, query);
        
        const output: MCPToolOutput = { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
        logger.info('[MCP TOOL] queryMetrics result', { hits: response.hits?.total?.value || 0 });
        return output;
      } catch (error) {
        logger.error('[MCP TOOL] queryMetrics error', { 
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
