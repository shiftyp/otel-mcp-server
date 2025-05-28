import { ElasticsearchCore } from '../../core/core.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Module for metric aggregation functionality
 */
export class MetricAggregationModule {
  private esCore: ElasticsearchCore;

  constructor(esCore: ElasticsearchCore) {
    this.esCore = esCore;
  }

  /**
   * Aggregate metrics over a time range
   * @param options Aggregation options
   * @returns Aggregated metrics data
   */
  public async aggregateOtelMetricsRange(
    options: {
      metricName: string;
      service?: string;
      startTime: string;
      endTime: string;
      interval?: string;
      percentiles?: number[];
      dimensions?: string[];
      filters?: Record<string, any>;
    }
  ): Promise<{
    metricName: string;
    service?: string;
    timeRange: { start: string; end: string };
    interval: string;
    buckets: Array<{
      timestamp: string;
      value: number;
      count: number;
      min?: number;
      max?: number;
      avg?: number;
      sum?: number;
      percentiles?: Record<string, number>;
      dimensions?: Record<string, any>;
    }>;
  }> {
    logger.info('[ES Adapter] aggregateOtelMetricsRange called', { options });
    
    const {
      metricName,
      service,
      startTime,
      endTime,
      interval = '1m',
      percentiles = [50, 95, 99],
      dimensions = [],
      filters = {}
    } = options;
    
    // Build the Elasticsearch query
    const esQuery: any = {
      bool: {
        must: [
          // Match the metric name
          {
            bool: {
              should: [
                { term: { 'name': metricName } },
                { term: { 'metric.name': metricName } },
                { term: { 'metricset.name': metricName } }
              ],
              minimum_should_match: 1
            }
          },
          // Add time range filter
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
    
    // Add service filter if provided
    if (service) {
      esQuery.bool.must.push({
        bool: {
          should: [
            { term: { 'resource.service.name': service } },
            { term: { 'service.name': service } },
            { term: { 'Resource.attributes.service.name': service } },
            { term: { 'resource.attributes.service.name': service } }
          ],
          minimum_should_match: 1
        }
      });
    }
    
    // Add custom filters if provided
    for (const [key, value] of Object.entries(filters)) {
      esQuery.bool.must.push({
        term: { [key]: value }
      });
    }
    
    // Prepare the aggregations
    const aggs: any = {
      // Time-based histogram
      time_buckets: {
        date_histogram: {
          field: '@timestamp',
          fixed_interval: interval
        },
        aggs: {
          // Basic stats
          metric_stats: {
            stats: {
              field: 'value'
            }
          }
        }
      }
    };
    
    // Add percentiles if requested
    if (percentiles && percentiles.length > 0) {
      aggs.time_buckets.aggs.metric_percentiles = {
        percentiles: {
          field: 'value',
          percents: percentiles
        }
      };
    }
    
    // Add dimension aggregations if requested
    if (dimensions && dimensions.length > 0) {
      for (const dimension of dimensions) {
        aggs.time_buckets.aggs[`dimension_${dimension}`] = {
          terms: {
            field: dimension,
            size: 10
          }
        };
      }
    }
    
    // Prepare the full request
    const searchRequest = {
      index: '.ds-metrics-*,metrics*,*metrics*,otel-metric*',
      body: {
        size: 0,  // We only need aggregations
        query: esQuery,
        aggs
      }
    };
    
    try {
      // Execute the search
      logger.debug('[ES Adapter] Executing metrics aggregation', { request: JSON.stringify(searchRequest) });
      const response = await this.esCore.callEsRequest('POST', `${searchRequest.index}/_search`, searchRequest.body);
      
      // Process the results
      if (!response.aggregations || !response.aggregations.time_buckets || !response.aggregations.time_buckets.buckets) {
        logger.info('[ES Adapter] No metrics found for aggregation');
        return {
          metricName,
          service,
          timeRange: { start: startTime, end: endTime },
          interval,
          buckets: []
        };
      }
      
      // Transform the aggregation results into a more usable format
      const buckets = response.aggregations.time_buckets.buckets.map((bucket: any) => {
        const result: any = {
          timestamp: bucket.key_as_string || new Date(bucket.key).toISOString(),
          value: bucket.metric_stats.avg || 0,
          count: bucket.metric_stats.count || 0,
          min: bucket.metric_stats.min,
          max: bucket.metric_stats.max,
          avg: bucket.metric_stats.avg,
          sum: bucket.metric_stats.sum
        };
        
        // Add percentiles if available
        if (bucket.metric_percentiles && bucket.metric_percentiles.values) {
          result.percentiles = {};
          for (const percentile of percentiles) {
            const key = percentile.toString();
            result.percentiles[key] = bucket.metric_percentiles.values[key];
          }
        }
        
        // Add dimensions if available
        if (dimensions && dimensions.length > 0) {
          result.dimensions = {};
          for (const dimension of dimensions) {
            const dimensionAgg = bucket[`dimension_${dimension}`];
            if (dimensionAgg && dimensionAgg.buckets && dimensionAgg.buckets.length > 0) {
              result.dimensions[dimension] = dimensionAgg.buckets.map((dimBucket: any) => ({
                key: dimBucket.key,
                count: dimBucket.doc_count
              }));
            }
          }
        }
        
        return result;
      });
      
      logger.info('[ES Adapter] Returning aggregated metrics', { 
        metricName,
        service,
        bucketCount: buckets.length
      });
      
      return {
        metricName,
        service,
        timeRange: { start: startTime, end: endTime },
        interval,
        buckets
      };
    } catch (error) {
      logger.error('[ES Adapter] Error aggregating metrics', { error });
      return {
        metricName,
        service,
        timeRange: { start: startTime, end: endTime },
        interval,
        buckets: []
      };
    }
  }
}
