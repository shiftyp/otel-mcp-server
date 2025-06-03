import { logger } from '../../../utils/logger.js';
import { MetricsAdapterCore } from './metricCore.js';

/**
 * OpenSearch Metrics Search Adapter
 * Provides functionality for searching and retrieving OpenTelemetry metrics data from OpenSearch
 */
export class MetricsSearchAdapter extends MetricsAdapterCore {
  constructor(options: any) {
    super(options);
  }

  /**
   * Search for metrics based on a query
   */
  public async searchMetrics(query: any): Promise<any> {
    logger.info('[OpenSearch MetricsSearchAdapter] Searching metrics', { query });
    
    try {
      // Use the index pattern for metrics
      const indexPattern = 'metrics-*';
      
      // If the query has a search property, convert it to a query_string query
      if (query.search && typeof query.search === 'string') {
        query.query = {
          query_string: {
            query: query.search
          }
        };
        delete query.search;
      }
      
      // Add default sort if not specified
      if (!query.sort) {
        query.sort = [{ '@timestamp': { order: 'desc' } }];
      }
      
      // Add default size if not specified
      if (!query.size) {
        query.size = 100;
      }
      
      const response = await this.request('POST', `/${indexPattern}/_search`, query);
      return response;
    } catch (error: any) {
      logger.error('[OpenSearch MetricsSearchAdapter] Error searching metrics', { error });
      return {
        hits: {
          total: { value: 0 },
          hits: []
        },
        error: error.message || error
      };
    }
  }
  
  /**
   * Get metric fields with optional search filter and service filter
   * @param search Optional search pattern to filter fields
   * @param serviceFilter Optional service or services to filter fields
   * @param useSourceDocument Whether to include source document fields
   */
  public async getMetricFields(search?: string, serviceFilter?: string | string[], useSourceDocument: boolean = false): Promise<any[]> {
    logger.info('[OpenSearch MetricsSearchAdapter] Getting metric fields', { search, serviceFilter, useSourceDocument });
    
    try {
      // Use the index pattern for metrics
      const indexPattern = 'metrics-*';
      
      // Get field mappings from OpenSearch
      const response = await this.request('GET', `/${indexPattern}/_mapping`, {});
      
      // Extract fields from the mapping response
      const fields: any[] = [];
      
      // Process each index in the response
      for (const indexName in response) {
        if (Object.prototype.hasOwnProperty.call(response, indexName)) {
          const index = response[indexName];
          const properties = index.mappings?.properties || {};
          
          // Process each field in the index
          this.extractMetricFields(properties, '', fields);
        }
      }
      
      // Filter fields by search term if provided
      if (search) {
        const searchLower = search.toLowerCase();
        return fields.filter(field => field.name.toLowerCase().includes(searchLower));
      }
      
      return fields;
    } catch (error) {
      logger.error('[OpenSearch MetricsSearchAdapter] Error getting metric fields', { error });
      return [];
    }
  }
}
