import { ElasticsearchAdapter } from '../adapters/elasticsearch/index.js';
import { logger } from '../utils/logger.js';
import { getFieldStats, FieldInfo } from '../adapters/fieldSchemas.js';

/**
 * Tool for searching and analyzing log fields
 */
export class LogFieldsTool {
  private esAdapter: ElasticsearchAdapter;

  constructor(esAdapter: ElasticsearchAdapter) {
    this.esAdapter = esAdapter;
  }

  /**
   * Get log field definitions with co-occurring fields
   * @param search Optional search term to filter fields
   * @param serviceOrServices Optional service name or array of services to filter fields by
   * @returns Array of field information objects
   */
  async getLogFields(search?: string, serviceOrServices?: string | string[]): Promise<FieldInfo[]> {
    try {
      logger.info('[LogFieldsTool] Getting log fields', { search, serviceOrServices });
      
      // Use a more inclusive logs index pattern to match OpenTelemetry data
      // This will search across all indices that might contain log data
      const indexPattern = 'logs*,*logs*';
      
      // If service filtering is requested, we need to take a different approach
      if (serviceOrServices) {
        // Convert service parameter to array for consistent handling
        const services = Array.isArray(serviceOrServices) ? serviceOrServices : [serviceOrServices];
        
        // Build a query to get a sample of logs from the specified services
        const query = {
          size: 100,
          query: {
            bool: {
              must: [
                { exists: { field: '@timestamp' } }
              ],
              filter: [
                {
                  bool: {
                    should: [
                      { terms: { 'resource.service.name': services } },
                      { terms: { 'Resource.service.name': services } },
                      { terms: { 'service.name': services } }
                    ],
                    minimum_should_match: 1
                  }
                }
              ]
            }
          },
          // Ensure we get the full source document to access all fields including ignored ones
          _source: true
        };
        
        // Execute the query to get sample logs
        const response = await this.esAdapter.queryLogs(query);
        const hits = response.hits?.hits || [];
        
        if (hits.length === 0) {
          logger.info('[LogFieldsTool] No logs found for the specified services', { services });
          return [];
        }
        
        // Extract all field paths from the sample logs
        const fieldSet = new Set<string>();
        const fieldTypes: Record<string, string> = {};
        const fieldCounts: Record<string, number> = {};
        
        // Helper function to recursively extract field paths
        const extractFields = (obj: any, path = '') => {
          if (!obj || typeof obj !== 'object') return;
          
          Object.entries(obj).forEach(([key, value]) => {
            const currentPath = path ? `${path}.${key}` : key;
            fieldSet.add(currentPath);
            
            // Determine field type
            if (value === null) {
              fieldTypes[currentPath] = 'null';
            } else if (Array.isArray(value)) {
              fieldTypes[currentPath] = 'array';
            } else {
              fieldTypes[currentPath] = typeof value;
            }
            
            // Increment field count
            fieldCounts[currentPath] = (fieldCounts[currentPath] || 0) + 1;
            
            if (value && typeof value === 'object' && !Array.isArray(value)) {
              extractFields(value, currentPath);
            }
          });
        };
        
        // Process each log
        hits.forEach((hit: any) => {
          extractFields(hit._source);
        });
        
        // Convert to FieldInfo array
        const fields: FieldInfo[] = Array.from(fieldSet).map(name => ({
          name,
          type: fieldTypes[name] || 'unknown',
          path: name,
          count: fieldCounts[name] || 0,
          schema: { type: fieldTypes[name] || 'unknown' }
        }));
        
        // Apply search filter if provided
        let filteredFields = fields;
        if (search && search.trim() !== '') {
          const s = search.toLowerCase();
          filteredFields = fields.filter(field => field.name.toLowerCase().includes(s));
        }
        
        logger.info('[LogFieldsTool] Retrieved log fields for specific services', { 
          count: filteredFields.length,
          services,
          search 
        });
        
        return filteredFields;
      }
      
      // If no service filter, use the standard approach with field mappings
      const fields = await getFieldStats(this.esAdapter, indexPattern, search);
      
      logger.info('[LogFieldsTool] Retrieved log fields', { 
        count: fields.length,
        search 
      });
      
      return fields;
    } catch (error) {
      logger.error('[LogFieldsTool] Error getting log fields', { 
        search,
        error: error instanceof Error ? error.message : String(error) 
      });
      return [];
    }
  }
}
