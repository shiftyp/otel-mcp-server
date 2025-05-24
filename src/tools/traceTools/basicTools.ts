import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';

/**
 * Register basic trace tools with the MCP server
 */
export function registerBasicTraceTools(server: McpServer, esAdapter: ElasticsearchAdapter) {
  // Analyze trace
  server.tool(
    'analyzeTrace',
    { traceId: z.string() },
    async (args, extra) => {
      try {
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
      } catch (error) {
        logger.error('[MCP TOOL] analyze-trace error', { error, traceId: args.traceId });
      }
    }
  );

  // Span lookup
  server.tool(
    'lookupSpan',
    { 'SpanId': z.string() },
    async (args, extra) => {
      try {
        // Check if trace data is available
        await ElasticGuards.checkTracesAvailability(esAdapter);
        
        const span = await esAdapter.spanLookup(args['SpanId']);
        const output: MCPToolOutput = { content: [{ type: 'text', text: span ? JSON.stringify(span, null, 2) : 'Span not found.' }] };
        logger.info('[MCP TOOL] span.lookup result', { args, output });
        return output;
      } catch (error) {
        logger.error('[MCP TOOL] span.lookup error', { error, spanId: args['SpanId'] });
        return ElasticGuards.formatErrorResponse(error);
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
      try {
        // Check if trace data is available
        await ElasticGuards.checkTracesAvailability(esAdapter);
        
        const resp = await esAdapter.queryTraces(args.query);
        const output: MCPToolOutput = { content: [{ type: 'text', text: JSON.stringify(resp) }] };
        logger.info('[MCP TOOL] traces result', { args, output });
        return output;
      } catch (error) {
        logger.error('[MCP TOOL] traces query error', { error });
        return ElasticGuards.formatErrorResponse(error);
      }
    }
  );
}
