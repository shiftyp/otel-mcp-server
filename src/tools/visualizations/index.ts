import { logger } from '../../utils/logger.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { MarkdownVisualizationsTool } from './markdownVisualizations.js';

/**
 * Register all visualization tools with the MCP server
 */
export function registerVisualizationTools(server: McpServer, esAdapter: ElasticsearchAdapter) {
  logger.info('[Visualization Tools] Registering visualization tools');

  try {
    // Create and register the consolidated visualization tool
    const visualizationsTool = new MarkdownVisualizationsTool(esAdapter);
    visualizationsTool.register(server);
    
    logger.info('[Visualization Tools] Successfully registered consolidated visualization tools');
  } catch (error) {
    logger.error('[Visualization Tools] Error registering visualization tools', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}
