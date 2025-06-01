import { EventEmitter } from 'events';
import { ErrorResponse } from '../../utils/errorHandling.js';

/**
 * Common options for all search engine adapters
 */
export interface SearchAdapterOptions {
  baseURL: string;
  apiKey?: string;
  username?: string;
  password?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  // Add any additional options specific to all search engines
}

/**
 * Base interface for all search engine adapters
 * This defines the common methods that all search engine adapters must implement
 */
export abstract class BaseSearchAdapter extends EventEmitter {
  public options: SearchAdapterOptions;
  
  constructor(options: SearchAdapterOptions) {
    super();
    this.options = options;
  }
  
  /**
   * Make a request to the search engine
   * @param method HTTP method
   * @param url Endpoint URL
   * @param data Request body
   * @param config Additional configuration
   */
  public abstract callRequest(method: string, url: string, data?: any, config?: any): Promise<any>;
  
  /**
   * Get a list of indices from the search engine
   */
  public abstract getIndices(): Promise<string[]>;
  
  /**
   * Check if the search engine is available
   */
  public abstract checkConnection(): Promise<boolean>;
  
  /**
   * Get information about the search engine
   */
  public abstract getInfo(): Promise<any>;
  
  /**
   * Get the type of search engine (elasticsearch, opensearch, etc.)
   */
  public abstract getType(): string;
  
  /**
   * Get the version of the search engine
   */
  public abstract getVersion(): Promise<string>;
  
  /**
   * Check if a specific feature is supported by this search engine
   * @param feature The feature to check
   */
  public abstract supportsFeature(feature: string): boolean;
  
  /**
   * Query logs with custom query
   * @param query The query object
   */
  public abstract queryLogs(query: any): Promise<any>;
  
  /**
   * List available log fields
   * @param includeSourceDoc Whether to include source document fields
   */
  public abstract listLogFields(includeSourceDoc?: boolean): Promise<any[] | ErrorResponse>;
  
  /**
   * Query metrics with custom query
   * @param query The query object
   */
  public abstract searchMetrics(query: any): Promise<any>;
  
  /**
   * Query traces with custom query
   * @param query The query object
   */
  public abstract queryTraces(query: any): Promise<any>;
}

/**
 * Enum of search engine types
 */
export enum SearchEngineType {
  ELASTICSEARCH = 'elasticsearch',
  OPENSEARCH = 'opensearch'
}

/**
 * Enum of search engine features
 */
export enum SearchEngineFeature {
  RUNTIME_FIELDS = 'runtime_fields',
  ML_ANOMALY_DETECTION = 'ml_anomaly_detection',
  PAINLESS_SCRIPTING = 'painless_scripting',
  FIELD_COLLAPSING = 'field_collapsing',
  ASYNC_SEARCH = 'async_search',
  SEARCH_AFTER = 'search_after',
  POINT_IN_TIME = 'point_in_time',
  COMPOSITE_AGGREGATIONS = 'composite_aggregations',
  PIPELINE_AGGREGATIONS = 'pipeline_aggregations'
}
