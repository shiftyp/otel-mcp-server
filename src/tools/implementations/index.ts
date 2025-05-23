import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { registerBasicTools } from './basicTools.js';
import { registerTraceTools } from './traceTools.js';
import { registerMetricTools } from './metricTools.js';
import { registerLogTools } from './logTools.js';

/**
 * Register all MCP tools with the server
 * @param server The MCP server instance
 * @param esAdapter The Elasticsearch adapter instance
 */
export function registerAllTools(server: McpServer, esAdapter: ElasticsearchAdapter) {
  // Register all tool categories
  registerBasicTools(server);
  registerTraceTools(server, esAdapter);
  registerMetricTools(server, esAdapter);
  registerLogTools(server, esAdapter);
}
