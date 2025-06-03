import axios, { AxiosInstance, AxiosRequestConfig, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { SearchAdapterOptions, SearchEngineFeature, SearchEngineType } from '../../base/searchAdapter.js';
import { logger } from '../../../utils/logger.js';
import { createErrorResponse, ErrorResponse } from '../../../utils/errorHandling.js';
import { ConfigLoader } from '../../../config/index.js';

// Extend the Axios request config type to include retry count
interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  __retryCount?: number;
}

export interface OpenSearchAdapterOptions extends SearchAdapterOptions {
  baseURL: string;
  apiKey?: string;
  username?: string;
  password?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  // OpenSearch specific options
  useCompatibilityMode?: boolean; // Whether to use Elasticsearch compatibility mode
  logsIndex?: string; // Custom logs index pattern
  metricsIndex?: string; // Custom metrics index pattern
  tracesIndex?: string; // Custom traces index pattern
}

/**
 * Core OpenSearch adapter implementation
 * This is a base class for OpenSearch-specific functionality, not a full adapter
 */
export class OpenSearchCore {
  protected client: AxiosInstance;
  protected openSearchVersion: string = 'unknown';
  protected openSearchOptions: OpenSearchAdapterOptions;
  
  constructor(options: OpenSearchAdapterOptions) {
    this.openSearchOptions = options;
    
    const axiosConfig: AxiosRequestConfig = {
      baseURL: options.baseURL,
      timeout: options.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    
    // Set up authentication
    if (options.apiKey) {
      axiosConfig.headers = {
        ...axiosConfig.headers,
        'Authorization': `ApiKey ${options.apiKey}`,
      };
    } else if (options.username && options.password) {
      axiosConfig.auth = {
        username: options.username,
        password: options.password,
      };
    }
    
    // Create axios instance
    this.client = axios.create(axiosConfig);
    
    // Add request interceptor for retries
    this.client.interceptors.request.use(
      (config) => {
        const requestId = uuidv4();
        config.headers['X-Request-ID'] = requestId;
        const requestConfig = config as RetryableRequestConfig;
        requestConfig.__retryCount = 0;
        
        logger.debug('Making OpenSearch request', {
          requestId,
          method: config.method,
          url: config.url,
          baseURL: config.baseURL,
        });
        
        return config;
      },
      (error) => {
        logger.error('Request interceptor error', { error });
        return Promise.reject(error);
      }
    );
    
    // Add response interceptor
    this.client.interceptors.response.use(
      (response) => {
        logger.debug('OpenSearch response received', {
          requestId: response.config.headers['X-Request-ID'],
          status: response.status,
          url: response.config.url,
        });
        return response;
      },
      async (error: AxiosError) => {
        const requestConfig = error.config as RetryableRequestConfig;
        
        if (!requestConfig) {
          return Promise.reject(error);
        }
        
        const retryCount = requestConfig.__retryCount || 0;
        const maxRetries = this.openSearchOptions.maxRetries || 3;
        const retryDelay = this.openSearchOptions.retryDelay || 1000;
        
        logger.error('OpenSearch request failed', {
          requestId: requestConfig.headers['X-Request-ID'],
          error: error.message,
          status: error.response?.status,
          url: requestConfig.url,
          retryCount,
        });
        
        // Retry logic for specific errors
        if (
          retryCount < maxRetries &&
          error.response &&
          [429, 502, 503, 504].includes(error.response.status)
        ) {
          requestConfig.__retryCount = retryCount + 1;
          
          logger.info('Retrying OpenSearch request', {
            requestId: requestConfig.headers['X-Request-ID'],
            retryCount: requestConfig.__retryCount,
            maxRetries,
            delay: retryDelay,
          });
          
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, retryDelay * (retryCount + 1)));
          
          // Retry the request
          return this.client.request(requestConfig);
        }
        
        return Promise.reject(error);
      }
    );
  }
  
  /**
   * Make a request to OpenSearch
   * @param method HTTP method
   * @param url Endpoint URL
   * @param data Request body
   * @param config Additional configuration
   */
  public async callRequest(method: string, url: string, data?: any, config?: AxiosRequestConfig): Promise<any> {
    try {
      const response = await this.client.request({
        method,
        url,
        data,
        ...config,
      });
      
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error('OpenSearch request error', {
          method,
          url,
          status: error.response?.status,
          statusText: error.response?.statusText,
          error: error.response?.data?.error || error.message,
        });
        
        // Throw the error with additional context
        throw new Error(
          error.response?.data?.error?.reason || error.message
        );
      }
      
      throw error;
    }
  }
  
  /**
   * Get a list of indices from OpenSearch
   */
  public async getIndices(): Promise<string[]> {
    try {
      const response = await this.callRequest('GET', '/_cat/indices?format=json');
      return response.map((index: any) => index.index).filter((name: string) => !name.startsWith('.'));
    } catch (error) {
      logger.error('Failed to get indices', { error });
      return [];
    }
  }
  
  /**
   * Check if OpenSearch is available
   */
  public async checkConnection(): Promise<boolean> {
    try {
      await this.callRequest('GET', '/_cluster/health');
      return true;
    } catch (error) {
      logger.error('OpenSearch connection check failed', { error });
      return false;
    }
  }
  
  /**
   * Get information about OpenSearch
   */
  public async getInfo(): Promise<any> {
    try {
      const info = await this.callRequest('GET', '/');
      this.openSearchVersion = info.version?.number || 'unknown';
      return info;
    } catch (error) {
      logger.error('Failed to get OpenSearch info', { error });
      throw error;
    }
  }
  
  /**
   * Get the type of search engine
   */
  public getType(): string {
    return SearchEngineType.OPENSEARCH;
  }
  
  /**
   * Get the version of OpenSearch
   */
  public async getVersion(): Promise<string> {
    if (this.openSearchVersion === 'unknown') {
      const info = await this.getInfo();
      this.openSearchVersion = info.version?.number || 'unknown';
    }
    return this.openSearchVersion;
  }
  
  /**
   * Check if a specific feature is supported by OpenSearch
   * @param feature The feature to check
   */
  public supportsFeature(feature: string): boolean {
    // OpenSearch supports most Elasticsearch features
    const supportedFeatures = [
      SearchEngineFeature.PAINLESS_SCRIPTING,
      SearchEngineFeature.FIELD_COLLAPSING,
      SearchEngineFeature.SEARCH_AFTER,
      SearchEngineFeature.POINT_IN_TIME,
      SearchEngineFeature.COMPOSITE_AGGREGATIONS,
      SearchEngineFeature.PIPELINE_AGGREGATIONS,
      // OpenSearch-specific features
      'ml_commons',
      'anomaly_detection',
      'knn_search',
      'sql_search',
      'security_analytics'
    ];
    
    return supportedFeatures.includes(feature);
  }
  
  /**
   * Get configured logs index pattern
   */
  public getLogsIndex(): string {
    const config = ConfigLoader.get();
    return this.openSearchOptions.logsIndex || config.telemetry.indices.logs;
  }
  
  /**
   * Get configured metrics index pattern
   */
  public getMetricsIndex(): string {
    const config = ConfigLoader.get();
    return this.openSearchOptions.metricsIndex || config.telemetry.indices.metrics;
  }
  
  /**
   * Get configured traces index pattern
   */
  public getTracesIndex(): string {
    const config = ConfigLoader.get();
    return this.openSearchOptions.tracesIndex || config.telemetry.indices.traces;
  }
  
  /**
   * Query logs index
   * @param query The query object
   */
  public async queryLogs(query: any): Promise<any> {
    const logsIndex = this.getLogsIndex();
    return this.callRequest('POST', `/${logsIndex}/_search`, query);
  }
  
  /**
   * Query metrics index
   * @param query The query object
   */
  public async queryMetrics(query: any): Promise<any> {
    const metricsIndex = this.getMetricsIndex();
    return this.callRequest('POST', `/${metricsIndex}/_search`, query);
  }
  
  /**
   * Query traces index
   * @param query The query object
   */
  public async queryTraces(query: any): Promise<any> {
    const tracesIndex = this.getTracesIndex();
    return this.callRequest('POST', `/${tracesIndex}/_search`, query);
  }
  
  /**
   * List available log fields
   * @param prefix Optional prefix to filter fields
   */
  public async listLogFields(prefix?: string): Promise<string[]> {
    const logsIndex = this.getLogsIndex();
    const response = await this.callRequest('GET', `/${logsIndex}/_mapping`);
    
    const fields: string[] = [];
    for (const index in response) {
      const mappings = response[index].mappings;
      if (mappings && mappings.properties) {
        this.extractFields(mappings.properties, '', fields, prefix);
      }
    }
    
    return [...new Set(fields)].sort();
  }
  
  /**
   * Helper to extract field names from mapping
   */
  private extractFields(properties: any, path: string, fields: string[], prefix?: string): void {
    for (const field in properties) {
      const fullPath = path ? `${path}.${field}` : field;
      
      if (!prefix || fullPath.startsWith(prefix)) {
        fields.push(fullPath);
      }
      
      if (properties[field].properties) {
        this.extractFields(properties[field].properties, fullPath, fields, prefix);
      }
    }
  }
  
  /**
   * Get supported aggregations
   */
  public getSupportedAggregations(): string[] {
    return [
      'terms',
      'date_histogram',
      'histogram',
      'avg',
      'sum',
      'min',
      'max',
      'cardinality',
      'percentiles',
      'stats',
      'extended_stats',
      'top_hits',
      'significant_terms',
      'rare_terms',
      'filters',
      'range',
      'date_range',
      'ip_range',
      'geo_bounds',
      'geo_centroid',
      'scripted_metric',
      'composite',
      'bucket_script',
      'bucket_selector',
      'bucket_sort',
      'cumulative_sum',
      'derivative',
      'moving_avg',
      'serial_diff'
    ];
  }
}