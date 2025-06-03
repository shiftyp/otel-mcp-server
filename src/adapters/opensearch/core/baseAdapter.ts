import { OpenSearchCore } from './core.js';
import { logger } from '../../../utils/logger.js';

/**
 * Base class for OpenSearch sub-adapters (Logs, Metrics, Traces)
 * Uses composition instead of inheritance to avoid method conflicts
 */
export class OpenSearchSubAdapter {
  protected core: OpenSearchCore;
  
  constructor(options: any) {
    this.core = new OpenSearchCore(options);
  }
  
  /**
   * Make a request to OpenSearch
   */
  public async request(method: string, url: string, body?: any): Promise<any> {
    return this.core.callRequest(method, url, body);
  }
  
  /**
   * Get indices from OpenSearch
   */
  public async getIndices(): Promise<string[]> {
    return this.core.getIndices();
  }
  
  /**
   * Check connection health
   */
  public async checkConnection(): Promise<boolean> {
    return this.core.checkConnection();
  }
  
  /**
   * Get OpenSearch info
   */
  public async getInfo(): Promise<any> {
    return this.core.getInfo();
  }
  
  /**
   * Get the type of search engine
   */
  public getType(): string {
    return this.core.getType();
  }
  
  /**
   * Get OpenSearch version
   */
  public async getVersion(): Promise<string> {
    return this.core.getVersion();
  }
  
  /**
   * Check if a feature is supported
   */
  public supportsFeature(feature: string): boolean {
    return this.core.supportsFeature(feature);
  }
}