import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { ElasticGuards } from '../../utils/elasticGuards.js';
import { registerMcpTool } from '../../utils/registerTool.js';

/**
 * Register basic trace tools with the MCP server
 */
export function registerBasicTraceTools(server: McpServer, esAdapter: ElasticsearchAdapter) {
  // Analyze trace
  registerMcpTool(
    server,
    'traceAnalyze',
    { traceId: z.string().describe('Unique identifier of the trace to analyze') },
    async (args: { traceId: string }, extra: unknown) => {
      try {
        const analysis = await esAdapter.analyzeTrace(args.traceId);
        let result;
        if (typeof analysis === 'string') {
          // Handle the case where analysis is a string
          result = analysis;
        } else {
          result = JSON.stringify(analysis, null, 2);
        }
        const output: MCPToolOutput = { content: [{ type: 'text', text: result }] };
        logger.info('[MCP TOOL] analyze-trace result', { args, output });
        return output;
      } catch (error) {
        logger.error('[MCP TOOL] analyze-trace error', { error, traceId: args.traceId });
        return { content: [{ type: 'text', text: `Error analyzing trace: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    }
  );

  // Span lookup
  registerMcpTool(
    server,
    'spanGet',
    { spanId: z.string().describe('Unique identifier of the span to retrieve') },
    async (args: { spanId: string }, extra: unknown) => {
      try {
        const span = await esAdapter.spanLookup(args.spanId);
        const output: MCPToolOutput = { content: [{ type: 'text', text: span ? JSON.stringify(span, null, 2) : 'Span not found.' }] };
        logger.info('[MCP TOOL] span.lookup result', { args, output });
        return output;
      } catch (error) {
        logger.error('[MCP TOOL] span.lookup error', { error, spanId: args.spanId });
        return { content: [{ type: 'text', text: `Error looking up span: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    }
  );

  // Traces query
  registerMcpTool(
    server,
    'tracesQuery',
    { query: z.object({
      query: z.record(z.unknown()).optional().describe('Elasticsearch query object'),
      size: z.number().optional().describe('Maximum number of results to return'),
      from: z.number().optional().describe('Starting offset for pagination'),
      sort: z.any().optional().describe('Sort order for results'),
      aggs: z.record(z.unknown()).optional().describe('Aggregation definitions'),
      _source: z.union([z.array(z.string()), z.boolean()]).optional().describe('Fields to include in results'),
      search: z.string().optional().describe('Simple text search across fields'),
      agg: z.record(z.unknown()).optional().describe('Simplified aggregation definition'),
      runtime_mappings: z.record(z.unknown()).optional().describe('Dynamic field definitions'),
      script_fields: z.record(z.unknown()).optional().describe('Computed fields using scripts')
    }).strict().describe('Execute custom Elasticsearch query against trace data') },
    async (args: { query: any }, extra: unknown) => {
      try {
        const resp = await esAdapter.queryTraces(args.query);
        const output: MCPToolOutput = { content: [{ type: 'text', text: JSON.stringify(resp) }] };
        logger.info('[MCP TOOL] traces result', { args, output });
        return output;
      } catch (error) {
        logger.error('[MCP TOOL] traces query error', { error });
        return { content: [{ type: 'text', text: `Error querying traces: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    }
  );
}
