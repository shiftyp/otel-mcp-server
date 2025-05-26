import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { logger } from '../../utils/logger.js';
import { getFieldStats, FieldInfo } from '../../adapters/schemas/fieldSchemas.js';

// Define interface for field stats returned by getFieldStats
interface FieldStat {
  field: string;
  count: number;
}

/**
 * Tool for searching and analyzing trace fields
 */
export class TraceFieldsTool {
  private esAdapter: ElasticsearchAdapter;

  constructor(esAdapter: ElasticsearchAdapter) {
    this.esAdapter = esAdapter;
  }

  /**
   * Get trace field definitions with co-occurring fields
   * @param search Optional search term to filter fields
   * @param serviceOrServices Optional service name or array of services to filter fields by
   * @param useSourceDocument Whether to include source document fields (default: false for traces)
   * @returns Array of field information objects
   */
  async getTraceFields(search?: string, serviceOrServices?: string | string[], useSourceDocument: boolean = false): Promise<FieldInfo[]> {
    try {
      logger.info('[TraceFieldsTool] Getting trace fields', { search, serviceOrServices });
      
      // Use the traces index pattern
      const indexPattern = 'traces-*';
      
      // If service filtering is requested, we need to take a different approach
      if (serviceOrServices) {
        // Convert service parameter to array for consistent handling
        const services = Array.isArray(serviceOrServices) ? serviceOrServices : [serviceOrServices];
        
        // Build a query to get a sample of spans from the specified services
        const query = {
          size: 100,
          query: {
            bool: {
              must: [
                { exists: { field: 'span.id' } }
              ],
              filter: [
                { terms: { 'resource.service.name': services } }
              ]
            }
          },
          // Use _source parameter based on useSourceDocument setting
          _source: useSourceDocument ? true : ['*']
        };
        
        // Execute the query to get sample spans
        const response = await this.esAdapter.queryTraces(query);
        const hits = response.hits?.hits || [];
        
        if (hits.length === 0) {
          logger.info('[TraceFieldsTool] No spans found for the specified services', { services });
          return [];
        }
        
        // Extract all field paths from the sample spans
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
        
        // Process each span
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
        
        logger.info('[TraceFieldsTool] Retrieved trace fields for specific services', { 
          count: filteredFields.length,
          services,
          search 
        });
        
        return filteredFields;
      }
      
      // If no service filter, use the standard approach with field mappings
      const fields = await getFieldStats(this.esAdapter, indexPattern, search);
      
      logger.info('[TraceFieldsTool] Retrieved trace fields', { 
        count: fields.length,
        search 
      });
      
      return fields;
    } catch (error) {
      logger.error('[TraceFieldsTool] Error getting trace fields', { 
        search,
        error: error instanceof Error ? error.message : String(error) 
      });
      return [];
    }
  }
}
