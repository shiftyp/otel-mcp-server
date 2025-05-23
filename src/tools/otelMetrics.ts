import { ElasticsearchAdapter } from '../adapters/elasticsearch/index.js';
import { groupMetricSchemasByMetricName, GroupedMetricSchemas, getAllMetricFieldPaths, getMetricSchemasWithFields } from '../adapters/metricSchemas.js';

/**
 * Tools for querying and aggregating OTEL metrics.
 */
export class OtelMetricsTools {
  private esAdapter: ElasticsearchAdapter;

  constructor(esAdapter: ElasticsearchAdapter) {
    this.esAdapter = esAdapter;
  }

  /** 
   * Aggregate OTEL metrics for a time range and bucket. 
   * @param startTime Start time in ISO 8601 format
   * @param endTime End time in ISO 8601 format
   * @param metricField Optional metric field to aggregate (e.g., 'metric.value')
   * @param service Optional service name to filter by
   */
  async aggregateOtelMetricsRange(startTime: string, endTime: string, metricField?: string, service?: string) {
    return this.esAdapter.aggregateOtelMetricsRange(startTime, endTime, metricField, service);
  }

  /**
   * Get grouped metric schemas by metric name.
   * @param search Optional search term to filter results
   */
  async getGroupedMetricSchemas(search?: string): Promise<GroupedMetricSchemas> {
    const schemas = await groupMetricSchemasByMetricName(this.esAdapter.callEsRequest.bind(this.esAdapter));
    
    // If no search term, return all schemas
    if (!search || search.trim() === '') return schemas;
    
    // Filter schemas by search term
    const s = search.toLowerCase();
    const filteredSchemas: GroupedMetricSchemas = {};
    
    for (const [metricName, schema] of Object.entries(schemas)) {
      if (metricName.toLowerCase().includes(s)) {
        filteredSchemas[metricName] = schema;
      }
    }
    
    return filteredSchemas;
  }

  /**
   * Get a searchable list of all metric fields (dot notation)
   * @param search Optional search term to filter fields
   * @param serviceOrServices Optional service name or array of services to filter fields by
   * @returns Array of field paths
   */
  async getAllMetricFields(search?: string, serviceOrServices?: string | string[]): Promise<string[]> {
    // If no service filter, use the standard approach
    if (!serviceOrServices) {
      const allFields: string[] = await getAllMetricFieldPaths(this.esAdapter.callEsRequest.bind(this.esAdapter));
      if (!search || search.trim() === '') return allFields;
      const s = search.toLowerCase();
      return allFields.filter((f: string) => f.toLowerCase().includes(s));
    }
    
    // Convert service parameter to array for consistent handling
    const services = Array.isArray(serviceOrServices) ? serviceOrServices : [serviceOrServices];
    
    // Build a query to get a sample of documents from the specified services
    const query = {
      size: 100,
      query: {
        bool: {
          must: [
            { exists: { field: '@timestamp' } }
          ],
          filter: [
            { terms: { 'resource.service.name': services } }
          ]
        }
      },
      _source: ['*']
    };
    
    // Execute the query to get sample documents
    const response = await this.esAdapter.queryMetrics(query);
    const hits = response.hits?.hits || [];
    
    if (hits.length === 0) {
      return [];
    }
    
    // Extract all field paths from the sample documents
    const fieldSet = new Set<string>();
    
    // Helper function to recursively extract field paths
    const extractFields = (obj: any, path = '') => {
      if (!obj || typeof obj !== 'object') return;
      
      Object.entries(obj).forEach(([key, value]) => {
        const currentPath = path ? `${path}.${key}` : key;
        fieldSet.add(currentPath);
        
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          extractFields(value, currentPath);
        }
      });
    };
    
    // Process each document
    hits.forEach((hit: any) => {
      extractFields(hit._source);
    });
    
    // Convert to array and apply search filter if provided
    let fields = Array.from(fieldSet);
    
    if (search && search.trim() !== '') {
      const s = search.toLowerCase();
      fields = fields.filter(f => f.toLowerCase().includes(s));
    }
    
    return fields;
  }

  /**
   * Get a map of metrics to additional filter fields (siblings), also searchable
   */
  async getMetricSchemasWithFields(search?: string): Promise<Record<string, string[]>> {
    const schemas: Array<{ metric: string; fields: string[] }> = await getMetricSchemasWithFields(this.esAdapter.callEsRequest.bind(this.esAdapter));
    let filtered: Array<{ metric: string; fields: string[] }> = schemas;
    if (search && search.trim() !== '') {
      const s = search.toLowerCase();
      filtered = schemas.filter(({ metric, fields }) =>
        metric.toLowerCase().includes(s) || fields.some((f: string) => f.toLowerCase().includes(s))
      );
    }
    // Convert to map for easy use
    const result: Record<string, string[]> = {};
    for (const item of filtered) {
      const { metric, fields } = item as { metric: string; fields: string[] };
      result[metric] = fields;
    }
    return result;
  }


}
