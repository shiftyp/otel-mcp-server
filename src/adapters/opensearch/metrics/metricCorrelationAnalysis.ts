import { logger } from '../../../utils/logger.js';
import { MetricsAdapterCore, TimeSeriesPoint } from './metricCore.js';

/**
 * Metric Correlation Analysis using OpenSearch's ML capabilities
 * Finds correlations between multiple metrics
 */
export class MetricCorrelationAnalysis {
  /**
   * Find correlations between multiple metrics
   * @param client The OpenSearch client to use for requests
   * @param metricFields Array of metric fields to analyze
   * @param startTime The start time for the analysis window
   * @param endTime The end time for the analysis window
   * @param options Additional options for correlation analysis
   */
  public static async findCorrelatedMetrics(
    client: MetricsAdapterCore,
    metricFields: string[],
    startTime: string,
    endTime: string,
    options: {
      service?: string;
      queryString?: string;
      interval?: string;
      minCorrelation?: number;
      includeAntiCorrelations?: boolean;
    } = {}
  ): Promise<any> {
    logger.info('[MetricCorrelationAnalysis] Finding correlated metrics', { 
      metricFields, 
      startTime, 
      endTime, 
      options 
    });
    
    try {
      // Default options
      const interval = options.interval || '5m';
      const minCorrelation = options.minCorrelation || 0.7;
      const includeAntiCorrelations = options.includeAntiCorrelations !== undefined ? options.includeAntiCorrelations : true;
      
      if (!metricFields || metricFields.length < 2) {
        return { 
          correlations: [], 
          error: 'At least two metric fields are required',
          message: 'Please specify at least two metric fields for correlation analysis'
        };
      }
      
      // Get time series data for each metric field
      const metricData: Record<string, TimeSeriesPoint[]> = {};
      
      for (const metricField of metricFields) {
        const timeSeriesData = await this.getMetricTimeSeries(
          client,
          metricField,
          startTime,
          endTime,
          interval,
          options
        );
        
        if (timeSeriesData.length > 0) {
          metricData[metricField] = timeSeriesData;
        }
      }
      
      // Check if we have enough data
      const availableMetrics = Object.keys(metricData);
      
      if (availableMetrics.length < 2) {
        return { 
          correlations: [], 
          message: 'Not enough metric data available for correlation analysis'
        };
      }
      
      // Align time series data to common timestamps
      const alignedData = this.alignTimeSeriesData(metricData);
      
      // Calculate correlations between metrics
      const correlations = [];
      
      for (let i = 0; i < availableMetrics.length; i++) {
        for (let j = i + 1; j < availableMetrics.length; j++) {
          const metric1 = availableMetrics[i];
          const metric2 = availableMetrics[j];
          
          const values1 = alignedData[metric1].map(point => point.value);
          const values2 = alignedData[metric2].map(point => point.value);
          
          const correlation = this.calculatePearsonCorrelation(values1, values2);
          
          // Include only strong correlations or anti-correlations
          if (Math.abs(correlation) >= minCorrelation && (correlation > 0 || includeAntiCorrelations)) {
            correlations.push({
              metric1,
              metric2,
              correlation,
              type: correlation > 0 ? 'positive' : 'negative',
              strength: Math.abs(correlation) >= 0.9 ? 'very_strong' :
                        Math.abs(correlation) >= 0.7 ? 'strong' :
                        Math.abs(correlation) >= 0.5 ? 'moderate' :
                        Math.abs(correlation) >= 0.3 ? 'weak' : 'very_weak'
            });
          }
        }
      }
      
      // Sort correlations by absolute value (descending)
      correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
      
      return {
        correlations,
        metrics: availableMetrics,
        timeSeriesData: alignedData,
        summary: {
          metricCount: availableMetrics.length,
          correlationCount: correlations.length,
          positiveCorrelations: correlations.filter(c => c.correlation > 0).length,
          negativeCorrelations: correlations.filter(c => c.correlation < 0).length,
          strongCorrelations: correlations.filter(c => Math.abs(c.correlation) >= 0.7).length
        },
        message: `Found ${correlations.length} correlations between ${availableMetrics.length} metrics`
      };
    } catch (error: any) {
      logger.error('[MetricCorrelationAnalysis] Error finding correlated metrics', { error });
      return { 
        correlations: [], 
        error: error.message || String(error),
        message: 'Failed to find correlated metrics'
      };
    }
  }
  
