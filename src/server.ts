// server.ts
// Minimal MCP server using the official MCP SDK, supporting stdio and all SDK transports
// @ts-ignore  // MCP SDK does not provide types for this import
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// @ts-ignore  // MCP SDK does not provide types for this import
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { ElasticsearchAdapter } from './adapters/elasticsearch/index.js';
import { registerAllTools } from './tools/implementations/index.js';
import { logger } from './utils/logger.js';

// Instantiate the MCP server
const ELASTICSEARCH_URL = process.env.ELASTICSEARCH_URL || '';
const ELASTICSEARCH_USERNAME = process.env.ELASTICSEARCH_USERNAME || '';
const ELASTICSEARCH_PASSWORD = process.env.ELASTICSEARCH_PASSWORD || '';
const ELASTICSEARCH_API_KEY = process.env.ELASTICSEARCH_API_KEY || '';

const server = new McpServer({
  name: process.env.SERVER_NAME || 'otel-mcp-server',
  version: '1.0.0',
});

const esAdapter = new ElasticsearchAdapter({
  baseURL: ELASTICSEARCH_URL,
  username: ELASTICSEARCH_USERNAME,
  password: ELASTICSEARCH_PASSWORD,
  apiKey: ELASTICSEARCH_API_KEY,
  timeout: 30000,
  maxRetries: 3,
  retryDelay: 1000,
});

// Register all MCP tools with the server
registerAllTools(server, esAdapter);

async function validateElasticsearchConnection() {
  try {
    logger.info('Attempting to connect to Elasticsearch', { url: ELASTICSEARCH_URL });
    const indices = await esAdapter.getIndices();
    logger.info('Successfully retrieved indices from Elasticsearch', { count: indices.length });
    return indices.length > 0;
  } catch (err) {
    logger.error('Failed to connect to Elasticsearch', { 
      url: ELASTICSEARCH_URL,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined
    });
    return false;
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

// Validate Elasticsearch connection before starting server
validateElasticsearchConnection().then(async valid => {
  if (!valid) {
    logger.error('Failed to validate Elasticsearch connection. Check your configuration.');
    process.exit(1);
  }

  logger.info('Successfully connected to Elasticsearch');
  
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
