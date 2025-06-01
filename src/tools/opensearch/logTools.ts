/**
 * OpenSearch log tools
 * These tools provide functionality for querying and analyzing logs in OpenSearch
 */

import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenSearchAdapter } from '../../adapters/opensearch/index.js';
import { registerMcpTool } from '../../utils/registerTool.js';
import { createDynamicDescription } from '../../utils/dynamicDescriptions.js';

/**
 * Register log-related tools with the MCP server for OpenSearch
 */
export function registerOpenSearchLogTools(server: McpServer, osAdapter: OpenSearchAdapter): void {
  logger.info('Registering OpenSearch log tools');

  // Log fields get tool
  registerMcpTool(
    server,
    'logFieldsGet',
    { 
      search: z.string().describe('Filter fields by name pattern. Pass an empty string to return all fields'),
      service: z.string().optional().describe('Filter to fields from a specific service. Use servicesGet tool to find available services'),
      services: z.array(z.string()).optional().describe('Filter to fields from multiple services (overrides service parameter). Use servicesGet tool to find available services'),
      useSourceDocument: z.boolean().optional().default(true).describe('Include source document fields in results')
    },
    async (args: { search: string, service?: string, services?: string[], useSourceDocument?: boolean }) => {
      try {
        logger.info('[MCP TOOL] logFieldsGet called', { args });
        
        // Use a direct query to get a sample log document
        const sampleQuery = {
          size: 1,
          query: { match_all: {} }
        };
        
        logger.info('[OpenSearch logFieldsGet] Executing direct sample query');
        const result = await osAdapter.callRequest('POST', 'logs-generic-default/_search', sampleQuery);
        
        logger.info(`[OpenSearch logFieldsGet] Query result: ${JSON.stringify(result).substring(0, 200)}...`);
        
        if (!result || !result.hits || !result.hits.hits || result.hits.hits.length === 0) {
          logger.error('[OpenSearch logFieldsGet] No sample document found');
          return { text: JSON.stringify({ totalFields: 0, fields: [] }) };
        }
        
        // Extract fields from the sample document
        const sampleDoc = result.hits.hits[0]._source;
        logger.info(`[OpenSearch logFieldsGet] Found sample document with keys: ${Object.keys(sampleDoc).join(', ')}`);
        
        // Extract fields recursively
        const fields = extractFieldsFromDocument(sampleDoc, args.search);
        logger.info(`[OpenSearch logFieldsGet] Extracted ${fields.length} fields from sample document`);
        
        return {
          content: [{ type: 'text',
             text: JSON.stringify({ totalFields: fields.length, fields }) 
          }]
        };
      } catch (error) {
        logger.error(`[OpenSearch logFieldsGet] Error: ${error}`);
        return {
          content: [{ type: 'text',
             text: JSON.stringify({ error: `Error getting log fields: ${error}` }) 
          }]
        };
      }
    }
  );

  // Logs query tool
  registerMcpTool(
    server,
    'logsQuery',
    { query: z.object({
      query: z.record(z.unknown()).optional().describe('OpenSearch query object'),
      size: z.number().optional().describe('Maximum number of results to return'),
      from: z.number().optional().describe('Starting offset for pagination'),
      sort: z.any().optional().describe('Sort order for results'),
      aggs: z.record(z.unknown()).optional().describe('Aggregation definitions'),
      _source: z.union([z.array(z.string()), z.boolean()]).optional().default(true).describe('Fields to include in results'),
      search: z.string().optional().describe('Logical query string supporting OpenSearch query syntax (AND, OR, NOT operators, field:value syntax, wildcards, ranges). NOTE: If provided, this overwrites any passed query object with a query_string query optimized for logs data.'),
      agg: z.record(z.unknown()).optional().describe('Simplified aggregation definition'),
      runtime_mappings: z.record(z.unknown()).optional().describe('Dynamic field definitions'),
      script_fields: z.record(z.unknown()).optional().describe('Computed fields using scripts'),
      track_total_hits: z.union([z.boolean(), z.number()]).optional().describe('Controls how the total number of hits is tracked'),
      timeout: z.string().optional().describe('Timeout for the search request (e.g., "30s")'),
      highlight: z.record(z.unknown()).optional().describe('Highlight configuration for search terms in results'),
      collapse: z.record(z.unknown()).optional().describe('Field collapsing configuration to remove duplicate results'),
      search_after: z.array(z.unknown()).optional().describe('Efficient pagination through large result sets using values from a previous search')
    }).strict().describe('Execute custom OpenSearch query against log data') },
    async (args: { query: any }) => {
      try {
        const resp = await osAdapter.logsAdapter.queryLogs(args.query);
        const output: MCPToolOutput = { 
          content: [
            { type: 'text', text: JSON.stringify(resp) }
          ]
        };
        logger.info('[MCP TOOL] logs result', { args, hits: resp.hits?.total?.value || 0 });
        return output;
      } catch (error) {
        logger.error('[MCP TOOL] logs query error', { 
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
                tool: 'logsQuery',
                args
              }
            })
          }]
        };
      }
    }
  );

  // Find logs tool
  registerMcpTool(
    server,
    'findLogs',
    {
      query: z.string().describe('Query string to search for logs'),
      startTime: z.string().optional().describe('Start time in ISO format (e.g., "2023-01-01T00:00:00Z") or relative time (e.g., "now-1h")'),
      endTime: z.string().optional().describe('End time in ISO format (e.g., "2023-01-01T01:00:00Z") or relative time (e.g., "now")'),
      service: z.string().optional().describe('Filter to logs from a specific service'),
      size: z.number().optional().default(100).describe('Maximum number of logs to return'),
      includeTraces: z.boolean().optional().default(false).describe('Include trace information if available'),
      fields: z.array(z.string()).optional().describe('Fields to include in the results'),
      sort: z.enum(['asc', 'desc']).optional().default('desc').describe('Sort direction by timestamp')
    },
    async (args: { 
      query: string, 
      startTime?: string, 
      endTime?: string, 
      service?: string, 
      size?: number, 
      includeTraces?: boolean,
      fields?: string[],
      sort?: 'asc' | 'desc'
    }) => {
      try {
        logger.info('[MCP TOOL] findLogs called', { args });
        
        // Build the search parameters
        const searchParams: any = {
          query: args.query,
          size: args.size || 100,
          sort: args.sort || 'desc'
        };
        
        if (args.startTime) {
          searchParams.startTime = args.startTime;
        }
        
        if (args.endTime) {
          searchParams.endTime = args.endTime;
        }
        
        if (args.service) {
          searchParams.service = args.service;
        }
        
        if (args.fields) {
          searchParams.fields = args.fields;
        }
        
        if (args.includeTraces) {
          searchParams.includeTraces = true;
        }
        
        // Execute the search
        const logs = await osAdapter.logsAdapter.findLogs(searchParams);
        
        // Format the response
        const timeRange = `${args.startTime || 'earliest'} to ${args.endTime || 'latest'}`;
        
        return {
          content: [
            { type: 'text', text: JSON.stringify(logs) }
          ]
        };
      } catch (error) {
        logger.error('[MCP TOOL] findLogs error', { 
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
                tool: 'findLogs',
                args
              }
            })
          }]
        };
      }
    }
  );
  
  // Helper function to extract fields from a document recursively
  function extractFieldsFromDocument(doc: any, search?: string, prefix = ''): any[] {
    const fields: any[] = [];
    
    if (!doc || typeof doc !== 'object') {
      return fields;
    }
    
    Object.keys(doc).forEach(key => {
      const value = doc[key];
      const fieldName = prefix ? `${prefix}.${key}` : key;
      
      // Determine field type
      let fieldType = 'unknown';
      if (value === null) {
        fieldType = 'null';
      } else if (typeof value === 'string') {
        fieldType = 'text';
      } else if (typeof value === 'number') {
        fieldType = Number.isInteger(value) ? 'long' : 'double';
      } else if (typeof value === 'boolean') {
        fieldType = 'boolean';
      } else if (Array.isArray(value)) {
        fieldType = 'array';
      } else if (typeof value === 'object') {
        fieldType = 'object';
      }
      
      // Add field to the list
      fields.push({
        name: fieldName,
        type: fieldType
      });
      
      // Process nested fields recursively
      if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
          // For arrays of objects, process the first item
          fields.push(...extractFieldsFromDocument(value[0], search, fieldName));
        } else if (!Array.isArray(value)) {
          // For regular objects
          fields.push(...extractFieldsFromDocument(value, search, fieldName));
        }
      }
    });
    
    // Filter fields if search is provided
    if (search) {
      const searchLower = search.toLowerCase();
      return fields.filter(field => field.name.toLowerCase().includes(searchLower));
    }
    
    return fields;
  }
}