  /**
   * Get time series data for a metric field
   * @param client The OpenSearch client to use for requests
   * @param metricField The metric field to get data for
   * @param startTime The start time for the analysis window
   * @param endTime The end time for the analysis window
   * @param interval The time interval for bucketing
   * @param options Additional options for the query
   */
  private static async getMetricTimeSeries(
    client: MetricsAdapterCore,
    metricField: string,
    startTime: string,
    endTime: string,
    interval: string,
    options: {
      service?: string;
      queryString?: string;
    }
  ): Promise<TimeSeriesPoint[]> {
    const indexPattern = 'metrics-*';
    
    // Build the query filters
    const filters = [
      {
        range: {
          '@timestamp': {
            gte: startTime,
            lte: endTime
          }
        }
      }
    ] as any[];
    
    // Add service filter if specified
    if (options.service) {
      filters.push({
        term: {
          'resource.attributes.service.name': options.service
        }
      });
    }
    
    // Add additional query string if specified
    if (options.queryString) {
      filters.push({
        query_string: {
          query: options.queryString
        }
      });
    }
    
    // Query for time series data
    const timeSeriesQuery = {
      query: {
        bool: {
          filter: filters
        }
      },
      size: 0,
      aggs: {
        timeseries: {
          date_histogram: {
            field: '@timestamp',
            fixed_interval: interval
          },
          aggs: {
            metric_value: {
              avg: {
                field: metricField
              }
            }
          }
        }
      }
    };
    
    const timeSeriesResponse = await client.request('POST', `/${indexPattern}/_search`, timeSeriesQuery);
    
    if (!timeSeriesResponse.aggregations?.timeseries?.buckets) {
      return [];
    }
    
    const timeSeriesBuckets = timeSeriesResponse.aggregations.timeseries.buckets;
    
    // Extract the time series data
    return timeSeriesBuckets
      .filter((bucket: any) => bucket.metric_value.value !== null && bucket.metric_value.value !== undefined)
      .map((bucket: any) => ({
        timestamp: bucket.key_as_string,
        value: bucket.metric_value.value || 0
      }));
  }
  
  /**
   * Align time series data to common timestamps
   * @param metricData Record of metric field to time series data
   */
  private static alignTimeSeriesData(metricData: Record<string, TimeSeriesPoint[]>): Record<string, TimeSeriesPoint[]> {
    // Get all unique timestamps
    const allTimestamps = new Set<string>();
    
    for (const timeSeriesData of Object.values(metricData)) {
      for (const point of timeSeriesData) {
        allTimestamps.add(point.timestamp);
      }
    }
    
    // Sort timestamps
    const sortedTimestamps = Array.from(allTimestamps).sort();
    
    // Create aligned data
    const alignedData: Record<string, TimeSeriesPoint[]> = {};
    
    for (const [metricField, timeSeriesData] of Object.entries(metricData)) {
      // Create a map of timestamp to value
      const timestampMap: Record<string, number> = {};
      
      for (const point of timeSeriesData) {
        timestampMap[point.timestamp] = point.value;
      }
      
      // Create aligned time series
      alignedData[metricField] = sortedTimestamps.map(timestamp => ({
        timestamp,
        value: timestampMap[timestamp] !== undefined ? timestampMap[timestamp] : null as any
      }));
    }
    
    // Filter to timestamps where all metrics have values
    const completeTimestamps = sortedTimestamps.filter(timestamp => {
      for (const metricField of Object.keys(metricData)) {
        const point = alignedData[metricField].find(p => p.timestamp === timestamp);
        if (!point || point.value === null) {
          return false;
        }
      }
      return true;
    });
    
    // Filter aligned data to complete timestamps
    for (const metricField of Object.keys(metricData)) {
      alignedData[metricField] = alignedData[metricField].filter(point => 
        completeTimestamps.includes(point.timestamp)
      );
    }
    
    return alignedData;
  }
  
  /**
   * Calculate Pearson correlation coefficient between two arrays
   * @param x First array of values
   * @param y Second array of values
   */
  private static calculatePearsonCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length === 0) {
      return 0;
    }
    
    // Calculate means
    const meanX = x.reduce((sum, val) => sum + val, 0) / x.length;
    const meanY = y.reduce((sum, val) => sum + val, 0) / y.length;
    
    // Calculate covariance and variances
    let covariance = 0;
    let varianceX = 0;
    let varianceY = 0;
    
    for (let i = 0; i < x.length; i++) {
      const diffX = x[i] - meanX;
      const diffY = y[i] - meanY;
      
      covariance += diffX * diffY;
      varianceX += diffX * diffX;
      varianceY += diffY * diffY;
    }
    
    // Calculate correlation
    if (varianceX === 0 || varianceY === 0) {
      return 0;
    }
    
    return covariance / (Math.sqrt(varianceX) * Math.sqrt(varianceY));
  }
}
