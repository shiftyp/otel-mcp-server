import { logger } from '../../../utils/logger.js';
import { LogsAdapterCore } from './logCore.js';
import { SearchEngineType } from '../../base/searchAdapter.js';
import { Client, ApiResponse } from '@opensearch-project/opensearch';
import { semanticSearchWithOpenSearch } from './semanticSearchOpenSearch.js';
import { semanticSearchWithElasticsearch } from './semanticSearchElasticsearch.js';
import { EmbeddingProviderConfig } from '../ml/embeddingProvider.js';

// Define interfaces for OpenSearch search parameters and response types
interface SearchRequest {
  index?: string;
  size?: number;
  from?: number;
  sort?: any;
  query?: any;
  search?: string;
  body?: any;
  [key: string]: any;
}

interface SearchResponse {
  hits: {
    hits: Array<{ _id: string; _source: Record<string, unknown> }>;
    total: { value: number };
  };
  [key: string]: any;
}

/**
 * Interface for semantic search options
 */
export interface SemanticSearchOptions {
  startTime?: string;
  endTime?: string;
  service?: string;
  level?: string;
  queryString?: string;
  k?: number;
  minSimilarity?: number;
  includeContext?: boolean;
  contextWindowSize?: number;
  engineType?: string;
  samplingPercent?: number;
  /**
   * Maximum number of candidate logs to consider (sample rate will be reduced if more would be sampled)
   * Defaults to 10000 if not set
   */
  maxSampleSize?: number;
  page?: number; // Page number for automatic paging through results (default 0)
  pageSize?: number; // Page size for paging (default 50)
  // Paging is handled automatically in the backend; users do not need to specify unless they want to override.
  
  /**
   * Embedding provider configuration
   * Controls which embedding provider and model to use
   * If not provided, the default configuration will be used
   */
  embeddingProviderConfig?: EmbeddingProviderConfig;
  
  /**
   * Text extraction options for customizing how text is extracted for embedding generation
   */
  textExtractionOptions?: {
    /**
     * Fields to extract as primary text content
     * Default: ['message', 'body', 'log.message', 'text_content']
     */
    textFields?: string[];
    
    /**
     * Fields to extract as dimensional or contextual information
     * Default: ['attributes', 'resource.attributes', 'labels']
     */
    dimensionFields?: string[];
    
    /**
     * Fields to extract as numeric or measurement values
     * Default: [] (empty for logs as values are rarely useful for semantic search)
     */
    valueFields?: string[];
  };
}

/**
 * Enhanced semantic log search using ML capabilities
 * Supports both OpenSearch and Elasticsearch with different implementations
 */
export class SemanticLogSearch extends LogsAdapterCore {
  constructor(options: Record<string, unknown>) {
    super(options);
  }
  
  /**
   * Query logs with custom query (required by LogsAdapterCore)
   * @param query The query object
   */
  public async queryLogs(query: SearchRequest): Promise<ApiResponse> {
    logger.info('[OpenSearch SemanticLogSearch] queryLogs called but not implemented in this adapter');
    throw new Error('queryLogs not implemented in SemanticLogSearch');
  }
  
  /**
   * List available log fields (required by LogsAdapterCore)
   * @param includeSourceDoc Whether to include source document fields
   */
  public async listLogFields(includeSourceDoc?: boolean): Promise<string[]> {
    logger.info('[OpenSearch SemanticLogSearch] listLogFields called but not implemented in this adapter');
    throw new Error('listLogFields not implemented in SemanticLogSearch');
  }
  
  /**
   * Query metrics with custom query (required by LogsAdapterCore)
   * @param query The query object
   */
  public async searchMetrics(query: SearchRequest): Promise<ApiResponse> {
    logger.info('[OpenSearch SemanticLogSearch] searchMetrics called but not implemented in this adapter');
    throw new Error('searchMetrics not implemented in SemanticLogSearch');
  }
  
  /**
   * Query traces with custom query (required by LogsAdapterCore)
   * @param query The query object
   */
  public async queryTraces(query: SearchRequest): Promise<ApiResponse> {
    logger.info('[OpenSearch SemanticLogSearch] queryTraces called but not implemented in this adapter');
    throw new Error('queryTraces not implemented in SemanticLogSearch');
  }

  /**
   * Perform semantic search on logs with enhanced context handling
   * @param query The search query or natural language question
   * @param options Additional options for the search
   */
  public async semanticLogSearch(
    query: string,
    options: SemanticSearchOptions = {}
  ): Promise<{ results: unknown[]; error?: string; message?: string }> {
    logger.info('[SemanticLogSearch] Searching logs semantically', { query, options });
    
    try {
      // Default options
      const k = options.k || 10;
      const minSimilarity = options.minSimilarity || 0.7;
      const includeContext = options.includeContext !== undefined ? options.includeContext : true;
      const contextWindowSize = options.contextWindowSize || 5;
      const engineType = options.engineType || SearchEngineType.OPENSEARCH;
      
      // Make sure we have a valid client
      if (!this.client) {
        logger.error('[SemanticLogSearch] No valid OpenSearch client available', { options: this.options });
        throw new Error('No valid OpenSearch client available');
      }
      
      // Create adapter options with client
      const adapterOptions = {
        ...this.options,
        client: this.client
      };
      
      // Choose implementation based on engine type
      if (engineType === SearchEngineType.OPENSEARCH) {
        return await semanticSearchWithOpenSearch(query, {
          ...options,
          k,
          minSimilarity,
          includeContext,
          contextWindowSize
        }, adapterOptions as any);
      } else {
        return await semanticSearchWithElasticsearch(query, {
          ...options,
          k,
          minSimilarity,
          includeContext,
          contextWindowSize
        }, adapterOptions as any);
      }
    } catch (error: unknown) {
      logger.error('[SemanticLogSearch] Error searching logs semantically', { error });
      return { 
        results: [], 
        error: (typeof error === 'object' && error !== null && 'message' in error && typeof (error as any).message === 'string') ? (error as any).message : String(error),
        message: 'Failed to search logs semantically'
      };
    }
  }
}
