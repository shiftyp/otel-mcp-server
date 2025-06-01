import { LogCore } from './logCore.js';
import { logger } from '../../../../utils/logger.js';
import { createErrorResponse, ErrorResponse, isErrorResponse } from '../../../../utils/errorHandling.js';
import { createBoolQuery, createRangeQuery, createTermQuery } from '../../../../utils/queryBuilder.js';
import { ServiceResolver } from '../../../../utils/serviceResolver.js';

/**
 * Time series analysis functionality for the OpenSearch Logs Adapter
 */
export class LogTimeSeriesAnalysis extends LogCore {
  constructor(options: any) {
    super(options);
  }

  /**
   * Perform time series analysis on logs
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param service Optional service filter
   * @param level Optional log level filter
   * @param interval Time interval for aggregation
   * @param metric Metric to analyze (count, error_rate, etc.)
   */
  public async timeSeriesAnalysis(
    startTime: string,
    endTime: string,
    service?: string,
    level?: string,
    interval: string = '1h',
    metric: 'count' | 'error_rate' | 'unique_services' = 'count'
  ): Promise<any | ErrorResponse> {
    try {
      logger.info('[OpenSearch LogTimeSeriesAnalysis] timeSeriesAnalysis called', {
        startTime, endTime, service, level, interval, metric
      });
      
      // Build query to get time series data
      const must = [];
      
      // Add time range
      must.push(createRangeQuery('@timestamp', startTime, endTime));
      
      // Add service filter if provided
      if (service) {
        const serviceQuery = ServiceResolver.createServiceQuery(service, 'LOGS');
        if (!isErrorResponse(serviceQuery)) {
          must.push(serviceQuery);
        }
      }
      
      // Add level filter if provided
      if (level) {
        must.push(createTermQuery('SeverityText', level));
      }
      
      // Build the aggregation based on the metric
      let aggs: any = {};
      
      // Time histogram aggregation
      aggs.time_buckets = {
        date_histogram: {
          field: '@timestamp',
          calendar_interval: interval,
          format: 'yyyy-MM-dd HH:mm:ss'
        }
      };
      
      // Add metric-specific sub-aggregations
      if (metric === 'error_rate') {
        // Add error filter aggregation
        aggs.time_buckets.aggs = {
          errors: {
            filter: {
              bool: {
                should: [
                  { term: { 'SeverityText': 'error' } },
                  { term: { 'level': 'error' } },
                  { term: { 'severityText': 'error' } }
                ]
              }
            }
          }
        };
      } else if (metric === 'unique_services') {
        // Add cardinality aggregation for unique services
        aggs.time_buckets.aggs = {
          unique_services: {
            cardinality: {
              field: 'Resource.service.name'
            }
          }
        };
      }
      
      // Build the complete query
      const query = {
        query: createBoolQuery({ must }),
        size: 0, // We only want aggregations
        aggs
      };
      
      // Execute the query
      const result = await this.searchLogs(query);
      
      if (isErrorResponse(result)) {
        return result;
      }
      
      if (!result.aggregations || !result.aggregations.time_buckets || !result.aggregations.time_buckets.buckets) {
        return createErrorResponse('No time series data found');
      }
      
      // Process the results based on the metric
      const buckets = result.aggregations.time_buckets.buckets;
      const timeSeriesData = buckets.map((bucket: any) => {
        const timestamp = bucket.key_as_string;
        const count = bucket.doc_count;
        
        let value = count; // Default to count
        
        if (metric === 'error_rate') {
          const errorCount = bucket.errors ? bucket.errors.doc_count : 0;
          value = count > 0 ? errorCount / count : 0;
        } else if (metric === 'unique_services') {
          value = bucket.unique_services ? bucket.unique_services.value : 0;
        }
        
        return {
          timestamp,
          value,
          count
        };
      });
      
      // Calculate some basic statistics
      const values = timeSeriesData.map((d: { timestamp: string; value: number }) => d.value);
      const total = values.reduce((sum: number, val: number) => sum + val, 0);
      const average = values.length > 0 ? total / values.length : 0;
      const max = values.length > 0 ? Math.max(...values) : 0;
      const min = values.length > 0 ? Math.min(...values) : 0;
      
      return {
        time_series: timeSeriesData,
        metric,
        interval,
        stats: {
          total,
          average,
          max,
          min,
          points: values.length
        }
      };
    } catch (error) {
      return createErrorResponse(`Error performing time series analysis: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
