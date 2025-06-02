import { OpenSearchCore } from '../core/core.js';
import { SearchEngineType } from '../../base/searchAdapter.js';
import { logger } from '../../../utils/logger.js';

/**
 * OpenSearch Traces Adapter Core
 * Provides base functionality for working with OpenTelemetry traces data in OpenSearch
 */
export class TracesAdapterCore extends OpenSearchCore {
  constructor(options: any) {
    super(options);
  }

  /**
   * Make a request to OpenSearch
   */
  public async request(method: string, url: string, body: any) {
    return this.callRequest(method, url, body);
  }
  
  /**
   * Get the search engine type (OpenSearch or Elasticsearch)
   */
  public async getEngineType(): Promise<SearchEngineType> {
    try {
      // Use callRequest to get the info endpoint
      const info = await this.callRequest('GET', '/', {});
      
      // Check for OpenSearch specific fields in the response
      if (info.version?.distribution === 'opensearch' || info.tagline?.includes('OpenSearch')) {
        return SearchEngineType.OPENSEARCH;
      }
      
      // Check if the version string includes 'opensearch'
      const version = info.version?.number || '';
      if (version.includes('opensearch')) {
        return SearchEngineType.OPENSEARCH;
      }
      
      // For OpenSearch 2.x, check if the version is in the 2.x range
      // and if the response has OpenSearch-specific fields
      if (version.startsWith('2.') && info.version?.build_type) {
        // This is likely OpenSearch 2.x
        return SearchEngineType.OPENSEARCH;
      }
      
      // Default to Elasticsearch if none of the above conditions are met
      return SearchEngineType.ELASTICSEARCH;
    } catch (error) {
      logger.warn('Failed to detect engine type, defaulting to OpenSearch', { error });
      return SearchEngineType.OPENSEARCH;
    }
  }
  
  /**
   * Perform a search query
   */
  public async search(params: any) {
    try {
      // Use the specific traces-generic-default index that exists in the system
      let { index, body } = params;
      if (!index) {
        index = 'traces-generic-default';
      }
      return await this.callRequest('POST', `/${index}/_search`, body);
    } catch (error) {
      logger.error('Search query failed', { error, params });
      throw error;
    }
  }
}
