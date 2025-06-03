import { Client, ClientOptions } from '@opensearch-project/opensearch';
import { logger } from '../../utils/logger.js';

// Singleton instance of the OpenSearch client
let clientInstance: Client | null = null;

/**
 * Get the OpenSearch client instance
 * Creates a new instance if one doesn't exist
 * @param options Client options
 * @returns OpenSearch client instance
 */
export function getOpenSearchClient(options?: ClientOptions): Client {
  if (!clientInstance) {
    // Default options if none provided
    const defaultOptions: ClientOptions = {
      node: process.env.OPENSEARCH_URL || 'http://localhost:9200',
      ssl: {
        rejectUnauthorized: false
      }
    };

    // Create a new client instance
    clientInstance = new Client(options || defaultOptions);
    logger.info('[OpenSearchClient] Created new OpenSearch client instance');
  }

  return clientInstance;
}

