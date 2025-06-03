import { EventEmitter } from 'events';
import { ErrorResponse } from '../../utils/errorHandling.js';
import { ServiceInfo } from '../../types.js';
import { SearchResponse, Query, Sort } from '../../types/opensearch-types.js';

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
 * Query result interface - extends OpenSearch SearchResponse
 */
export type QueryResult<T = unknown> = SearchResponse<T>;

/**
 * Field information interface
 */
export interface FieldInfo {
  name: string;
  type: string;
  searchable: boolean;
  aggregatable: boolean;
  count?: number;
  mapping?: Record<string, unknown>;
}

/**
 * Anomaly detection configuration
 */
export interface AnomalyConfig {
  field: string;
  method?: 'zscore' | 'isolation_forest' | 'dbscan';
  threshold?: number;
  windowSize?: number;
}

/**
 * Anomaly result interface
 */
export interface AnomalyResult {
  timestamp: string;
  value: number;
  score: number;
  isAnomaly: boolean;
  field: string;
}

/**
 * Forecast configuration
 */
export interface ForecastConfig {
  field: string;
  periods: number;
  interval: string;
  method?: 'linear' | 'arima' | 'prophet';
}

/**
 * Forecast result interface
 */
export interface ForecastResult {
  timestamp: string;
  predicted: number;
  lower: number;
  upper: number;
  confidence: number;
}

/**
 * Pattern configuration
 */
export interface PatternConfig {
  field: string;
  minSupport?: number;
  maxPatternLength?: number;
}

/**
 * Pattern result interface
 */
export interface PatternResult {
  pattern: string;
  count: number;
  frequency: number;
  examples: string[];
}

/**
 * Adapter capabilities interface
 */
export interface AdapterCapabilities {
  ml: {
    anomalyDetection: boolean;
    forecasting: boolean;
    patternAnalysis: boolean;
    clustering: boolean;
  };
  search: {
    vectorSearch: boolean;
    fuzzySearch: boolean;
    semanticSearch: boolean;
  };
  aggregations: {
    pipeline: boolean;
    matrix: boolean;
    percentiles: boolean;
  };
}

/**
 * Base interface for all search engine adapters
 * This defines the common methods that all search engine adapters must implement
 */
export abstract class BaseSearchAdapter extends EventEmitter {
  protected options: SearchAdapterOptions;
  
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
   * Make an API call (alias for callRequest for backward compatibility)
   */
  public async callApi(method: string, url: string, data?: any, config?: any): Promise<any> {
    return this.callRequest(method, url, data, config);
  }
  
  /**
   * Get a list of indices from the search engine
   */
  public abstract getIndices(): Promise<string[]>;
  
  /**
   * Check if the search engine is available
   */
  public abstract checkConnection(): Promise<boolean>;
  
  /**
   * Check if the adapter is healthy
   */
  public async isHealthy(): Promise<boolean> {
    return this.checkConnection();
  }
  
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
  public abstract getVersion(): Promise<{ version: string; distribution?: string }>;
  
  /**
   * Get adapter capabilities
   */
  public abstract getCapabilities(): AdapterCapabilities;
  
  /**
   * Check if a specific feature is supported by this search engine
   * @param feature The feature to check
   */
  public abstract supportsFeature(feature: string): boolean;
  
  /**
   * Query logs with custom query
   * @param query The query object
   */
  public abstract queryLogs(query: unknown): Promise<unknown>;
  
  /**
   * List available log fields
   * @param includeSourceDoc Whether to include source document fields
   */
  public abstract listLogFields(includeSourceDoc?: boolean): Promise<unknown[] | ErrorResponse>;
  
  /**
   * Query metrics with custom query
   * @param query The query object
   */
  public abstract queryMetrics(query: unknown): Promise<unknown>;
  
  /**
   * Query traces with custom query
   * @param query The query object
   */
  public abstract queryTraces(query: unknown): Promise<unknown>;
  
