import { logger } from '../../../utils/logger.js';
import { LogsAdapterCore } from './logCore.js';

/**
 * OpenSearch Logs Search Adapter
 * Provides functionality for searching and retrieving OpenTelemetry logs data from OpenSearch
 */
export class LogsSearchAdapter extends LogsAdapterCore {
  constructor(options: any) {
    super(options);
  }

  /**
   * Search for logs based on a query
   */
  public async searchLogs(query: any): Promise<any> {
    logger.info('[OpenSearch LogsSearchAdapter] Searching logs', { query });
    
    try {
      // Use the index pattern for logs
      const indexPattern = 'logs-*';
      
      // If the query has a search property, convert it to a query_string query
      if (query.search && typeof query.search === 'string') {
        query.query = {
          query_string: {
            query: query.search,
            default_field: "body",
            fields: ["body", "Body", "message", "Message", "log.message"]
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
      logger.error('[OpenSearch LogsSearchAdapter] Error searching logs', { error });
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
   * Get log fields with optional search filter
   */
  public async getLogFields(search?: string): Promise<any[]> {
    logger.info('[OpenSearch LogsSearchAdapter] Getting log fields', { search });
    
    try {
      // Use the index pattern for logs
      const indexPattern = 'logs-*';
      
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
          this.extractFields(properties, '', fields);
        }
      }
      
      // Filter fields by search term if provided
      if (search) {
        const searchLower = search.toLowerCase();
        return fields.filter(field => field.name.toLowerCase().includes(searchLower));
      }
      
      return fields;
    } catch (error) {
      logger.error('[OpenSearch LogsSearchAdapter] Error getting log fields', { error });
      return [];
    }
  }
}
