import { ElasticsearchCore } from '../core/core.js';
import { logger } from '../../../utils/logger.js';

export class MetricsAdapter extends ElasticsearchCore {
  /**
   * List all metric fields and their types from metrics indices, filtering out metadata fields.
   * @returns Array of { name, type }
   */
  public async listMetricFields(): Promise<Array<{ name: string, type: string }>> {
    // Use a comprehensive pattern to match all possible metrics indices
    const resp = await this.request('GET', '/.ds-metrics-*,metrics*,*metrics*,*metric*,otel-metric*,prometheus*,system*,metricbeat*/_mapping').catch(err => {
      logger.warn('[ES Adapter] Error getting metrics mapping', { error: err });
      return {};
    });
    // Use a local ignoreFields set, as in the original logic
    const ignoreFields = new Set([
      '@timestamp', 'service', 'host', 'k8s', 'receiver', 'scraper', 'server', 'url', 'net', '_id', '_index',
      'event', 'agent', 'ecs', 'cloud', 'container', 'orchestrator', 'labels', 'tags', 'log', 'trace', 'span',
      'transaction', 'parent', 'destination', 'source', 'client', 'process', 'observer', 'metricset', 'input',
      'fields', 'beat', 'message', 'type', 'name', 'namespace', 'version', 'runtime', 'node', 'instance',
      'deployment', 'pod', 'os', 'platform', 'ip', 'start_time', 'uid', 'address', 'port', 'scheme', 'reason',
      'key', 'provider_name', 'evaluation', 'flagd', 'feature_flag', 'scraped_metric_points', 'errored_metric_points'
    ]);
    const fieldMap: Record<string, string> = {};
    for (const idx of Object.keys(resp)) {
      const props = resp[idx]?.mappings?.properties;
      if (!props) continue;
      for (const [field, val] of Object.entries(props)) {
        if (
          !ignoreFields.has(field) && 
          typeof val === 'object' && 
          val !== null && 
          'type' in val
        ) {
          fieldMap[field] = (val as any).type;
        }
      }
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
