import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../../adapters/elasticsearch/index.js';
import { registerServicesGetTool } from './servicesGet.js';
import { registerServiceArchitectureMapTool } from './serviceArchitectureMap.js';
import { registerServiceDependencyInfoTool } from './serviceDependencyInfo.js';

/**
 * Register all service-related tools
 * @param server The MCP server instance
 * @param esAdapter The Elasticsearch adapter instance
 */
export function registerServiceTools(server: McpServer, esAdapter: ElasticsearchAdapter) {
  registerServicesGetTool(server, esAdapter);
  registerServiceArchitectureMapTool(server, esAdapter);
  registerServiceDependencyInfoTool(server, esAdapter);
}

// Export individual registration functions for selective imports
export { registerServicesGetTool } from './servicesGet.js';
export { registerServiceArchitectureMapTool } from './serviceArchitectureMap.js';
export { registerServiceDependencyInfoTool } from './serviceDependencyInfo.js';
