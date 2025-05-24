import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { ElasticGuards } from '../../utils/elasticGuards.js';

/**
 * Register basic trace tools with the MCP server
 */
export function registerBasicTraceTools(server: McpServer, esAdapter: ElasticsearchAdapter) {
  // Analyze trace
  server.tool(
    'analyzeTrace',
    { traceId: z.string().describe('The ID of the trace to analyze.') },
    async (args: { traceId: string }, extra) => {
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
  server.tool(
    'lookupSpan',
    { SpanId: z.string().describe('The ID of the span to look up.') },
    async (args: { SpanId: string }, extra) => {
      try {
        const span = await esAdapter.spanLookup(args.SpanId);
        const output: MCPToolOutput = { content: [{ type: 'text', text: span ? JSON.stringify(span, null, 2) : 'Span not found.' }] };
        logger.info('[MCP TOOL] span.lookup result', { args, output });
        return output;
      } catch (error) {
        logger.error('[MCP TOOL] span.lookup error', { error, spanId: args.SpanId });
        return { content: [{ type: 'text', text: `Error looking up span: ${error instanceof Error ? error.message : String(error)}` }] };
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
    async (args: { query: any }, extra) => {
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
