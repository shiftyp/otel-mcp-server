import { OpenSearchSubAdapter } from '../../core/baseAdapter.js';
import { logger } from '../../../../utils/logger.js';
import { ILogsAdapter } from './interface.js';

/**
 * Core logs adapter for OpenSearch
 * Provides base functionality for querying and manipulating log data
 */
export class LogsCoreAdapter extends OpenSearchSubAdapter implements ILogsAdapter {
  protected logsIndex: string;
  
  constructor(options: any) {
    super(options);
    // Will use centralized index from core.getLogsIndex()
    this.logsIndex = ''; // This will be overridden by getLogsIndex() method
  }
  
  /**
   * Get the logs index from centralized configuration
   */
  private getLogsIndex(): string {
    // Use the centralized method from core
    return this.core.getLogsIndex();
  }

  /**
   * Query logs index
   */
  public async searchLogs(query: any): Promise<any> {
    return this.request('POST', `/${this.getLogsIndex()}/_search`, query);
  }
  
  /**
   * Query logs with a custom query
   */
  public async queryLogs(query: any): Promise<any> {
    const searchQuery = { ...query };
    
    // Convert search parameter to query_string if provided
    if (searchQuery.search && typeof searchQuery.search === 'string') {
      searchQuery.query = {
        query_string: {
          query: searchQuery.search,
          default_field: '*',
          default_operator: 'AND'
        }
      };
      delete searchQuery.search;
    }
    
    return this.searchLogs(searchQuery);
  }
  
  /**
   * Get log fields from mapping
   */
  public async getLogFields(): Promise<any[]> {
    const response = await this.request('GET', `/${this.getLogsIndex()}/_mapping`);
    
    const fields: any[] = [];
    for (const index in response) {
      const mappings = response[index].mappings;
      if (mappings && mappings.properties) {
        this.extractLogFields(mappings.properties, '', fields);
      }
    }
    
    return fields;
  }
  
  /**
   * Helper to extract log field information from mapping
   */
  protected extractLogFields(properties: any, path: string, fields: any[]): void {
    for (const field in properties) {
      const fullPath = path ? `${path}.${field}` : field;
      const fieldInfo = properties[field];
      
      // Add field info
      fields.push({
        field: fullPath,
        type: fieldInfo.type || 'object',
        properties: fieldInfo.properties ? Object.keys(fieldInfo.properties) : undefined
      });
      
      // Recursively handle nested fields
      if (fieldInfo.properties) {
        this.extractLogFields(fieldInfo.properties, fullPath, fields);
      }
    }
  }

  /**
   * Legacy method for compatibility
   */
  protected extractFields(
    properties: any, 
    path: string, 
    fields: any[], 
    processedFields: Set<string>, 
    prefix?: string
  ): void {
    this.extractLogFields(properties, path, fields);
  }

  /**
   * Get aggregation of log levels
   */
  public async getLogLevelStats(
    timeRange?: { from: string; to: string },
    service?: string
  ): Promise<Record<string, number>> {
    const query: any = {
      size: 0,
      query: { bool: { filter: [] } },
      aggs: {
        levels: {
          terms: {
            field: 'level.keyword',
            size: 10
          }
        }
      }
    };

    if (timeRange) {
      query.query.bool.filter.push({
        range: {
          '@timestamp': {
            gte: timeRange.from,
            lte: timeRange.to
          }
        }
      });
    }

    if (service) {
      query.query.bool.filter.push({
        term: { 'service.name.keyword': service }
      });
    }

    const response = await this.searchLogs(query);
    const buckets = response.aggregations?.levels?.buckets || [];
    
    const stats: Record<string, number> = {};
    for (const bucket of buckets) {
      stats[bucket.key] = bucket.doc_count;
    }
    
    return stats;
  }

  /**
   * Get service list from logs
   */
  public async getServices(
    timeRange?: { from: string; to: string }
  ): Promise<string[]> {
    const query: any = {
      size: 0,
      aggs: {
        services: {
          terms: {
            field: 'service.name.keyword',
            size: 100
          }
        }
      }
    };

    if (timeRange) {
      query.query = {
        range: {
          '@timestamp': {
            gte: timeRange.from,
            lte: timeRange.to
          }
        }
      };
    }

    const response = await this.searchLogs(query);
    const buckets = response.aggregations?.services?.buckets || [];
    
    return buckets.map((b: any) => b.key);
  }
}