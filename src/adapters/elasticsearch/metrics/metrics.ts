import { ElasticsearchCore } from '../core/core.js';
import { logger } from '../../../utils/logger.js';

export class MetricsAdapter extends ElasticsearchCore {
  /**
   * List all metric fields and their types from metrics indices, filtering out metadata fields.
   * @returns Array of { name, type }
   */
  public async listMetricFields(): Promise<Array<{ name: string, type: string }>> {
    logger.info('[ES Adapter] listMetricFields called');
    
    // Use a comprehensive pattern to match all possible metrics indices
    logger.info('[ES Adapter] About to request metrics mapping');
    const resp = await this.request('GET', '/.ds-metrics-*,metrics*,*metrics*,*metric*,otel-metric*,prometheus*,system*,metricbeat*/_mapping').catch(err => {
      logger.warn('[ES Adapter] Error getting metrics mapping', { error: err.message, stack: err.stack });
      return {};
    });
    
    logger.info('[ES Adapter] Got metrics mapping response', { 
      responseKeys: Object.keys(resp),
      responseSize: JSON.stringify(resp).length
    });
    
    // If no indices were found, return an empty array
    if (Object.keys(resp).length === 0) {
      logger.info('[ES Adapter] No metrics indices found, returning empty array');
      return [];
    }
    // Use a minimal ignoreFields set for metrics
    const ignoreFields = new Set([
      '_id', '_index', '_score', '_source', '_type', '_version'
    ]);
    const fieldMap: Record<string, string> = {};
    
    // Recursive function to extract fields with full paths
    const extractFields = (properties: Record<string, any>, prefix: string = '') => {
      for (const [field, val] of Object.entries(properties)) {
        const fullPath = prefix ? `${prefix}.${field}` : field;
        
        // Skip ignored fields
        if (ignoreFields.has(field)) continue;
        
        if (typeof val === 'object' && val !== null) {
          // If it has a type, it's a field
          if ('type' in val) {
            fieldMap[fullPath] = val.type;
          }
          
          // If it has properties, recursively process them
          if (val.properties && typeof val.properties === 'object') {
            extractFields(val.properties, fullPath);
          }
          
          // Handle special case for metrics fields that might be in nested structures
          if (field === 'metrics' || field === 'metric' || field === 'value') {
            fieldMap[fullPath] = val.type || 'object';
          }
        }
      }
    };
    
    // Process each index
    for (const idx of Object.keys(resp)) {
      const props = resp[idx]?.mappings?.properties;
      if (!props) continue;
      extractFields(props);
    }
    
    // Convert to array of { name, type } and sort by name
    return Object.entries(fieldMap)
      .map(([name, type]) => ({ name, type }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  
  /**
   * Aggregate OTEL metrics over a time range
   * @param startTime Start time in ISO 8601 format
   * @param endTime End time in ISO 8601 format
   * @param metricField Optional metric field to aggregate (e.g., 'metric.value')
   * @param service Optional service name to filter by
   */
  public  async aggregateOtelMetricsRange(
    startTime: string, 
    endTime: string, 
    metricField?: string, 
    service?: string
  ): Promise<string[]> {
    // Build the query
    const query: any = {
      bool: {
        must: [
          {
            range: {
              '@timestamp': {
                gte: startTime,
                lte: endTime
              }
            }
          }
        ]
      }
    };
    
    // Add metric field filter if provided
    if (metricField) {
      // In OTEL mapping mode, metrics might be in different field paths
      // For example, 'metric.value' in ECS might be just 'value' in OTEL
      const metricFieldPaths = [];
      
      // Add the original field path
      metricFieldPaths.push(metricField);
      
      // Add OTEL-specific field paths if we're given an ECS-style path
      if (metricField.startsWith('metric.')) {
        // Convert 'metric.value' to 'value' for OTEL format
        metricFieldPaths.push(metricField.replace('metric.', ''));
      } else {
        // Add ECS-style path if we're given an OTEL-style path
        // Convert 'value' to 'metric.value' for ECS format
        if (!metricField.includes('.')) {
          metricFieldPaths.push(`metric.${metricField}`);
        }
      }
      
      // Check if any of the possible field paths exist
      query.bool.must.push({
        bool: {
          should: metricFieldPaths.map(field => ({
            exists: { field }
          })),
          minimum_should_match: 1
        }
      });
    }
    
    // Add service filter if provided - support multiple service name field patterns
    if (service) {
      // Special handling for Redis metrics
      if (service.toLowerCase() === 'redis' && metricField && metricField.startsWith('redis.')) {
        // For Redis metrics, we don't filter by service name since they don't have a standard service field
        // Instead, we rely on the metricField filter which is already added above
      } else {
        // For other services, use the standard service name fields
        query.bool.must.push({
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
    
    // Determine the field to use for aggregation
    const fieldToAggregate = metricField || 'metric.value';
    
    // Execute the query against all possible metrics indices
    const response = await this.request('POST', '/metrics*,*metrics*/_search', {
      size: 0,
      query,
      aggs: {
        by_time: {
          date_histogram: {
            field: '@timestamp',
            fixed_interval: '1h'
          },
          aggs: {
            avg_value: {
              avg: {
                field: fieldToAggregate
              }
            },
            min_value: {
              min: {
                field: fieldToAggregate
              }
            },
            max_value: {
              max: {
                field: fieldToAggregate
              }
            }
          }
        }
      }
    });
    
    // Process and return the results
    const results: string[] = [];
    const timeBuckets = response.aggregations?.by_time?.buckets || [];
    
    // If we have time buckets, create a single result with timeseries data
    if (timeBuckets.length > 0) {
      results.push(JSON.stringify({
        field: fieldToAggregate,
        timeseries: timeBuckets.map((bucket: any) => ({
          timestamp: bucket.key_as_string,
          value: bucket.avg_value?.value,
          min: bucket.min_value?.value,
          max: bucket.max_value?.value
        }))
      }));
    }
    
    return results;
  }
  
  /**
   * Query metrics with a custom query
   */
  public async queryMetrics(query: any): Promise<any> {
    return this.request('POST', '/metrics-*/_search', query);
  }
}
