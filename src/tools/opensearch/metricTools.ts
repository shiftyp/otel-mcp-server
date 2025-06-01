/**
 * OpenSearch metric tools
 * These tools provide functionality for querying and analyzing metrics in OpenSearch
 */

import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenSearchAdapter } from '../../adapters/opensearch/index.js';
import { registerMcpTool } from '../../utils/registerTool.js';
import { createDynamicDescription } from '../../utils/dynamicDescriptions.js';

/**
 * Register metric-related tools with the MCP server for OpenSearch
 */
export function registerOpenSearchMetricTools(server: McpServer, osAdapter: OpenSearchAdapter): void {
  logger.info('Registering OpenSearch metric tools');

  // Metrics fields get tool
  registerMcpTool(
    server,
    'metricsFieldsGet',
    { 
      search: z.string().describe('Search term to filter metric fields. Pass an empty string to return all fields'),
      service: z.string().optional().describe('Service name - Filter fields to only those present in data from this service'),
      services: z.array(z.string()).optional().describe('Services array - Filter fields to only those present in data from these services. Takes precedence over service parameter if both are provided'),
      useSourceDocument: z.boolean().optional().default(false).describe('Whether to include source document fields (default: false for metrics)')
    },
    async (args: { search: string, service?: string, services?: string[], useSourceDocument?: boolean }) => {
      try {
        logger.info('[MCP TOOL] metricsFieldsGet called', { args });
        
        // Determine which services to use
        let serviceFilter: string | string[] | undefined = undefined;
        if (args.services && args.services.length > 0) {
          serviceFilter = args.services;
        } else if (args.service) {
          serviceFilter = args.service;
        }
        
        // Get metric fields
        const fields = await osAdapter.metricsAdapter.getMetricFields(
          args.search, 
          serviceFilter, 
          args.useSourceDocument === true
        );
        
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify({
              totalFields: fields.length,
              fields
            })
          }]
        };
      } catch (error) {
        logger.error('[MCP TOOL] metricsFieldsGet error', { 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          args
        });
        return {
          content: [{ type: 'text', text: `Error retrieving metric fields: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true
        };
      }
    }
  );

  // Metrics query tool
  registerMcpTool(
    server,
    'metricsQuery',
    { query: z.object({
      query: z.record(z.unknown()).optional().describe('OpenSearch query object'),
      size: z.number().optional().describe('Maximum number of results to return'),
      from: z.number().optional().describe('Starting offset for pagination'),
      sort: z.any().optional().describe('Sort order for results'),
      aggs: z.record(z.unknown()).optional().describe('Aggregation definitions'),
      _source: z.union([z.array(z.string()), z.boolean()]).optional().default(true).describe('Fields to include in results'),
      search: z.string().optional().describe('Logical query string supporting OpenSearch query syntax'),
      agg: z.record(z.unknown()).optional().describe('Simplified aggregation definition'),
      runtime_mappings: z.record(z.unknown()).optional().describe('Dynamic field definitions'),
      script_fields: z.record(z.unknown()).optional().describe('Computed fields using scripts'),
      track_total_hits: z.union([z.boolean(), z.number()]).optional().describe('Controls how the total number of hits is tracked'),
      timeout: z.string().optional().describe('Timeout for the search request (e.g., "30s")'),
      highlight: z.record(z.unknown()).optional().describe('Highlight configuration for search terms in results'),
      collapse: z.record(z.unknown()).optional().describe('Field collapsing configuration to remove duplicate results'),
      search_after: z.array(z.unknown()).optional().describe('Efficient pagination through large result sets using values from a previous search')
    }).strict().describe('Execute custom OpenSearch query against metric data') },
    async (args: { query: any }) => {
      try {
        const resp = await osAdapter.metricsAdapter.queryMetrics(args.query);
        const output: MCPToolOutput = { 
          content: [
            { type: 'text', text: JSON.stringify(resp) }
          ]
        };
        logger.info('[MCP TOOL] metrics result', { args, hits: resp.hits?.total?.value || 0 });
        return output;
      } catch (error) {
        logger.error('[MCP TOOL] metrics query error', { 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          args
        });
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
              details: {
                tool: 'metricsQuery',
                args
              }
            })
          }]
        };
      }
    }
  );

  // Search metrics tool
  registerMcpTool(
    server,
    'searchMetrics',
    {
      metricField: z.string().describe('Metric field to search for (supports dot notation for nested fields, e.g. system.cpu.usage)'),
      startTime: z.string().describe('Start time in ISO format (e.g., "2023-01-01T00:00:00Z") or relative time (e.g., "now-1h")'),
      endTime: z.string().describe('End time in ISO format (e.g., "2023-01-01T01:00:00Z") or relative time (e.g., "now")'),
      service: z.string().optional().describe('Filter to metrics from a specific service'),
      interval: z.string().optional().default('auto').describe('Time interval for aggregating metrics (e.g., "1m", "5m", "1h")'),
      aggregation: z.enum(['avg', 'min', 'max', 'sum', 'count', 'histogram']).optional().default('avg').describe('Aggregation function to apply to the metric values'),
      includeRaw: z.boolean().optional().default(false).describe('Include raw metric values in addition to aggregated values')
    },
    async (args: { 
      metricField: string, 
      startTime: string, 
      endTime: string, 
      service?: string, 
      interval?: string, 
      aggregation?: 'avg' | 'min' | 'max' | 'sum' | 'count' | 'histogram',
      includeRaw?: boolean
    }) => {
      try {
        logger.info('[MCP TOOL] searchMetrics called', { args });
        
        // Parse the dot-delimited metric field into components
        const metricFieldParts = args.metricField.split('.');
        const metricName = metricFieldParts[metricFieldParts.length - 1];
        const metricNamespace = metricFieldParts.slice(0, -1).join('.');
        
        // Build the search parameters
        const searchParams: any = {
          metricField: args.metricField,
          metricName,
          metricNamespace: metricNamespace || undefined,
          startTime: args.startTime,
          endTime: args.endTime,
          interval: args.interval || 'auto',
          aggregation: args.aggregation || 'avg'
        };
        
        if (args.service) {
          searchParams.service = args.service;
        }
        
        if (args.includeRaw) {
          searchParams.includeRaw = true;
        }
        
        // Execute the search
        const metrics = await osAdapter.metricsAdapter.searchMetrics(searchParams);
        
        // Format the response
        const timeRange = `${args.startTime} to ${args.endTime}`;
        const aggType = args.aggregation || 'avg';
        
        return {
          content: [
            { type: 'text', text: JSON.stringify(metrics) }
          ]
        };
      } catch (error) {
        logger.error('[MCP TOOL] searchMetrics error', { 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          args
        });
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
              details: {
                tool: 'searchMetrics',
                args
              }
            })
          }]
        };
      }
    }
  );
}
