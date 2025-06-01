import { BaseSearchAdapter, SearchAdapterOptions, SearchEngineType } from './base/searchAdapter.js';
import { ElasticsearchAdapter, ElasticsearchAdapterOptions } from './elasticsearch/index.js';
import { OpenSearchAdapter, OpenSearchAdapterOptions } from './opensearch/index.js';
import { logger } from '../utils/logger.js';

export interface SearchEngineConfig extends SearchAdapterOptions {
  type: string; // 'elasticsearch' or 'opensearch'
  useCompatibilityMode?: boolean; // For OpenSearch
}

/**
 * Factory class for creating search engine adapters
 */
export class SearchAdapterFactory {
  /**
   * Create a search engine adapter based on the provided configuration
   * @param config The search engine configuration
   * @returns A search engine adapter instance
   */
  public static createAdapter(config: SearchEngineConfig): ElasticsearchAdapter | OpenSearchAdapter {
    const { type, ...adapterOptions } = config;
    
    logger.info(`Creating ${type} adapter with baseURL: ${adapterOptions.baseURL}`);
    
    switch (type.toLowerCase()) {
      case SearchEngineType.ELASTICSEARCH:
        return new ElasticsearchAdapter(adapterOptions as ElasticsearchAdapterOptions);
        
      case SearchEngineType.OPENSEARCH:
        return new OpenSearchAdapter({
          ...adapterOptions,
          useCompatibilityMode: config.useCompatibilityMode
        } as OpenSearchAdapterOptions);
        
      default:
        logger.warn(`Unknown search engine type: ${type}, defaulting to Elasticsearch`);
        return new ElasticsearchAdapter(adapterOptions as ElasticsearchAdapterOptions);
    }
  }
  
  /**
   * Auto-detect the search engine type by querying the endpoint
   * @param baseURL The base URL of the search engine
   * @returns The detected search engine type and version
   */
  public static async detectSearchEngineType(baseURL: string): Promise<{ 
    type: SearchEngineType, 
    version: string 
  }> {
    try {
      // Create a temporary Elasticsearch adapter to query the endpoint
      const tempAdapter = new ElasticsearchAdapter({ baseURL });
      const info = await tempAdapter.callEsRequest('GET', '/');
      
      // Check if it's OpenSearch
      if (info.version?.distribution === 'opensearch') {
        return {
          type: SearchEngineType.OPENSEARCH,
          version: info.version.number
        };
      }
      
      // Otherwise, assume it's Elasticsearch
      return {
        type: SearchEngineType.ELASTICSEARCH,
        version: info.version?.number || 'unknown'
      };
    } catch (error) {
      logger.error('Failed to detect search engine type', { error });
      // Default to Elasticsearch if detection fails
      return {
        type: SearchEngineType.ELASTICSEARCH,
        version: 'unknown'
      };
    }
  }
}
