import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../../adapters/elasticsearch/index.js';
import { OpenSearchAdapter } from '../../../adapters/opensearch/index.js';
import { registerServicesGetTool } from './servicesGet.js';
import { registerServiceArchitectureMapTool } from './serviceArchitectureMap.js';
import { registerServiceDependencyInfoTool } from './serviceDependencyInfo.js';

/**
 * Register all service-related tools
 * @param server The MCP server instance
 * @param searchAdapter The search adapter instance (ElasticsearchAdapter or OpenSearchAdapter)
 */
export function registerServiceTools(server: McpServer, searchAdapter: ElasticsearchAdapter | OpenSearchAdapter) {
  // Only register these tools if we have an ElasticsearchAdapter
  // In the future, we can implement OpenSearch versions of these tools
  if (searchAdapter instanceof ElasticsearchAdapter) {
    registerServicesGetTool(server, searchAdapter);
    registerServiceArchitectureMapTool(server, searchAdapter);
    registerServiceDependencyInfoTool(server, searchAdapter);
  }
}

// Export individual registration functions for selective imports
export { registerServicesGetTool } from './servicesGet.js';
export { registerServiceArchitectureMapTool } from './serviceArchitectureMap.js';
export { registerServiceDependencyInfoTool } from './serviceDependencyInfo.js';
