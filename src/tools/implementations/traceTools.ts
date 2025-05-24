import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { registerBasicTraceTools } from '../traceTools/basicTools.js';
import { registerTraceMetadataTools } from '../traceTools/metadataTools.js';

/**
 * Register trace-related tools with the MCP server
 */
export function registerTraceTools(server: McpServer, esAdapter: ElasticsearchAdapter) {

  // Register all trace tools
  registerBasicTraceTools(server, esAdapter);
  registerTraceMetadataTools(server, esAdapter);
}