  /**
   * Generic query method
   */
  public abstract query<T = unknown>(
    index: string, 
    query: Query, 
    options?: {
      size?: number;
      from?: number;
      sort?: Sort;
      aggregations?: Record<string, any>;
      _source?: boolean | string[];
    }
  ): Promise<QueryResult<T>>;
  
  /**
   * Get fields for a specific index pattern
   */
  public abstract getFields(indexPattern: string, search?: string): Promise<FieldInfo[]>;
  
  /**
   * Get available services
   */
  public abstract getServices(): Promise<ServiceInfo[]>;
  
  /**
   * Detect anomalies in data
   */
  public abstract detectAnomalies(
    index: string,
    config: AnomalyConfig,
    timeRange?: { from: string; to: string }
  ): Promise<AnomalyResult[]>;
  
  /**
   * Forecast future values
   */
  public abstract forecast(
    index: string,
    config: ForecastConfig,
    historicalData?: { from: string; to: string }
  ): Promise<ForecastResult[]>;
  
  /**
   * Analyze patterns in data
   */
  public abstract analyzePatterns(
    index: string,
    config: PatternConfig,
    timeRange?: { from: string; to: string }
  ): Promise<PatternResult[]>;
  
  /**
   * Analyze log patterns
   */
  public async analyzeLogPatterns(
    config: PatternConfig,
    timeRange?: { from: string; to: string }
  ): Promise<PatternResult[]> {
    return this.analyzePatterns('logs-*', config, timeRange);
  }

  /**
   * Get metric statistics
   * Default implementation - can be overridden by specific adapters
   */
  public async getMetricStats(
    metricName: string,
    timeRange: { from: string; to: string },
    service?: string
  ): Promise<QueryResult<unknown>> {
    // Default implementation using standard aggregations
    const query: Query = {
      bool: {
        must: [
          {
            range: {
              '@timestamp': {
                gte: timeRange.from,
                lte: timeRange.to
              }
            }
          },
          {
            exists: {
              field: metricName
            }
          }
        ]
      }
    };

    if (service && query.bool && Array.isArray(query.bool.must)) {
      query.bool.must.push({
        term: {
          'service.name': service
        }
      });
    }

    const result = await this.query('metrics-*', query, {
      size: 0,
      aggregations: {
        stats: {
          stats: {
            field: metricName
          }
        }
      }
    });

    return result.aggregations?.stats || {};
  }

  /**
   * Semantic log search
   * Default implementation throws error - must be implemented by adapters that support it
   */
  public async semanticLogSearch(
    query: string,
    options?: any
  ): Promise<any> {
    throw new Error('Semantic log search is not supported by this adapter');
  }

  /**
   * Cluster traces
   * Default implementation throws error - must be implemented by adapters that support it
   */
  public async clusterTraces(
    options: any
  ): Promise<any> {
    throw new Error('Trace clustering is not supported by this adapter');
  }

  /**
   * Analyze traces
   * Default implementation throws error - must be implemented by adapters that support it
   */
  public async analyzeTraces(
    options: any
  ): Promise<any> {
    throw new Error('Trace analysis is not supported by this adapter');
  }

  /**
   * Get service dependencies
   * Default implementation - can be overridden by specific adapters
   */
  public async getServiceDependencies(
    timeRange: { from: string; to: string },
    timestampField: string = '@timestamp'
  ): Promise<any> {
    const query = {
      bool: {
        must: [
          {
            range: {
              [timestampField]: {
                gte: timeRange.from,
                lte: timeRange.to
              }
            }
          },
          {
            exists: {
              field: 'span.id'
            }
          }
        ]
      }
    };

    const result = await this.query('traces-*', query, {
      size: 0,
      aggregations: {
        services: {
          terms: {
            field: 'service.name.keyword',
            size: 100
          },
          aggs: {
            dependencies: {
              terms: {
                field: 'attributes.peer.service.keyword',
                size: 100
              }
            }
          }
        }
      }
    });

    return result.aggregations?.services?.buckets || [];
  }
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