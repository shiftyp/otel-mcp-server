import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SearchEngineType } from '../adapters/base/searchAdapter.js';
import { ElasticsearchAdapter } from '../adapters/elasticsearch/index.js';
import { OpenSearchAdapter } from '../adapters/opensearch/index.js';
import { registerBasicTools } from './core/basicTools.js';
import { registerTraceTools } from './traces/traceTools.js';
import { registerMetricTools } from './metrics/metricTools.js';
import { registerLogTools } from './logs/logTools.js';
import { registerCommonTools } from './common/commonTools.js';
import { ElasticGuards, ElasticsearchDataError } from '../utils/guards/index.js';
import { logger } from '../utils/logger.js';
import { registerSystemHealthSummaryTool } from './traces/systemHealthSummary.js';
import { registerOpenSearchMlTools } from './opensearch/mlTools.js';
import { registerOpenSearchTraceTools } from './opensearch/traceTools.js';
import { registerOpenSearchLogTools } from './opensearch/logTools.js';
import { registerOpenSearchMetricTools } from './opensearch/metricTools.js';

/**
 * Register all MCP tools with the server
 * @param server The MCP server instance
 * @param searchAdapter The search adapter instance (ElasticsearchAdapter or OpenSearchAdapter)
 */
export async function registerAllTools(server: McpServer, searchAdapter: ElasticsearchAdapter | OpenSearchAdapter) {
  // Always register basic tools that don't depend on search engine
  registerBasicTools(server);
  
  // Register common tools that work across telemetry types
  registerCommonTools(server, searchAdapter);
  
  // Determine the search engine type
  const engineType = searchAdapter.getType();
  logger.info(`Registering tools for search engine type: ${engineType}`);
  
  // Check and register trace tools if trace data is available
  try {
    // Only check trace availability for ElasticsearchAdapter
    if (searchAdapter instanceof ElasticsearchAdapter) {
      await ElasticGuards.checkTracesAvailability(searchAdapter);
      logger.info(`Trace data available in ${engineType}, registering trace tools`);
      registerTraceTools(server, searchAdapter);
    } else {
      logger.info('OpenSearch trace tools not yet implemented');
    }
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
    // Only check metrics availability for ElasticsearchAdapter
    if (searchAdapter instanceof ElasticsearchAdapter) {
      await ElasticGuards.checkMetricsAvailability(searchAdapter);
      logger.info(`Metric data available in ${engineType}, registering metric tools`);
      registerMetricTools(server, searchAdapter);
    } else {
      logger.info('OpenSearch metric tools not yet implemented');
    }
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
    // Only check logs availability for ElasticsearchAdapter
    if (searchAdapter instanceof ElasticsearchAdapter) {
      await ElasticGuards.checkLogsAvailability(searchAdapter);
      logger.info(`Log data available in ${engineType}, registering log tools`);
      registerLogTools(server, searchAdapter);
    } else {
      logger.info('OpenSearch log tools not yet implemented');
    }
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
  
  // Register OpenSearch-specific ML tools if using OpenSearch
  if (engineType === SearchEngineType.OPENSEARCH && searchAdapter instanceof OpenSearchAdapter) {
    try {
      logger.info('Registering OpenSearch ML tools');
      // Register the Phase 1 ML tools
      registerPhase1MlTools(server, searchAdapter);
    } catch (error) {
      logger.error('Error registering OpenSearch ML tools', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  } else {
    logger.info('Not using OpenSearch, skipping ML tools registration');
  }
  
  // Log information about available tools
  logger.info('Tool registration complete', {
    engineType,
    mlToolsAvailable: engineType === SearchEngineType.OPENSEARCH && searchAdapter instanceof OpenSearchAdapter
  });
}

/**
 * Register Phase 1 ML tools for OpenSearch
 * @param server The MCP server instance
 * @param osAdapter The OpenSearch adapter instance
 */
function registerPhase1MlTools(server: McpServer, osAdapter: OpenSearchAdapter) {
  logger.info('Registering OpenSearch tools');
  
  try {
    // Register standard telemetry query tools
    registerOpenSearchTraceTools(server, osAdapter);
    registerOpenSearchLogTools(server, osAdapter);
    registerOpenSearchMetricTools(server, osAdapter);
    logger.info('Successfully registered OpenSearch telemetry query tools');
    
    // Register ML tools
    registerOpenSearchMlTools(server, osAdapter);
    logger.info('Successfully registered OpenSearch ML tools');
  } catch (error) {
    logger.error('Error registering OpenSearch tools', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}
