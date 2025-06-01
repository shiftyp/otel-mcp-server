import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { OpenSearchAdapter } from '../../adapters/opensearch/index.js';
import { registerServiceTools } from './services/index.js';

/**
 * Register common tools that work across different telemetry types
 * @param server The MCP server instance
 * @param searchAdapter The search adapter instance (ElasticsearchAdapter or OpenSearchAdapter)
 */
export function registerCommonTools(server: McpServer, searchAdapter: ElasticsearchAdapter | OpenSearchAdapter) {
  // Register service-related tools
  registerServiceTools(server, searchAdapter);
  
  // Additional tool categories can be registered here as they are implemented
  // registerMetricsTools(server, searchAdapter);
  // registerLogsTools(server, searchAdapter);
  // etc.
}
