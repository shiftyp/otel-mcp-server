import axios, { AxiosInstance, AxiosRequestConfig, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { SearchEngineFeature, SearchEngineType } from '../../base/searchAdapter.js';

import { logger } from '../../../utils/logger.js';

// Extend the Axios request config type to include retry count
interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  __retryCount?: number;
}

export interface ElasticsearchAdapterOptions {
  baseURL: string;
  apiKey?: string;
  username?: string;
  password?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

export class ElasticsearchCore extends EventEmitter {
  protected client: AxiosInstance;
  protected options: ElasticsearchAdapterOptions;
  
  constructor(options: ElasticsearchAdapterOptions) {
    super();
    this.options = options;
    
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
    
    this.client = axios.create(axiosConfig);
    
    // Add request interceptor for retry logic
    this.client.interceptors.response.use(undefined, async (error: AxiosError) => {
      const config = error.config as RetryableRequestConfig;
      if (!config) {
        return Promise.reject(error);
      }
      
      // Set default retry count
      config.__retryCount = config.__retryCount || 0;
      const maxRetries = this.options.maxRetries || 3;
      
      // Check if we should retry the request
      if (config.__retryCount < maxRetries) {
        config.__retryCount += 1;
        const retryDelay = this.options.retryDelay || 1000;
        
        logger.warn(`Retrying Elasticsearch request (${config.__retryCount}/${maxRetries})`, {
          url: config.url,
          method: config.method,
          retryDelay,
        });
        
        // Delay the retry
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return this.client(config);
      }
      
      return Promise.reject(error);
    });
  }
  
  /**
   * Expose a public wrapper for the protected request method for use by external tools.
   */
  public callEsRequest(method: string, url: string, data?: any, config?: any): Promise<any> {
    return this.request(method, url, data, config);
  }
  
  /**
   * Make a request to Elasticsearch
   * Enhanced with better error handling and request validation
   */
  protected async request(method: string, url: string, data?: any, config?: any): Promise<any> {
    try {
      const requestId = uuidv4();
      
      // Validate and sanitize the request URL
      // Ensure URL starts with a slash and doesn't have trailing slashes
      const sanitizedUrl = url.startsWith('/') ? url : `/${url}`;
      
      // Validate the request data for search operations
      if (method.toUpperCase() === 'POST' && sanitizedUrl.includes('_search') && data) {
        // Log a warning for very large result sizes but don't limit them
        // Note: Elasticsearch's default max result window is 10,000 documents
        if (data.size && typeof data.size === 'number' && data.size > 10000) {
          logger.warn(`[ES:${requestId}] Large result size requested (${data.size}). Note that Elasticsearch's default max_result_window is 10000.`, { method, url });
        }
        
        // Ensure track_total_hits is enabled for accurate result counts
        if (data.track_total_hits === undefined) {
          data.track_total_hits = true;
        }
      }
      
      logger.debug(`[ES:${requestId}] Request`, { method, sanitizedUrl, data });
      
      const response = await this.client.request({
        method,
        url: sanitizedUrl,
        data,
        ...config,
      });
      
      logger.debug(`[ES:${requestId}] Response`, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        hits: response.data?.hits?.total?.value,
      });
      
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const responseData = axiosError.response?.data as any;
        
        // Extract detailed Elasticsearch error information
        const esError = responseData?.error;
        const rootCause = esError?.root_cause?.[0];
        
        logger.error('Elasticsearch request failed', {
          method,
          url,
          status: axiosError.response?.status,
          statusText: axiosError.response?.statusText,
          message: axiosError.message,
          type: esError?.type,
          reason: esError?.reason || rootCause?.reason,
          index: rootCause?.index,
        });
        
        // Enhance error with Elasticsearch specific details
        if (esError) {
          const enhancedError = new Error(
            `Elasticsearch error: ${esError.type || 'unknown'} - ${esError.reason || rootCause?.reason || axiosError.message}`
          );
          (enhancedError as any).esError = esError;
          (enhancedError as any).status = axiosError.response?.status;
          throw enhancedError;
        }
      } else {
        logger.error('Elasticsearch request failed with non-Axios error', {
          method,
          url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  }
  
  /**
   * Get a list of indices from Elasticsearch
   */
  public async getIndices(): Promise<string[]> {
    try {
      const response = await this.callEsRequest('GET', '/_cat/indices?format=json');
      return response.map((index: any) => index.index);
    } catch (error) {
      logger.error('Failed to get Elasticsearch indices', { error });
      return [];
    }
  }
  
  /**
   * Check if Elasticsearch is available
   */
  public async checkConnection(): Promise<boolean> {
    try {
      await this.callEsRequest('GET', '/');
      return true;
    } catch (error) {
      logger.error('Failed to connect to Elasticsearch', { error });
      return false;
    }
  }
  
  /**
   * Get information about Elasticsearch
   */
  public async getInfo(): Promise<any> {
    try {
      return await this.callEsRequest('GET', '/');
    } catch (error) {
      logger.error('Failed to get Elasticsearch info', { error });
      return { version: { number: 'unknown' } };
    }
  }
  
  /**
   * Get the type of search engine
   */
  public getType(): string {
    return SearchEngineType.ELASTICSEARCH;
  }
  
  /**
   * Get the version of Elasticsearch
   */
  public async getVersion(): Promise<string> {
    try {
      const info = await this.getInfo();
      return info.version.number;
    } catch (error) {
      logger.error('Failed to get Elasticsearch version', { error });
      return 'unknown';
    }
  }
  
  /**
   * Check if a specific feature is supported by Elasticsearch
   * @param feature The feature to check
   */
  public supportsFeature(feature: string): boolean {
    // Default feature support for Elasticsearch
    switch (feature) {
      case SearchEngineFeature.RUNTIME_FIELDS:
      case SearchEngineFeature.PAINLESS_SCRIPTING:
      case SearchEngineFeature.FIELD_COLLAPSING:
      case SearchEngineFeature.ASYNC_SEARCH:
      case SearchEngineFeature.SEARCH_AFTER:
      case SearchEngineFeature.POINT_IN_TIME:
      case SearchEngineFeature.COMPOSITE_AGGREGATIONS:
      case SearchEngineFeature.PIPELINE_AGGREGATIONS:
        return true;
      case SearchEngineFeature.ML_ANOMALY_DETECTION:
        return true; // Elasticsearch has its own ML capabilities
      default:
        return false;
    }
  }
}
