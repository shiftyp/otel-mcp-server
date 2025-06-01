import { logger } from '../../../utils/logger.js';
import { Client, ApiResponse } from '@opensearch-project/opensearch';
import { getOpenSearchClient } from '../client.js';

// Define interfaces for OpenSearch search parameters and response types
interface SearchRequest {
  index?: string;
  size?: number;
  from?: number;
  sort?: any;
  query?: any;
  search?: string;
  body?: any;
  [key: string]: any;
}

interface SearchResponse {
  hits: {
    hits: Array<{ _id: string; _source: Record<string, unknown> }>;
    total: { value: number };
  };
  [key: string]: any;
}

/**
 * OpenSearch Logs Search Adapter
 * Provides functionality for searching and retrieving OpenTelemetry logs data from OpenSearch
 */
export class LogsSearchAdapter {
  private client: Client;

  constructor(options?: { [key: string]: unknown }) {
    // Use the singleton client
    this.client = getOpenSearchClient();
    logger.info('[LogsSearchAdapter] Using singleton OpenSearch client');
  }
  
  /**
   * Query logs with custom query (required by LogsAdapterCore)
   * @param query The query object
   */
  public async queryLogs(query: SearchRequest): Promise<ApiResponse> {
    logger.info('[OpenSearch LogsSearchAdapter] queryLogs called');
    // Delegate to searchLogs for implementation
    return this.searchLogs(query);
  }
  
  /**
   * List available log fields (required by LogsAdapterCore)
   * @param includeSourceDoc Whether to include source document fields
   */
  public async listLogFields(includeSourceDoc?: boolean): Promise<string[]> {
    logger.info('[OpenSearch LogsSearchAdapter] listLogFields called');
    // Delegate to getLogFields for implementation
    return this.getLogFields();
  }
  
  /**
   * Query metrics with custom query (required by LogsAdapterCore)
   * @param query The query object
   */
  public async searchMetrics(query: SearchRequest): Promise<ApiResponse> {
    logger.info('[OpenSearch LogsSearchAdapter] searchMetrics called but not implemented in this adapter');
    throw new Error('searchMetrics not implemented in LogsSearchAdapter');
  }
  
  /**
   * Query traces with custom query (required by LogsAdapterCore)
   * @param query The query object
   */
  public async queryTraces(query: SearchRequest): Promise<ApiResponse> {
    logger.info('[OpenSearch LogsSearchAdapter] queryTraces called but not implemented in this adapter');
    throw new Error('queryTraces not implemented in LogsSearchAdapter');
  }

  /**
   * Search for logs based on a query
   */
  public async searchLogs(query: SearchRequest): Promise<ApiResponse> {
    logger.info('[OpenSearch LogsSearchAdapter] Searching logs', { query });
    
    try {
      // Use the known working index pattern
      const indexPattern = 'logs-generic-default';
      
      // If the query has a search property, convert it to a query_string query
      if (query.search && typeof query.search === 'string') {
        query.query = {
          query_string: {
            query: query.search,
            default_field: "text_content",
            fields: ["text_content", "body", "message", "log.message"]
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
      
      // Include text_content and vector fields in source if not specified
      if (!query._source) {
        query._source = { includes: ["*", "text_content", "text_content.vector"] };
      } else if (query._source.includes && Array.isArray(query._source.includes)) {
        if (!query._source.includes.includes("text_content")) {
          query._source.includes.push("text_content");
        }
        if (!query._source.includes.includes("text_content.vector")) {
          query._source.includes.push("text_content.vector");
        }
      }
      
      // Extract index from query if provided, otherwise use default index pattern
      const searchIndex = query.index || indexPattern;
      
      // Create a clean copy of the query without the index property
      const queryBody = { ...query };
      delete queryBody.index; // Remove index from the body to prevent parsing errors
      
      // Use the client directly to search
      const response = await this.client.search({
        index: searchIndex,
        body: queryBody
      });
      
      return response;
    } catch (error: unknown) {
      logger.error('[OpenSearch LogsSearchAdapter] Error searching logs', { error });
      // Create a proper ApiResponse object with error information
      return {
        body: {
          hits: {
            total: { value: 0 },
            hits: []
          }
        },
        statusCode: 500,
        headers: null,
        warnings: null,
        meta: {
          context: null,
          name: 'search_error',
          request: {
            params: { method: 'POST', path: '/logs-*/_search', body: query },
            options: {},
            id: null
          },
          connection: null as any,
          attempts: 0,
          aborted: false
        }
      };
    }
  }
  
  /**
   * Get log fields with optional search filter and service filter
   * @param search Optional search pattern to filter fields
   * @param serviceFilter Optional service or services to filter fields
   * @param useSourceDocument Whether to include source document fields
   */
  public async getLogFields(search?: string, serviceFilter?: string | string[], useSourceDocument = true): Promise<string[]> {
    logger.info('[OpenSearch LogsSearchAdapter] Getting log fields', { search, serviceFilter, useSourceDocument });
    
    try {
      // Use the known working index pattern
      const indexPattern = 'logs-generic-default';
      
      // Get field mappings from OpenSearch
      const response = await this.client.indices.getMapping({
        index: indexPattern
      });
      
      // Extract fields from the mapping response
      const fields: string[] = [];
      
      // Process each index in the response
      const body = response.body;
      for (const indexName in body) {
        if (Object.prototype.hasOwnProperty.call(body, indexName)) {
          const index = body[indexName];
          const properties = index.mappings?.properties || {};
          
          // Process each field in the index
          this.extractFieldsFromProperties(properties, '', fields);
        }
      }
      
      // Filter fields if search is provided
      if (search) {
        const searchLower = search.toLowerCase();
        return fields.filter((field) => field.toLowerCase().includes(searchLower));
      }
      
      return fields;
    } catch (error) {
      logger.error('[OpenSearch LogsSearchAdapter] Error getting log fields', { error });
      return [];
    }
  }

  /**
   * Recursively extract field names from OpenSearch mapping properties
   * @param properties The properties object from the mapping
   * @param prefix The current field name prefix
   * @param fields Array to store the extracted field names
   */
  private extractFieldsFromProperties(properties: Record<string, any>, prefix: string, fields: string[]): void {
    for (const fieldName in properties) {
      if (Object.prototype.hasOwnProperty.call(properties, fieldName)) {
        const field = properties[fieldName];
        const fullFieldName = prefix ? `${prefix}.${fieldName}` : fieldName;
        
        // Add the field to the list
        fields.push(fullFieldName);
        
        // If the field has nested properties, process them recursively
        if (field.properties) {
          this.extractFieldsFromProperties(field.properties, fullFieldName, fields);
        }
        
        // If the field has a nested type with properties, process them
        if (field.type === 'nested' && field.properties) {
          this.extractFieldsFromProperties(field.properties, fullFieldName, fields);
        }
      }
    }
  }
}
