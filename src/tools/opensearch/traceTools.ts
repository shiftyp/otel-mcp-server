/**
 * OpenSearch trace tools
 * These tools provide functionality for querying and analyzing traces in OpenSearch
 */

import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenSearchAdapter } from '../../adapters/opensearch/index.js';
import { registerMcpTool } from '../../utils/registerTool.js';
import { createDynamicDescription } from '../../utils/dynamicDescriptions.js';

/**
 * Register trace-related tools with the MCP server for OpenSearch
 */
export function registerOpenSearchTraceTools(server: McpServer, osAdapter: OpenSearchAdapter): void {
  logger.info('Registering OpenSearch trace tools');

  // Direct trace query tool
  registerMcpTool(
    server,
    'tracesQuery',
    { query: z.object({
      query: z.record(z.unknown()).optional().describe('OpenSearch query object'),
      size: z.number().optional().describe('Maximum number of results to return'),
      from: z.number().optional().describe('Starting offset for pagination'),
      sort: z.any().optional().describe('Sort order for results'),
      aggs: z.record(z.unknown()).optional().describe('Aggregation definitions'),
      _source: z.union([z.array(z.string()), z.boolean()]).optional().default(true).describe('Fields to include in results'),
      search: z.string().optional().describe('Logical query string supporting OpenSearch query syntax (AND, OR, NOT operators, field:value syntax, wildcards, ranges). NOTE: If provided, this overwrites any passed query object with a query_string query optimized for traces data. Examples: "error AND service.name:frontend", "@timestamp:[now-1h TO now] AND http.status_code:500", "trace_id:389ef43211b010c0cea89ce7b424e71d OR span.kind:SERVER".'),
      agg: z.record(z.unknown()).optional().describe('Simplified aggregation definition'),
      runtime_mappings: z.record(z.unknown()).optional().describe('Dynamic field definitions'),
      script_fields: z.record(z.unknown()).optional().describe('Computed fields using scripts'),
      track_total_hits: z.union([z.boolean(), z.number()]).optional().describe('Controls how the total number of hits is tracked. Set to true for accurate counts, false for performance, or a number for a maximum count threshold.'),
      timeout: z.string().optional().describe('Timeout for the search request (e.g., "30s"). Prevents long-running queries.'),
      highlight: z.record(z.unknown()).optional().describe('Highlight configuration for search terms in results. Example: {"fields": {"span.name": {}}, "pre_tags": ["<em>"], "post_tags": ["</em>"]}.'),
      collapse: z.record(z.unknown()).optional().describe('Field collapsing configuration to remove duplicate results. Example: {"field": "service.name"}.'),
      search_after: z.array(z.unknown()).optional().describe('Efficient pagination through large result sets using values from a previous search.')
    }).strict().describe('Execute custom OpenSearch query against trace data') },
    async (args: { query: any }) => {
      try {
        const resp = await osAdapter.tracesAdapter.queryTraces(args.query);
        const output: MCPToolOutput = { 
          content: [
            { type: 'text', text: JSON.stringify(resp) }
          ]
        };
        logger.info('[MCP TOOL] traces result', { args, hits: resp.hits?.total?.value || 0 });
        return output;
      } catch (error) {
        logger.error('[MCP TOOL] traces query error', { 
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
                tool: 'tracesQuery',
                args
              }
            })
          }]
        };
      }
    }
  );

  // Trace analyze tool
  registerMcpTool(
    server,
    'traceAnalyze',
    {
      traceId: z.string().describe('Trace ID to analyze'),
      includeSpans: z.boolean().optional().default(true).describe('Include spans in the result'),
      includeTimeline: z.boolean().optional().default(true).describe('Generate a timeline visualization'),
      includeCriticalPath: z.boolean().optional().default(true).describe('Identify the critical path in the trace')
    },
    async (args: { traceId: string, includeSpans?: boolean, includeTimeline?: boolean, includeCriticalPath?: boolean }) => {
      try {
        logger.info('[MCP TOOL] traceAnalyze called', { args });
        
        const traceData = await osAdapter.tracesAdapter.getTrace(args.traceId);
        
        if (!traceData || !traceData.spans || traceData.spans.length === 0) {
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: `No trace found with ID: ${args.traceId}`,
                details: {
                  tool: 'traceAnalyze',
                  args
                }
              })
            }]
          };
        }
        
        // Process the trace data
        const spanCount = traceData.spans.length;
        const rootSpan = traceData.spans.find((span: any) => !span.parentSpanId);
        const serviceName = rootSpan?.serviceName || 'unknown';
        const duration = traceData.duration || 0;
        
        // Generate timeline visualization if requested
        let timelineViz;
        if (args.includeTimeline) {
          timelineViz = await osAdapter.tracesAdapter.generateTraceTimeline(traceData);
        }
        
        // Identify critical path if requested
        let criticalPath;
        if (args.includeCriticalPath) {
          criticalPath = await osAdapter.tracesAdapter.identifyCriticalPath(traceData);
        }
        
        // Prepare the response
        const result: any = {
          traceId: args.traceId,
          serviceName,
          spanCount,
          duration,
          timestamp: traceData.timestamp,
          status: traceData.error ? 'ERROR' : 'SUCCESS'
        };
        
        if (args.includeSpans) {
          result.spans = traceData.spans;
        }
        
        if (timelineViz) {
          result.timeline = timelineViz;
        }
        
        if (criticalPath) {
          result.criticalPath = criticalPath;
        }
        
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify(result)
          }]
        };
      } catch (error) {
        logger.error('[MCP TOOL] traceAnalyze error', { 
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
                tool: 'traceAnalyze',
                args
              }
            })
          }]
        };
      }
    }
  );

  // Span get tool
  registerMcpTool(
    server,
    'spanGet',
    {
      spanId: z.string().describe('Span ID to retrieve'),
      includeTrace: z.boolean().optional().default(false).describe('Include the full trace containing this span')
    },
    async (args: { spanId: string, includeTrace?: boolean }) => {
      try {
        logger.info('[MCP TOOL] spanGet called', { args });
        
        const span = await osAdapter.tracesAdapter.getSpan(args.spanId);
        
        if (!span) {
          return {
            content: [{ type: 'text', text: `No span found with ID: ${args.spanId}` }],
            isError: true
          };
        }
        
        let result: any = { span };
        
        // Include the full trace if requested
        if (args.includeTrace && span.traceId) {
          const traceData = await osAdapter.tracesAdapter.getTrace(span.traceId);
          if (traceData) {
            result.trace = traceData;
          }
        }
        
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify(result)
          }]
        };
      } catch (error) {
        logger.error('[MCP TOOL] spanGet error', { 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          args
        });
        return {
          content: [{ type: 'text', text: `Error retrieving span: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true
        };
      }
    }
  );

  // Trace fields get tool
  registerMcpTool(
    server,
    'traceFieldsGet',
    {
      search: z.string().describe('Filter fields by name pattern. Pass an empty string to return all fields'),
      service: z.string().optional().describe('Filter to fields from a specific service'),
      services: z.array(z.string()).optional().describe('Filter to fields from multiple services (overrides service parameter)')
    },
    async (args: { search: string, service?: string, services?: string[] }) => {
      try {
        logger.info('[MCP TOOL] traceFieldsGet called', { args });
        
        // Determine which services to use
        let serviceFilter: string | string[] | undefined = undefined;
        if (args.services && args.services.length > 0) {
          serviceFilter = args.services;
        } else if (args.service) {
          serviceFilter = args.service;
        }
        
        // Get trace fields
        const fields = await osAdapter.tracesAdapter.getTraceFields(args.search, serviceFilter);
        
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify({
            totalFields: fields.length,
            fields
          })}]
        };
      } catch (error) {
        logger.error('[MCP TOOL] traceFieldsGet error', { 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          args
        });
        return {
          content: [{ type: 'text', text: `Error retrieving trace fields: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true
        };
      }
    }
  );
}
