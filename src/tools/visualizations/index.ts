import { logger } from '../../utils/logger.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { ErrorPieChartTool } from './errorPieChart.js';
import { ServiceHealthChartTool } from './serviceHealthChart.js';
import { MarkdownDashboardTool } from './markdownDashboard.js';

/**
 * Register all visualization tools with the MCP server
 */
export function registerVisualizationTools(server: McpServer, esAdapter: ElasticsearchAdapter) {
  logger.info('[Visualization Tools] Registering visualization tools');

  try {
    // Create and register the dashboard tool (which also registers the individual tools)
    const dashboardTool = new MarkdownDashboardTool(esAdapter);
    dashboardTool.register(server);
    
    logger.info('[Visualization Tools] Successfully registered visualization tools');
  } catch (error) {
    logger.error('[Visualization Tools] Error registering visualization tools', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}
