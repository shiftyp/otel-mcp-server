// server.ts
// Minimal MCP server using the official MCP SDK, supporting stdio and all SDK transports
// @ts-ignore  // MCP SDK does not provide types for this import
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// @ts-ignore  // MCP SDK does not provide types for this import
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { ElasticsearchAdapter } from './adapters/elasticsearch/index.js';
import { OpenSearchAdapter } from './adapters/opensearch/index.js';
import { BaseSearchAdapter } from './adapters/base/searchAdapter.js';
import { SearchAdapterFactory } from './adapters/factory.js';
import { registerAllTools } from './tools/index.js';
import { logger } from './utils/logger.js';

// Instantiate the MCP server
const SEARCH_ENGINE_URL = process.env.ELASTICSEARCH_URL || '';
const SEARCH_ENGINE_USERNAME = process.env.ELASTICSEARCH_USERNAME || '';
const SEARCH_ENGINE_PASSWORD = process.env.ELASTICSEARCH_PASSWORD || '';
const SEARCH_ENGINE_API_KEY = process.env.ELASTICSEARCH_API_KEY || '';
const USE_COMPATIBILITY_MODE = process.env.USE_COMPATIBILITY_MODE === 'true';

const server = new McpServer({
  name: process.env.SERVER_NAME || 'otel-mcp-server',
  version: '1.0.0',
});

// Will be initialized after detecting the search engine type
let searchAdapter: ElasticsearchAdapter | OpenSearchAdapter;

// Register all MCP tools with the server
// This will be called after search engine connection validation

async function detectAndConnectToSearchEngine() {
  try {
    logger.info('Attempting to detect search engine type', { url: SEARCH_ENGINE_URL });
    
    // Detect the search engine type
    const { type, version } = await SearchAdapterFactory.detectSearchEngineType(SEARCH_ENGINE_URL);
    logger.info('Detected search engine', { type, version });
    
    // Create the appropriate adapter
    searchAdapter = SearchAdapterFactory.createAdapter({
      type,
      baseURL: SEARCH_ENGINE_URL,
      username: SEARCH_ENGINE_USERNAME,
      password: SEARCH_ENGINE_PASSWORD,
      apiKey: SEARCH_ENGINE_API_KEY,
      timeout: 30000,
      maxRetries: 3,
      retryDelay: 1000,
      useCompatibilityMode: USE_COMPATIBILITY_MODE
    });
    
    // Validate connection
    const indices = await searchAdapter.getIndices();
    logger.info(`Successfully retrieved indices from ${type}`, { count: indices.length });
    return { valid: indices.length > 0, type, version };
  } catch (err) {
    logger.error('Failed to connect to search engine', { 
      url: SEARCH_ENGINE_URL,
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
  logger.info('Registered tools:', { toolNames });

  // Log resources
  // @ts-ignore - getResources is available but not typed
  const resources = server.getResources ? server.getResources() : [];
  logger.info('Registered resources:', { resources });
}

// Detect search engine type and validate connection before starting server
detectAndConnectToSearchEngine().then(async ({ valid, type, version }) => {
  if (!valid) {
    logger.error('Failed to validate search engine connection. Check your configuration.');
    process.exit(1);
  }
  
  logger.info(`Successfully connected to ${type} version ${version}`);
  
  // Register all MCP tools with the server after validating connection
  try {
    await registerAllTools(server, searchAdapter);
    logger.info(`Successfully registered available MCP tools for ${type}`);
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
