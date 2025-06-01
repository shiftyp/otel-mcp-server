import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { MetricFieldsTool } from './metricFields.js';
import { registerMcpTool } from '../../utils/registerTool.js';
import { ElasticGuards } from '../../utils/guards/index.js';
import { registerMetricAnomaliesDetectTool } from './metricAnomaliesDetect.js';
import { registerTimeSeriesAnalysisTool } from './timeSeriesAnalysis.js';

/**
 * Register metrics-related tools with the MCP server
 */
export function registerMetricTools(server: McpServer, esAdapter: ElasticsearchAdapter) {
  // Register metric anomaly detection tool
  registerMetricAnomaliesDetectTool(server, esAdapter);
  
  // Register time series analysis tool
  registerTimeSeriesAnalysisTool(server, esAdapter);
  
  const metricFieldsTool = new MetricFieldsTool(esAdapter);

  // Search for metrics fields
  registerMcpTool(
    server,
    'metricsFieldsGet',
    { 
      search: z.string().describe('Search term to filter metric fields. Pass an empty string to return all fields'),
      service: z.string().optional().describe('Service name - Filter fields to only those present in data from this service. Use servicesGet tool to find available services'),
      services: z.array(z.string()).optional().describe('Services array - Filter fields to only those present in data from these services. Takes precedence over service parameter if both are provided. Use servicesGet tool to find available services'),
      useSourceDocument: z.boolean().optional().default(false).describe('Whether to include source document fields (default: false for metrics)')
    },
    async (args: { search?: string, service?: string, services?: string[], useSourceDocument?: boolean } = {}, _extra: unknown) => {
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
        logger.info('[MCP TOOL] About to call listMetricFields');
        const metricFields = await esAdapter.listMetricFields();
        
        // Log the raw metric fields returned from the adapter
        logger.info('[MCP TOOL] Raw metric fields from adapter', { 
          count: metricFields.length,
          fields: JSON.stringify(metricFields)
        });
        
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
        
        // Filter by service if provided - only apply filtering when serviceFilter is explicitly provided
        if (serviceFilter) {
          // Implement service filtering for metrics using exact term matching
          try {
            // Convert to array if string
            const services = Array.isArray(serviceFilter) ? serviceFilter : [serviceFilter];
            
            // Build a query to find documents matching the exact service names using term queries
            // This ensures exact matching without wildcards or partial matching
            const serviceQuery: Record<string, unknown> = {
              bool: {
                should: services.map(service => ({
                  term: { 'resource.attributes.service.name': service }
                })),
                minimum_should_match: 1
              }
            };
            
            // Query Elasticsearch to get a sample of documents from these services
            const response = await esAdapter.callEsRequest('POST', '/metrics*/_search', {
              size: 100,
              query: serviceQuery,
              _source: true
            });
            
            // If we got results, extract field names from the documents
            if (response.hits?.hits?.length > 0) {
              const fieldsInService = new Set<string>();
              
              // Extract field names from all returned documents
              for (const hit of response.hits.hits) {
                if (hit._source) {
                  // Helper type guard
                  const isRecord = (val: unknown): val is Record<string, unknown> => {
                    return typeof val === 'object' && val !== null && !Array.isArray(val);
                  };
                  // Recursively extract field names
                  const extractFields = (obj: Record<string, unknown>, prefix: string) => {
                    if (!obj || typeof obj !== 'object') return;
                    
                    for (const key in obj) {
                      const fullPath = prefix ? `${prefix}.${key}` : key;
                      fieldsInService.add(fullPath);
                      if (
                        obj[key] &&
                        typeof obj[key] === 'object' &&
                        !Array.isArray(obj[key]) &&
                        isRecord(obj[key])
                      ) {
                        extractFields(obj[key], fullPath);
                      }
                    }
                  };
                  
                  extractFields(hit._source, '');
                }
              }
              
              // Filter the fields to only include those found in the service documents
              filteredFields = filteredFields.filter(field => fieldsInService.has(field.name));
              
              logger.info('[MCP TOOL] Filtered metrics fields by service', { 
                serviceFilter, 
                originalCount: metricFields.length,
                filteredCount: filteredFields.length 
              });
            } else {
              // No documents found for the service(s), return empty array
              logger.warn('[MCP TOOL] No metrics found for the specified service(s)', { serviceFilter });
              filteredFields = [];
            }
          } catch (error) {
            logger.error('[MCP TOOL] Error filtering metrics fields by service', { 
              serviceFilter,
              error: error instanceof Error ? error.message : String(error)
            });
            // On error, continue with unfiltered fields
          }
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
      search: z.string().optional().describe('Logical query string supporting Elasticsearch query syntax (AND, OR, NOT operators, field:value syntax, wildcards, ranges). NOTE: If provided, this overwrites any passed query object with a query_string query optimized for metrics data. Examples: "resource.attributes.service.name:frontend AND metrics.*.value>100", "@timestamp:[now-1h TO now] AND name:*latency*", "service.name:(cart OR checkout) AND NOT attributes.unit:bytes".'),
      agg: z.record(z.unknown()).optional().describe('Simplified aggregation definition'),
      runtime_mappings: z.record(z.unknown()).optional().describe('Dynamic field definitions'),
      script_fields: z.record(z.unknown()).optional().describe('Computed fields using scripts'),
      track_total_hits: z.union([z.boolean(), z.number()]).optional().describe('Controls how the total number of hits is tracked. Set to true for accurate counts, false for performance, or a number for a maximum count threshold.'),
      timeout: z.string().optional().describe('Timeout for the search request (e.g., "30s"). Prevents long-running queries.'),
      highlight: z.record(z.unknown()).optional().describe('Highlight configuration for search terms in results. Example: {"fields": {"name": {}}, "pre_tags": ["<em>"], "post_tags": ["</em>"]}.'),
      collapse: z.record(z.unknown()).optional().describe('Field collapsing configuration to remove duplicate results. Example: {"field": "resource.attributes.service.name"}.'),
      search_after: z.array(z.unknown()).optional().describe('Efficient pagination through large result sets using values from a previous search.')
    }).strict().describe('Query OTEL metrics in Elasticsearch. Use the same query format as Elasticsearch. Run searchMetricsFields to get a list of available fields and their schemas.') },
    async (args: { query?: any }) => {
      try {
        logger.info('[MCP TOOL] queryMetrics called', { args });
        
        // Use the queryMetrics method from the metrics adapter
        // This ensures proper handling of search parameter and other advanced features
        const response = await esAdapter.queryMetrics(args.query || {});
        
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
