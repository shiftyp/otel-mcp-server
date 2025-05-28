import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { registerServiceTools } from './services/index.js';

/**
 * Register common tools that work across different telemetry types
 * @param server The MCP server instance
 * @param esAdapter The Elasticsearch adapter instance
 */
export function registerCommonTools(server: McpServer, esAdapter: ElasticsearchAdapter) {
  // Register service-related tools
  registerServiceTools(server, esAdapter);
  
  // Additional tool categories can be registered here as they are implemented
  // registerMetricsTools(server, esAdapter);
  // registerLogsTools(server, esAdapter);
  // etc.
}
