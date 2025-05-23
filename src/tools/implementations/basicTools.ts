import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Register basic utility tools with the MCP server
 */
export function registerBasicTools(server: McpServer) {
  // Echo tool
  server.tool(
    'echo',
    { message: z.string() },
    async (args, extra) => {
      const result: MCPToolOutput = { content: [{ type: 'text', text: args.message }] };
      logger.info('[MCP TOOL] echo result', { args, result });
      return result;
    }
  );

  // List tools
  server.tool(
    'listtools',
    { search: z.string().optional() },
    async (args: { search?: string } = {}) => {
      // Hardcode the list of registered tools instead of accessing private property
      const tools = [
        'echo',
        'analyzeTrace',
        'lookupSpan',
        'generateServiceDependencyGraph',
        'listTopErrors',
        'listServices',
        'generateSpanFlowchart',
        'queryTraces',
        'searchForTraceFields',
        'listtools',
        'searchLogs',
        'searchForLogFields',
        'queryLogs',
        'extractIncidentGraph',
        'generateMetricsRangeAggregation',
        'detectMetricAnomalies',
        'queryMetrics',
        'searchMetricsFields'
      ];
      const output: MCPToolOutput = { content: [{ type: 'text', text: JSON.stringify(tools) }] };
      logger.info('[MCP TOOL] listtools result', { args, output });
      return output;
    }
  );
}
