import { ElasticsearchCore, ElasticsearchAdapterOptions } from '../core/core.js';
import { logger } from '../../../utils/logger.js';
import { createErrorResponse, ErrorResponse, isErrorResponse } from '../../../utils/errorHandling.js';

/**
 * Core functionality for the Elasticsearch Adapter
 */
export class CoreAdapter {
  private coreAdapter: ElasticsearchCore;
  
  constructor(options: ElasticsearchAdapterOptions) {
    this.coreAdapter = new ElasticsearchCore(options);
  }
  
  /**
   * Make a request to Elasticsearch
   */
  public callRequest(method: string, url: string, data?: any, config?: any): Promise<any> {
    return this.coreAdapter.callEsRequest(method, url, data, config);
  }
  
  /**
   * Get a list of indices in Elasticsearch
   */
  public async getIndices(): Promise<string[] | ErrorResponse> {
    try {
      logger.info('[CoreAdapter] Getting indices');
      return this.coreAdapter.getIndices();
    } catch (error) {
      return createErrorResponse(`Error getting indices: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Check if the Elasticsearch connection is working
   */
  public async checkConnection(): Promise<boolean | ErrorResponse> {
    try {
      logger.info('[CoreAdapter] Checking connection');
      return this.coreAdapter.checkConnection();
    } catch (error) {
      return createErrorResponse(`Error checking connection: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get information about the Elasticsearch cluster
   */
  public async getInfo(): Promise<any | ErrorResponse> {
    try {
      logger.info('[CoreAdapter] Getting info');
      return this.coreAdapter.getInfo();
    } catch (error) {
      return createErrorResponse(`Error getting info: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get the Elasticsearch version
   */
  public async getVersion(): Promise<string | ErrorResponse> {
    try {
      logger.info('[CoreAdapter] Getting version');
      
      const info = await this.getInfo();
      if (isErrorResponse(info)) {
        return info;
      }
      
      const version = info?.version?.number || 'unknown';
      return version;
    } catch (error) {
      return createErrorResponse(`Error getting version: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Check if a feature is supported
   */
  public supportsFeature(feature: string): boolean {
    // List of supported features
    const supportedFeatures = [
      'search',
      'aggregations',
      'scripting',
      'runtime_fields'
    ];
    
    return supportedFeatures.includes(feature);
  }
  
  /**
   * Legacy method for backward compatibility
   */
  public callEsRequest(method: string, url: string, data?: any, config?: any): Promise<any> {
    return this.callRequest(method, url, data, config);
  }
  
  /**
   * Discover resources in Elasticsearch
   */
  public async discoverResources(): Promise<any[] | ErrorResponse> {
    try {
      logger.info('[CoreAdapter] Discovering resources');
      
      // Get indices
      const indices = await this.getIndices();
      if (isErrorResponse(indices)) {
        return indices;
      }
      
      // Filter for telemetry indices
      const telemetryIndices = indices.filter(index => 
        index.includes('logs') || 
        index.includes('metrics') || 
        index.includes('traces')
      );
      
      // Return resources
      return telemetryIndices.map(index => ({
        name: index,
        type: 'index',
        engine: 'elasticsearch'
      }));
    } catch (error) {
      return createErrorResponse(`Error discovering resources: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
