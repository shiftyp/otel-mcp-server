import axios, { AxiosInstance, AxiosRequestConfig, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { BaseSearchAdapter, SearchAdapterOptions, SearchEngineFeature, SearchEngineType } from '../../base/searchAdapter.js';
import { logger } from '../../../utils/logger.js';

// Extend the Axios request config type to include retry count
interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  __retryCount?: number;
}

export interface OpenSearchAdapterOptions extends SearchAdapterOptions {
  // OpenSearch specific options
  useCompatibilityMode?: boolean; // Whether to use Elasticsearch compatibility mode
}

/**
 * Core OpenSearch adapter implementation
 */
export class OpenSearchCore extends BaseSearchAdapter {
  protected client: AxiosInstance;
  protected openSearchVersion: string | null = null;
  protected openSearchOptions: OpenSearchAdapterOptions;
  
  constructor(options: OpenSearchAdapterOptions) {
    super(options);
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
        
        logger.warn(`Retrying OpenSearch request (${config.__retryCount}/${maxRetries})`, {
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
   * Make a request to OpenSearch
   */
  public callRequest(method: string, url: string, data?: any, config?: any): Promise<any> {
    return this.request(method, url, data, config);
  }
  
  /**
   * Make a request to OpenSearch with error handling
   */
  protected async request(method: string, url: string, data?: any, config?: any): Promise<any> {
    try {
      const requestId = uuidv4();
      
      // Validate and sanitize the request URL
      const sanitizedUrl = url.startsWith('/') ? url : `/${url}`;
      
      logger.debug('OpenSearch request', {
        requestId,
        method,
        url: sanitizedUrl,
        data: data ? JSON.stringify(data).substring(0, 1000) : undefined,
      });
      
      const startTime = Date.now();
      const response = await this.client.request({
        method,
        url: sanitizedUrl,
        data,
        ...config,
      });
      const duration = Date.now() - startTime;
      
      logger.debug('OpenSearch response', {
        requestId,
        status: response.status,
        duration,
        dataSize: JSON.stringify(response.data).length,
      });
      
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        
        logger.error('OpenSearch request error', {
          status: axiosError.response?.status,
          statusText: axiosError.response?.statusText,
          url: axiosError.config?.url,
          method: axiosError.config?.method,
          data: axiosError.response?.data,
        });
        
        // Enhance error with more context
        const enhancedError: any = new Error(`OpenSearch request failed: ${axiosError.message}`);
        enhancedError.status = axiosError.response?.status;
        enhancedError.statusText = axiosError.response?.statusText;
        enhancedError.data = axiosError.response?.data;
        enhancedError.url = axiosError.config?.url;
        enhancedError.method = axiosError.config?.method;
        
        throw enhancedError;
      }
      
      // For non-Axios errors
      logger.error('OpenSearch unknown error', { error });
      throw error;
    }
  }
  
  /**
   * Get a list of indices from OpenSearch
   */
  public async getIndices(): Promise<string[]> {
    try {
      const response = await this.request('GET', '/_cat/indices?format=json');
      return response.map((index: any) => index.index);
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
      await this.request('GET', '/');
      return true;
    } catch (error) {
      logger.error('Failed to connect to OpenSearch', { error });
      return false;
    }
  }
  
  /**
   * Get information about OpenSearch
   */
  public async getInfo(): Promise<any> {
    try {
      return await this.request('GET', '/');
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
    if (this.openSearchVersion) {
      return this.openSearchVersion;
    }
    
    try {
      const info = await this.getInfo();
      this.openSearchVersion = info.version.number;
      return this.openSearchVersion;
    } catch (error) {
      logger.error('Failed to get OpenSearch version', { error });
      return 'unknown';
    }
  }
  
  /**
   * Check if a specific feature is supported by OpenSearch
   * @param feature The feature to check
   */
  public supportsFeature(feature: string): boolean {
    // Feature support matrix for OpenSearch
    const featureSupport: Record<string, boolean> = {
      [SearchEngineFeature.RUNTIME_FIELDS]: false, // OpenSearch doesn't support runtime fields like Elasticsearch
      [SearchEngineFeature.ML_ANOMALY_DETECTION]: true, // OpenSearch has its own ML capabilities
      [SearchEngineFeature.PAINLESS_SCRIPTING]: false, // OpenSearch uses different scripting languages
      [SearchEngineFeature.FIELD_COLLAPSING]: true,
      [SearchEngineFeature.ASYNC_SEARCH]: true,
      [SearchEngineFeature.SEARCH_AFTER]: true,
      [SearchEngineFeature.POINT_IN_TIME]: true,
      [SearchEngineFeature.COMPOSITE_AGGREGATIONS]: true,
      [SearchEngineFeature.PIPELINE_AGGREGATIONS]: true
    };
    
    return featureSupport[feature] || false;
  }
}
