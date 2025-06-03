import { Client as OSClient } from '@opensearch-project/opensearch';
import { BaseSearchAdapter } from './base/searchAdapter.js';
import { OpenSearchAdapter } from './opensearch/opensearchAdapter.js';
import { logger } from '../utils/logger.js';

export interface AdapterConfig {
  backend?: 'auto' | 'opensearch';
  baseURL: string;
  apiKey?: string;
  username?: string;
  password?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * Detects the backend type by checking the cluster info
 */
async function detectBackendType(config: AdapterConfig): Promise<'opensearch'> {
  try {
    const osClient = new OSClient({
      node: config.baseURL,
      auth: config.apiKey 
        ? { apiKey: config.apiKey }
        : config.username && config.password
        ? { username: config.username, password: config.password }
        : undefined
    });
    
    const info = await osClient.info();
    if (info.body?.version) {
      logger.info('Detected OpenSearch backend', { version: info.body.version });
      return 'opensearch';
    }
  } catch (error) {
    logger.error('Failed to detect backend type', { error });
    throw new Error('Unable to detect OpenSearch backend. Please check your connection settings.');
  }
  
  return 'opensearch';
}

/**
 * Creates an appropriate adapter based on the backend type
 */
export async function createAdapter(config: AdapterConfig): Promise<BaseSearchAdapter> {
  let backendType: 'opensearch';
  
  if (config.backend === 'auto' || !config.backend) {
    backendType = await detectBackendType(config);
  } else {
    backendType = 'opensearch';
  }
  
  logger.info('Creating adapter', { backendType });
  
  return new OpenSearchAdapter(config);
}

/**
 * Factory class for creating adapters with caching
 */
export class AdapterFactory {
  private static instances = new Map<string, BaseSearchAdapter>();
  
  /**
   * Get or create an adapter instance
   */
  static async getInstance(config: AdapterConfig): Promise<BaseSearchAdapter> {
    const key = `${config.backend || 'auto'}-${config.baseURL}`;
    
    if (!this.instances.has(key)) {
      const adapter = await createAdapter(config);
      this.instances.set(key, adapter);
    }
    
    return this.instances.get(key)!;
  }
  
  /**
   * Clear cached instances
   */
  static clearCache(): void {
    this.instances.clear();
  }
  
  /**
   * Check if a backend supports a specific feature
   */
  static async checkFeatureSupport(
    config: AdapterConfig, 
    feature: keyof ReturnType<BaseSearchAdapter['getCapabilities']>
  ): Promise<boolean> {
    const adapter = await this.getInstance(config);
    const capabilities = adapter.getCapabilities();
    
    if (feature === 'ml' || feature === 'search' || feature === 'aggregations') {
      return Object.values(capabilities[feature]).some(v => v === true);
    }
    
    return false;
  }
  
  /**
   * Get detailed capability information
   */
  static async getCapabilities(config: AdapterConfig): Promise<ReturnType<BaseSearchAdapter['getCapabilities']>> {
    const adapter = await this.getInstance(config);
    return adapter.getCapabilities();
  }
}