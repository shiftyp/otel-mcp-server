import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../adapters/elasticsearch/index.js';
import { registerBasicTools } from './core/basicTools.js';
import { registerTraceTools } from './traces/traceTools.js';
import { registerMetricTools } from './metrics/metricTools.js';
import { registerLogTools } from './logs/logTools.js';
import { registerCommonTools } from './common/commonTools.js';
import { ElasticGuards, ElasticsearchDataError } from '../utils/guards/index.js';
import { logger } from '../utils/logger.js';
import { registerSystemHealthSummaryTool } from './traces/systemHealthSummary.js';

/**
 * Register all MCP tools with the server
 * @param server The MCP server instance
 * @param esAdapter The Elasticsearch adapter instance
 */
export async function registerAllTools(server: McpServer, esAdapter: ElasticsearchAdapter) {
  // Always register basic tools that don't depend on Elasticsearch
  registerBasicTools(server);
  
  // Register common tools that work across telemetry types
  registerCommonTools(server, esAdapter);
  
  // Check and register trace tools if trace data is available
  try {
    await ElasticGuards.checkTracesAvailability(esAdapter);
    logger.info('Trace data available in Elasticsearch, registering trace tools');
    registerTraceTools(server, esAdapter);
  } catch (error) {
    if (error instanceof ElasticsearchDataError) {
      logger.warn('Trace data not available in Elasticsearch, skipping trace tools registration', {
        reason: error.message
      });
    } else {
      logger.error('Error checking trace data availability', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
  
  // Check and register metric tools if metric data is available
  try {
    await ElasticGuards.checkMetricsAvailability(esAdapter);
    logger.info('Metric data available in Elasticsearch, registering metric tools');
    registerMetricTools(server, esAdapter);
  } catch (error) {
    if (error instanceof ElasticsearchDataError) {
      logger.warn('Metric data not available in Elasticsearch, skipping metric tools registration', {
        reason: error.message
      });
    } else {
      logger.error('Error checking metric data availability', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
  
  // Check and register log tools if log data is available
  try {
    await ElasticGuards.checkLogsAvailability(esAdapter);
    logger.info('Log data available in Elasticsearch, registering log tools');
    registerLogTools(server, esAdapter);
  } catch (error) {
    if (error instanceof ElasticsearchDataError) {
      logger.warn('Log data not available in Elasticsearch, skipping log tools registration', {
        reason: error.message
      });
    } else {
      logger.error('Error checking log data availability', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
  
  // Log information about removed tools
  logger.info('High-level tools have been removed in favor of direct query tools', {
    removedTools: [
      'visualization tools',
      'anomaly detection tools',
      'log anomaly detection tools'
    ]
  });
}
