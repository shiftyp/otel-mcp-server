import { logger } from '../../../utils/logger.js';
import { MetricsAdapterCore, TimeSeriesPoint } from './metricCore.js';

/**
 * OpenSearch Metrics Anomaly Detection Adapter
 * Provides functionality for detecting anomalies in OpenTelemetry metrics data using OpenSearch ML capabilities
 */
export class MetricsAnomalyDetectionAdapter extends MetricsAdapterCore {
  constructor(options: any) {
    super(options);
  }

  /**
   * Detect metric anomalies using OpenSearch's HDBSCAN clustering algorithm
   * This leverages OpenSearch-specific ML capabilities for anomaly detection
   */
  public async detectMetricAnomalies(
    startTime: string, 
    endTime: string, 
    options: {
      service?: string,
      metricName?: string,
      metricField: string,
      metricType?: 'gauge' | 'counter' | 'histogram',
      queryString?: string,
      maxResults?: number,
      thresholdType?: 'p99' | 'stddev' | 'fixed',
      thresholdValue?: number,
      windowSize?: number
    }
  ): Promise<any> {
    logger.info('[OpenSearch MetricsAnomalyDetectionAdapter] Detecting metric anomalies', { startTime, endTime, options });
    
    try {
      const indexPattern = 'metrics-*';
      const maxResults = options.maxResults || 20;
      const thresholdType = options.thresholdType || 'stddev';
      const windowSize = options.windowSize || 10;
      
      if (!options.metricField) {
        return { 
          anomalies: [], 
          error: 'metricField is required',
          message: 'Failed to detect metric anomalies: metricField is required'
        };
      }
      
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
      
      // Add metric name filter if specified
      if (options.metricName) {
        filters.push({
          term: {
            'name': options.metricName
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
      
      // First, get the time series data
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
              fixed_interval: '1m'
            },
            aggs: {
              metric_value: {
                avg: {
                  field: options.metricField
                }
              }
            }
          }
        }
      };
      
      const timeSeriesResponse = await this.request('POST', `/${indexPattern}/_search`, timeSeriesQuery);
      
      if (!timeSeriesResponse.aggregations?.timeseries?.buckets) {
        return { anomalies: [], message: 'No metric data found' };
      }
      
      const timeSeriesBuckets = timeSeriesResponse.aggregations.timeseries.buckets;
      
      // Extract the time series data
      const timeSeriesData: TimeSeriesPoint[] = timeSeriesBuckets.map((bucket: any) => ({
        timestamp: bucket.key_as_string,
        value: bucket.metric_value.value || 0
      }));
      
      // Use OpenSearch's ML plugin for anomaly detection
      // This is different from Elasticsearch's approach
      const mlEndpoint = '/_plugins/_ml';
      
      // For HDBSCAN clustering (unique to OpenSearch)
      const hdbscanRequest = {
        algorithm: 'hdbscan',
        parameters: {
          min_cluster_size: 5,
          min_samples: 5,
          cluster_selection_epsilon: 0.5,
          alpha: 1.0
        },
        input_data: {
          // Convert time series to feature vectors for clustering
          // Use sliding window approach
          feature_vectors: this.createSlidingWindows(timeSeriesData, windowSize)
        }
      };
      
      const hdbscanResponse = await this.request('POST', `${mlEndpoint}/execute_cluster`, hdbscanRequest);
      
      // Process the clustering results to identify anomalies
      const anomalies: any[] = [];
      
      if (hdbscanResponse.cluster_result && hdbscanResponse.cluster_result.cluster_indices) {
        // Find the smallest cluster or noise points (cluster -1)
        const clusterCounts: Record<string, number> = {};
        for (const cluster of hdbscanResponse.cluster_result.cluster_indices) {
          clusterCounts[cluster] = (clusterCounts[cluster] || 0) + 1;
        }
        
        // Identify anomaly clusters (smallest clusters or noise points)
        const anomalyClusters = Object.entries(clusterCounts)
          .filter(([cluster, count]) => cluster === '-1' || (count as number) < 3)
          .map(([cluster]) => parseInt(cluster));
        
        // Map anomaly clusters back to time points
        for (let i = 0; i < hdbscanResponse.cluster_result.cluster_indices.length; i++) {
          const cluster = hdbscanResponse.cluster_result.cluster_indices[i];
          if (anomalyClusters.includes(cluster)) {
            // This is a window, map back to original time series
            const windowStart = i;
            const windowEnd = Math.min(i + windowSize, timeSeriesData.length);
            
            // Find the most anomalous point in the window
            let maxDeviation = 0;
            let maxDeviationIndex = windowStart;
            
            for (let j = windowStart; j < windowEnd; j++) {
              // Calculate z-score for this point
              const window = timeSeriesData.slice(
                Math.max(0, j - windowSize), 
                Math.min(timeSeriesData.length, j + windowSize)
              );
              
              const values = window.map((point: TimeSeriesPoint) => point.value);
              const mean = values.reduce((sum: number, val: number) => sum + val, 0) / values.length;
              const stdDev = Math.sqrt(
                values.reduce((sum: number, val: number) => sum + Math.pow(val - mean, 2), 0) / values.length
              );
              
              const zScore = stdDev > 0 ? Math.abs((timeSeriesData[j].value - mean) / stdDev) : 0;
              
              if (zScore > maxDeviation) {
                maxDeviation = zScore;
                maxDeviationIndex = j;
              }
            }
            
            // Add the anomaly
            if (maxDeviationIndex < timeSeriesData.length) {
              anomalies.push({
                timestamp: timeSeriesData[maxDeviationIndex].timestamp,
                value: timeSeriesData[maxDeviationIndex].value,
                deviation_score: maxDeviation,
                cluster
              });
            }
            
            // Skip ahead to avoid duplicate anomalies in overlapping windows
            i += windowSize - 1;
          }
        }
      }
      
      // Sort anomalies by deviation score
      anomalies.sort((a: any, b: any) => b.deviation_score - a.deviation_score);
      
      return {
        anomalies: anomalies.slice(0, maxResults),
        timeSeriesData,
        message: anomalies.length > 0 
          ? `Found ${anomalies.length} metric anomalies` 
          : 'No anomalies detected'
      };
    } catch (error: any) {
      logger.error('[OpenSearch MetricsAnomalyDetectionAdapter] Error detecting metric anomalies', { error });
      return { 
        anomalies: [], 
        error: error.message || error,
        message: 'Failed to detect metric anomalies'
      };
    }
  }
}
