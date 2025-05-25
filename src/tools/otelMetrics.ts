import { ElasticsearchAdapter } from '../adapters/elasticsearch/index.js';
import { groupMetricSchemasByMetricName, GroupedMetricSchemas, getAllMetricFieldPaths, getMetricSchemasWithFields } from '../adapters/metricSchemas.js';
import { logger } from '../utils/logger.js';

/**
 * Enum representing different types of metrics
 */
export enum MetricType {
  GAUGE = 'gauge',
  COUNTER = 'counter',
  MONOTONIC_COUNTER = 'monotonic_counter',
  ENUM = 'enum',
  UNKNOWN = 'unknown'
}

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
   * Get a searchable list of all metric fields (dot notation) with co-occurring fields
   * @param search Optional search term to filter fields
   * @param serviceOrServices Optional service name or array of services to filter fields by
   * @param useSourceDocument Whether to include source document fields (default: false for metrics)
   * @returns Object containing fields array and co-occurrences map
   */
  async getAllMetricFields(search?: string, serviceOrServices?: string | string[], useSourceDocument: boolean = false): Promise<{ fields: string[], coOccurrences: Record<string, string[]> }> {
    // If no service filter, use the standard approach
    if (!serviceOrServices) {
      const allFields: string[] = await getAllMetricFieldPaths(this.esAdapter.callEsRequest.bind(this.esAdapter));
      
      // Apply search filter if provided
      let filteredFields = allFields;
      if (search && search.trim() !== '') {
        const s = search.toLowerCase();
        filteredFields = allFields.filter(f => f.toLowerCase().includes(s));
      }
      
      // Since we don't have document data in this case, return with empty co-occurrences
      return {
        fields: filteredFields,
        coOccurrences: {}
      };
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
          filter: services.length > 0 ? [
            { terms: { 'service.name': services } }
          ] : []
        }
      },
      // Use _source parameter based on useSourceDocument setting
      _source: useSourceDocument ? true : ['*']
    };
    
    // Execute the query to get sample documents
    const response = await this.esAdapter.queryMetrics(query);
    const hits = response.hits?.hits || [];
    
    if (hits.length === 0) {
      return {
        fields: [],
        coOccurrences: {}
      };
    }
    
    // Extract all field paths and track co-occurring fields
    const fieldSet = new Set<string>();
    const fieldCoOccurrences: Record<string, Set<string>> = {};
    
    // Helper function to recursively extract field paths
    const extractFields = (obj: any, path = '', result: string[] = []) => {
      if (!obj || typeof obj !== 'object') return result;
      
      Object.entries(obj).forEach(([key, value]) => {
        const currentPath = path ? `${path}.${key}` : key;
        result.push(currentPath);
        fieldSet.add(currentPath);
        
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          extractFields(value, currentPath, result);
        }
      });
      
      return result;
    };
    
    // Process each document to find co-occurring fields
    hits.forEach((hit: any) => {
      const docFields = extractFields(hit._source);
      
      // Update co-occurrence information for each field in this document
      docFields.forEach(field => {
        if (!fieldCoOccurrences[field]) {
          fieldCoOccurrences[field] = new Set<string>();
        }
        
        // Add all other fields as co-occurring with this field
        docFields.forEach(coField => {
          if (field !== coField) {
            fieldCoOccurrences[field].add(coField);
          }
        });
      });
    });
    
    // Convert to array and apply search filter if provided
    let fields = Array.from(fieldSet);
    
    if (search && search.trim() !== '') {
      const s = search.toLowerCase();
      fields = fields.filter(f => f.toLowerCase().includes(s));
    }
    
    // Return field paths along with co-occurrence information
    return {
      fields,
      coOccurrences: Object.fromEntries(
        Object.entries(fieldCoOccurrences).map(([field, coFields]) => [
          field, 
          Array.from(coFields).sort()
        ])
      )
    };
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

  /**
   * Detect the type of a metric based on its behavior in a time series
   * @param metricField The metric field to analyze
   * @param startTime Start time in ISO 8601 format
   * @param endTime End time in ISO 8601 format
   * @param serviceOrServices Optional service name or array of services to filter by
   * @returns The detected metric type
   */
  async detectMetricType(
    metricField: string,
    startTime: string,
    endTime: string,
    serviceOrServices?: string | string[]
  ): Promise<MetricType> {
    try {
      // Build query to get time series data for the metric
      const must: any[] = [
        { range: { '@timestamp': { gte: startTime, lte: endTime } } },
        { exists: { field: metricField } }
      ];
      
      // Add service filter if provided
      if (serviceOrServices) {
        if (Array.isArray(serviceOrServices) && serviceOrServices.length > 0) {
          // Handle array of services
          const serviceTerms: any[] = [];
          
          // For each service, create terms for all possible field names
          serviceOrServices.forEach(service => {
            if (service && service.trim() !== '') {
              serviceTerms.push({ term: { 'Resource.service.name': service } });
              serviceTerms.push({ term: { 'resource.attributes.service.name': service } });
              serviceTerms.push({ term: { 'service.name': service } });
            }
          });
          
          if (serviceTerms.length > 0) {
            must.push({
              bool: {
                should: serviceTerms,
                minimum_should_match: 1
              }
            });
          }
        } else if (typeof serviceOrServices === 'string' && serviceOrServices.trim() !== '') {
          // Handle single service
          const service = serviceOrServices.trim();
          must.push({
            bool: {
              should: [
                { term: { 'Resource.service.name': service } },
                { term: { 'resource.attributes.service.name': service } },
                { term: { 'service.name': service } }
              ],
              minimum_should_match: 1
            }
          });
        }
      }

      // Create aggregation query to get time series data
      const query = {
        size: 0,
        query: {
          bool: { must }
        },
        aggs: {
          time_buckets: {
            date_histogram: {
              field: '@timestamp',
              fixed_interval: '1m'
            },
            aggs: {
              metric_value: {
                stats: {
                  field: metricField
                }
              }
            }
          }
        }
      };

      // Execute query
      const response = await this.esAdapter.queryMetrics(query);
      const buckets = response.aggregations?.time_buckets?.buckets || [];

      if (buckets.length < 5) {
        logger.warn(`[Metric Type Detection] Not enough data points to determine metric type for: ${metricField}`);
        return MetricType.UNKNOWN;
      }

      // Extract values
      const values = buckets
        .map((bucket: any) => bucket.metric_value?.avg)
        .filter((value: any) => value !== null && value !== undefined);

      if (values.length < 5) {
        return MetricType.UNKNOWN;
      }

      // Check if it's an enum (limited set of discrete values)
      const uniqueValues = new Set(values);
      if (uniqueValues.size <= 10 && uniqueValues.size / values.length < 0.2) {
        return MetricType.ENUM;
      }

      // Check if it's a monotonic counter (always increasing or staying the same)
      let isMonotonic = true;
      for (let i = 1; i < values.length; i++) {
        if (values[i] < values[i-1]) {
          isMonotonic = false;
          break;
        }
      }

      if (isMonotonic) {
        return MetricType.MONOTONIC_COUNTER;
      }

      // Check if it's a counter (generally increasing but can reset)
      let increasingCount = 0;
      let decreasingCount = 0;
      let significantDrops = 0;

      for (let i = 1; i < values.length; i++) {
        const diff = values[i] - values[i-1];
        if (diff > 0) {
          increasingCount++;
        } else if (diff < 0) {
          decreasingCount++;
          // Check for significant drops (potential counter resets)
          if (values[i] < values[i-1] * 0.5) {
            significantDrops++;
          }
        }
      }

      // If mostly increasing with some significant drops, likely a counter
      if (increasingCount > decreasingCount * 2 && significantDrops > 0) {
        return MetricType.COUNTER;
      }

      // Default to gauge (can go up and down freely)
      return MetricType.GAUGE;
    } catch (error) {
      logger.error(`[Metric Type Detection] Error detecting metric type for ${metricField}:`, error);
      return MetricType.UNKNOWN;
    }
  }

  /**
   * Get metric field information with type detection
   * @param metricField The metric field to analyze
   * @param startTime Start time in ISO 8601 format
   * @param endTime End time in ISO 8601 format
   * @param serviceOrServices Optional service name or array of services to filter by
   * @returns Object containing field information including detected type
   */
  async getMetricFieldInfo(
    metricField: string,
    startTime: string,
    endTime: string,
    serviceOrServices?: string | string[]
  ): Promise<any> {
    try {
      // Detect the metric type
      const metricType = await this.detectMetricType(
        metricField,
        startTime,
        endTime,
        serviceOrServices
      );

      // Get schema information
      const schemas = await this.getGroupedMetricSchemas();
      
      // Find the schema information for this field
      let schemaType = 'unknown';
      let schema = null;
      
      // Look through all schemas to find this field
      for (const [metricName, fieldSchema] of Object.entries(schemas)) {
        for (const [field, fieldType] of Object.entries(fieldSchema)) {
          if (field === metricField || `metric.${field}` === metricField) {
            schemaType = fieldType;
            schema = { type: fieldType };
            break;
          }
        }
        if (schema) break;
      }

      return {
        name: metricField,
        schemaType,
        metricType,
        schema,
        typeInfo: {
          isGauge: metricType === MetricType.GAUGE,
          isCounter: metricType === MetricType.COUNTER,
          isMonotonicCounter: metricType === MetricType.MONOTONIC_COUNTER,
          isEnum: metricType === MetricType.ENUM,
          isUnknown: metricType === MetricType.UNKNOWN
        }
      };
    } catch (error) {
      logger.error(`[Metric Field Info] Error getting info for ${metricField}:`, error);
      return {
        name: metricField,
        schemaType: 'unknown',
        metricType: MetricType.UNKNOWN,
        schema: null,
        typeInfo: {
          isGauge: false,
          isCounter: false,
          isMonotonicCounter: false,
          isEnum: false,
          isUnknown: true
        },
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
