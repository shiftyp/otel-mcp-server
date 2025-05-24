import axios, { AxiosInstance, AxiosRequestConfig, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { logger } from '../../utils/logger.js';

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
   */
  protected async request(method: string, url: string, data?: any, config?: any): Promise<any> {
    try {
      const requestId = uuidv4();
      logger.debug(`[ES:${requestId}] Request`, { method, url, data });
      
      const response = await this.client.request({
        method,
        url,
        data,
        ...config,
      });
      
      logger.debug(`[ES:${requestId}] Response`, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        logger.error('Elasticsearch request failed', {
          method,
          url,
          status: axiosError.response?.status,
          statusText: axiosError.response?.statusText,
          message: axiosError.message,
          response: axiosError.response?.data,
        });
      } else {
        logger.error('Elasticsearch request failed with non-Axios error', {
          method,
          url,
          error,
        });
      }
      throw error;
    }
  }
  
  /**
   * Get list of Elasticsearch indices
   */
  public async getIndices(): Promise<string[]> {
    try {
      const response = await this.request('GET', '/_cat/indices?format=json');
      
      // Get all indices and sort by name
      const filteredIndices = response
        .map((index: any) => index.index)
        .sort();
      
      return filteredIndices;
    } catch (error) {
      logger.error('Failed to get Elasticsearch indices', { error });
      throw error;
    }
  }
}
