import { ElasticsearchCore } from './core.js';
import { logger } from '../../utils/logger.js';

export class MetricsAdapter extends ElasticsearchCore {
  /**
   * List all metric fields and their types from metrics indices, filtering out metadata fields.
   * @returns Array of { name, type }
   */
  public async listMetricFields(): Promise<Array<{ name: string, type: string }>> {
    // Use a more inclusive pattern for metrics indices to match OpenTelemetry data
    const resp = await this.request('GET', '/metrics*,*metrics*/_mapping').catch(err => {
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
  public async aggregateOtelMetricsRange(
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
      // Check if the field exists
      query.bool.must.push({
        exists: {
          field: metricField
        }
      });
    }
    
    // Add service filter if provided - support multiple service name field patterns
    if (service) {
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
    
    // Execute the query against all possible metrics indices
    const response = await this.request('POST', '/metrics*,*metrics*/_search', {
      size: 0,
      query,
      aggs: {
        metrics: {
          terms: {
            field: metricField ? 'metric.name.keyword' : 'metric.name.keyword',
            size: 100
          },
          aggs: {
            avg_value: {
              avg: {
                field: metricField || 'metric.value'
              }
            },
            min_value: {
              min: {
                field: metricField || 'metric.value'
              }
            },
            max_value: {
              max: {
                field: metricField || 'metric.value'
              }
            },
            by_time: {
              date_histogram: {
                field: '@timestamp',
                fixed_interval: '1m'
              },
              aggs: {
                value: {
                  avg: {
                    field: metricField || 'metric.value'
                  }
                }
              }
            }
          }
        }
      }
    });
    
    // Process and return the results
    const results: string[] = [];
    const metrics = response.aggregations?.metrics?.buckets || [];
    
    for (const metric of metrics) {
      results.push(JSON.stringify({
        metric: metric.key,
        field: metricField || 'metric.value',
        avg: metric.avg_value?.value,
        min: metric.min_value?.value,
        max: metric.max_value?.value,
        timeseries: metric.by_time?.buckets?.map((bucket: any) => ({
          timestamp: bucket.key_as_string,
          value: bucket.value?.value
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
