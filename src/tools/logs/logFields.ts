import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { logger } from '../../utils/logger.js';
import { getFieldStats, FieldInfo } from '../../adapters/schemas/fieldSchemas.js';

// Define interface for field stats returned by getFieldStats
interface FieldStat {
  field: string;
  count: number;
}

/**
 * Tool for searching and analyzing log fields
 */
export class LogFieldsTool {
  private searchAdapter: ElasticsearchAdapter;

  constructor(searchAdapter: ElasticsearchAdapter) {
    this.searchAdapter = searchAdapter;
  }

  /**
   * Get log field definitions with co-occurring fields
   * @param search Optional search term to filter fields
   * @param serviceOrServices Optional service name or array of services to filter fields by
   * @param useSourceDocument Whether to include source document fields (default: true for logs)
   * @returns Array of field information objects
   */
  async getLogFields(
    search?: string,
    serviceOrServices?: string | string[],
    useSourceDocument?: boolean
  ): Promise<FieldInfo[]> {
    try {
      logger.debug('[LogFieldsTool] getLogFields called', { search, serviceOrServices, useSourceDocument });
      
      // Get all log fields from the search engine
      // Using any type assertion since the adapter method might not be properly typed
      // Default to true if useSourceDocument is undefined
      const includeSourceDoc = useSourceDocument === undefined ? true : useSourceDocument;
      const logFields = await (this.searchAdapter as any).listLogFields(includeSourceDoc);
      
      // Filter fields by search term if provided
      let filteredFields = logFields;
      if (search) {
        const searchLower = search.toLowerCase();
        filteredFields = logFields.filter((field: any) => 
          field.name.toLowerCase().includes(searchLower)
        );
      }
      
      // Filter by service if provided
      if (serviceOrServices) {
        // Get field stats for the filtered fields, passing the service filter
        const fieldStats = await getFieldStats(
          this.searchAdapter,
          '.ds-logs-*',
          undefined, // No additional field name filtering here
          serviceOrServices // Pass the service or services directly
        );
        
        // Only keep fields that exist in the service(s)
        filteredFields = filteredFields.filter((field: any) => {
          const stats = fieldStats.find((s: any) => s.name === field.name);
          return stats && stats.count > 0;
        });
      }
      
      // Get co-occurring fields for each field
      const fieldsWithCoOccurring = await Promise.all(
        filteredFields.map(async (field: any) => {
          try {
            // Skip getting co-occurring fields for fields with high cardinality
            // or fields that are likely to be present in all documents
            if (
              field.name === '@timestamp' || 
              field.name === 'resource.attributes.service.name' ||
              field.name === 'body'
            ) {
              return {
                ...field,
                coOccurringFields: []
              };
            }
            
            // Get co-occurring fields
            const coOccurringFields = await this.getCoOccurringFields(
              field.name,
              serviceOrServices
            );
            
            return {
              ...field,
              coOccurringFields
            };
          } catch (error) {
            logger.warn('[LogFieldsTool] Error getting co-occurring fields', {
              field: field.name,
              error: error instanceof Error ? error.message : String(error)
            });
            
            return {
              ...field,
              coOccurringFields: []
            };
          }
        })
      );
      
      // Sort fields by name
      fieldsWithCoOccurring.sort((a: any, b: any) => a.name.localeCompare(b.name));
      
      logger.debug('[LogFieldsTool] getLogFields result', { 
        fieldCount: fieldsWithCoOccurring.length,
        sampleFields: fieldsWithCoOccurring.slice(0, 5)
      });
      
      return fieldsWithCoOccurring;
    } catch (error) {
      logger.error('[LogFieldsTool] getLogFields error', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  /**
   * Get fields that co-occur with the specified field
   * @param fieldName Field name to find co-occurring fields for
   * @param serviceOrServices Optional service name or array of services to filter by
   * @returns Array of co-occurring field names
   */
  private async getCoOccurringFields(
    fieldName: string,
    serviceOrServices?: string | string[]
  ): Promise<string[]> {
    try {
      // Build query to find documents containing the field
      const query: any = {
        bool: {
          must: [
            {
              exists: {
                field: fieldName
              }
            }
          ]
        }
      };
      
      // Add service filter if provided
      if (serviceOrServices) {
        // Convert single service to array
        const services = Array.isArray(serviceOrServices) ? serviceOrServices : [serviceOrServices];
        
        // Build service queries
        const serviceQueries = services.map(service => ({
          match_phrase: {
            'service.name': service
          }
        }));
        
        // Add to main query
        query.bool.must.push({
          bool: {
            should: serviceQueries,
            minimum_should_match: 1
          }
        });
      }
      
      // Execute query to get a sample of documents
      const response = await this.searchAdapter.callRequest('POST', '/.ds-logs-*/_search', {
        query: {
          exists: {
            field: fieldName
          }
        },
        size: 10,
        _source: true
      });
      
      // Extract all field names from the documents
      const allFields = new Set<string>();
      if (response.hits && response.hits.hits) {
        for (const hit of response.hits.hits) {
          if (hit._source) {
            this.extractFieldNames(hit._source, '', allFields);
          }
        }
      }
      
      // Remove the original field
      allFields.delete(fieldName);
      
      // Convert to array and sort
      return Array.from(allFields).sort();
    } catch (error) {
      logger.error('[LogFieldsTool] getCoOccurringFields error', { 
        fieldName,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      return [];
    }
  }

  /**
   * Recursively extract field names from an object
   * @param obj Object to extract field names from
   * @param prefix Current field path prefix
   * @param result Set to collect field names
   */
  private extractFieldNames(obj: any, prefix: string, result: Set<string>): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }
    
    for (const key in obj) {
      const fullPath = prefix ? `${prefix}.${key}` : key;
      result.add(fullPath);
      
      if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        this.extractFieldNames(obj[key], fullPath, result);
      }
    }
  }
}
