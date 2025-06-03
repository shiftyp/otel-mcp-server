// server.ts
// Minimal MCP server using the official MCP SDK, supporting stdio and all SDK transports
// @ts-ignore  // MCP SDK does not provide types for this import
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// @ts-ignore  // MCP SDK does not provide types for this import
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { BaseSearchAdapter } from './adapters/base/searchAdapter.js';
import { AdapterFactory } from './adapters/factory.js';
import { ConfigLoader } from './config/index.js';
import { registerAllTools, globalToolRegistry } from './tools/index.js';
import { logger } from './utils/logger.js';

// Load configuration
const config = ConfigLoader.load();

// Log configuration source
if (process.env.OPENSEARCH_URL || process.env.ELASTICSEARCH_URL) {
  logger.info('Using environment variable configuration', {
    url: process.env.OPENSEARCH_URL || process.env.ELASTICSEARCH_URL,
    hasApiKey: !!process.env.API_KEY,
    hasCredentials: !!(process.env.USERNAME && process.env.PASSWORD)
  });
}

// Instantiate the MCP server
const server = new McpServer({
  name: process.env.SERVER_NAME || 'otel-mcp-server',
  version: '1.0.0',
});

// Will be initialized after detecting the search engine type
let searchAdapter: BaseSearchAdapter;

// Register all MCP tools with the server
// This will be called after search engine connection validation

async function detectAndConnectToSearchEngine() {
  try {
    logger.info('Attempting to detect search engine type', { 
      url: config.connection.baseURL,
      backend: config.backend 
    });
    
    // Create the appropriate adapter with configuration
    searchAdapter = await AdapterFactory.getInstance({
      backend: config.backend,
      baseURL: config.connection.baseURL || process.env.OPENSEARCH_URL || process.env.ELASTICSEARCH_URL || '',
      username: config.connection.username,
      password: config.connection.password,
      apiKey: config.connection.apiKey,
      timeout: config.connection.timeout,
      maxRetries: config.connection.maxRetries,
      retryDelay: config.connection.retryDelay
    });
    
    // Validate connection and get info
    const isHealthy = await searchAdapter.isHealthy();
    const versionInfo = await searchAdapter.getVersion();
    const adapterType = searchAdapter.getType();
    
    logger.info(`Successfully connected to ${adapterType}`, { 
      healthy: isHealthy,
      version: versionInfo.version,
      distribution: versionInfo.distribution 
    });
    
    // Check data availability
    try {
      const indices = await searchAdapter.getIndices();
      logger.info('Available indices:', {
        count: indices.length,
        patterns: {
          logs: indices.filter(i => i.includes('log')).length,
          metrics: indices.filter(i => i.includes('metric')).length,
          traces: indices.filter(i => i.includes('trace')).length
        }
      });
    } catch (err) {
      logger.warn('Could not list indices', { error: err instanceof Error ? err.message : String(err) });
    }
    
    return { 
      valid: isHealthy, 
      type: adapterType, 
      version: versionInfo.version 
    };
  } catch (err) {
    logger.error('Failed to connect to search engine', { 
      url: config.connection.baseURL,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined
    });
    return { valid: false, type: 'unknown', version: 'unknown' };
  }
}

/**
 * Log all registered tools and resources for debugging
 */
function validateAndLogToolsAndResources() {
  // @ts-ignore - getToolNames is available but not typed
  const toolNames = server.getToolNames ? server.getToolNames() : [];
  logger.info('Registered tools with MCP server:', { 
    count: toolNames.length,
    tools: toolNames 
  });

  // Log resources
  // @ts-ignore - getResources is available but not typed
  const resources = server.getResources ? server.getResources() : [];
  logger.info('Registered resources:', { resources });
  
  // Log tools by category from our registry
  const toolsByCategory = globalToolRegistry.getToolsByCategories();
  logger.info('Available tools by category:', {
    query: toolsByCategory.query.map(t => t.name),
    discovery: toolsByCategory.discovery.map(t => t.name),
    analysis: toolsByCategory.analysis.map(t => t.name),
    utility: toolsByCategory.utility.map(t => t.name)
  });
}

// Detect search engine type and validate connection before starting server
detectAndConnectToSearchEngine().then(async (connectionResult) => {
  if (!connectionResult.valid) {
    logger.error('Failed to validate search engine connection. Check your configuration.');
    process.exit(1);
  }
  
  logger.info(`Successfully connected to ${connectionResult.type} version ${connectionResult.version}`);
  
  // Register all MCP tools with the server after validating connection
  try {
    // Get adapter capabilities to show what features are available
    const capabilities = searchAdapter.getCapabilities();
    logger.info(`${connectionResult.type} adapter capabilities:`, {
      ml: capabilities.ml,
      search: capabilities.search,
      aggregations: capabilities.aggregations
    });
    
    // Register tools with the MCP server
    await registerAllTools(server, searchAdapter as any);
    
    // Get the actually registered tools
    const registeredTools = globalToolRegistry.createTools(searchAdapter);
    logger.info(`Successfully registered ${registeredTools.size} MCP tools for ${connectionResult.type}`, {
      tools: Array.from(registeredTools.keys())
    });
    
    // Log ML tool availability
    if (capabilities.ml.anomalyDetection || capabilities.ml.forecasting || capabilities.ml.clustering) {
      logger.info('ML capabilities available:', {
        anomalyDetection: capabilities.ml.anomalyDetection,
        forecasting: capabilities.ml.forecasting,
        patternAnalysis: capabilities.ml.patternAnalysis,
        clustering: capabilities.ml.clustering
      });
    }
  } catch (error) {
    logger.error('Error registering MCP tools', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
  
  // Add transports
  // @ts-ignore - addTransport is available but not typed
  server.connect(new StdioServerTransport());
  
  // Log registered tools and resources
  validateAndLogToolsAndResources();
  
  // @ts-ignore - name and version properties are available but not typed
  logger.info(`MCP server started with name: ${server.name}, version: ${server.version}`);
}).catch(err => {
  logger.error('Error during server startup:', { error: err });
  process.exit(1);
});
