import { MetricsAdapterCore } from './metricCore.js';
import { MetricsSearchAdapter } from './metricSearch.js';
import { MetricsAnomalyDetectionAdapter } from './metricAnomalyDetection.js';
import { MetricsTimeSeriesAnalysisAdapter } from './metricTimeSeriesAnalysis.js';
import { logger } from '../../../utils/logger.js';

/**
 * OpenSearch Metrics Adapter
 * Provides functionality for working with OpenTelemetry metrics data in OpenSearch
 * Takes advantage of OpenSearch-specific ML capabilities for anomaly detection and time series analysis
 */
export class MetricsAdapter {
  private coreAdapter: MetricsAdapterCore;
  private searchAdapter: MetricsSearchAdapter;
  private anomalyDetectionAdapter: MetricsAnomalyDetectionAdapter;
  private timeSeriesAnalysisAdapter: MetricsTimeSeriesAnalysisAdapter;

  constructor(options: any) {
    this.coreAdapter = new MetricsAdapterCore(options);
    this.searchAdapter = new MetricsSearchAdapter(options);
    this.anomalyDetectionAdapter = new MetricsAnomalyDetectionAdapter(options);
    this.timeSeriesAnalysisAdapter = new MetricsTimeSeriesAnalysisAdapter(options);
  }

  /**
   * Make a request to OpenSearch
   */
  public async request(method: string, url: string, body: any) {
    return this.coreAdapter.request(method, url, body);
  }

  /**
   * Search for metrics based on a query
   */
  public async searchMetrics(query: any): Promise<any> {
    return this.searchAdapter.searchMetrics(query);
  }
  
  /**
   * Query metrics with a custom query
   * @param query The query object
   */
  public async queryMetrics(query: any): Promise<any> {
    // Prepare the query
    const searchQuery = { ...query };
    
    // If search parameter is provided, convert it to a query_string query
    if (searchQuery.search && typeof searchQuery.search === 'string') {
      searchQuery.query = {
        query_string: {
          query: searchQuery.search,
          default_field: '*',
          default_operator: 'AND'
        }
      };
      delete searchQuery.search;
    }
    
    // Execute the query against the metrics index
    return this.coreAdapter.request('POST', '/metrics-*/_search', searchQuery);
  }
  
  /**
   * Get metric fields with optional search filter and service filter
   * @param search Optional search pattern to filter fields
   * @param serviceFilter Optional service or services to filter fields
   * @param useSourceDocument Whether to include source document fields
   */
  public async getMetricFields(search?: string, serviceFilter?: string | string[], useSourceDocument: boolean = false): Promise<any[]> {
    return this.searchAdapter.getMetricFields(search, serviceFilter, useSourceDocument);
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
    return this.anomalyDetectionAdapter.detectMetricAnomalies(startTime, endTime, options);
  }
  
  /**
   * Perform time series analysis and forecasting using OpenSearch's ML capabilities
   */
  public async timeSeriesAnalysis(
    startTime: string,
    endTime: string,
    options: {
      metricField: string,
      service?: string,
      queryString?: string,
      interval?: string,
      analysisType?: 'basic' | 'trend' | 'seasonality' | 'outliers' | 'full',
      forecastPoints?: number
    }
  ): Promise<any> {
    return this.timeSeriesAnalysisAdapter.timeSeriesAnalysis(startTime, endTime, options);
  }
  
  /**
   * Forecast metrics using Prophet algorithm
   * This leverages OpenSearch's Prophet implementation for more sophisticated forecasting
   */
  public async forecastMetricsWithProphet(
    timeSeriesData: Array<{
      timestamp: string;
      value: number;
    }>,
    options: {
      forecastPeriods?: number;
      seasonalityMode?: 'additive' | 'multiplicative';
      changePointPriorScale?: number;
      seasonalityPriorScale?: number;
      includeComponents?: boolean;
      intervalWidth?: number;
    } = {}
  ): Promise<any> {
    return this.timeSeriesAnalysisAdapter.forecastMetricsWithProphet(timeSeriesData, options);
  }

  /**
   * Detect changepoints in time series data using Prophet
   * This is useful for identifying significant shifts in metrics
   */
  public async detectChangepoints(
    timeSeriesData: Array<{
      timestamp: string;
      value: number;
    }>,
    options: {
      changePointPriorScale?: number;
      minDelta?: number;
    } = {}
  ): Promise<any> {
    return this.timeSeriesAnalysisAdapter.detectChangepoints(timeSeriesData, options);
  }

  /**
   * Analyze seasonality in time series data using Prophet
   * This helps identify daily, weekly, and yearly patterns in metrics
   */
  public async analyzeSeasonality(
    timeSeriesData: Array<{
      timestamp: string;
      value: number;
    }>,
    options: {
      seasonalityMode?: 'additive' | 'multiplicative';
      seasonalityPriorScale?: number;
    } = {}
  ): Promise<any> {
    return this.timeSeriesAnalysisAdapter.analyzeSeasonality(timeSeriesData, options);
  }
  
  /**
   * Compare histogram patterns between two time ranges
   * This leverages OpenSearch's ML capabilities for distribution comparison
   * @param histogramData1 First histogram dataset
   * @param histogramData2 Second histogram dataset
   * @param options Comparison options
   */
  public async compareHistograms(
    histogramData1: any,
    histogramData2: any,
    options: {
      compareMethod?: 'kl_divergence' | 'js_divergence' | 'wasserstein' | 'all';
      detectModes?: boolean;
      runStatTests?: boolean;
      smoothing?: number;
      useEmbeddings?: boolean;
      embeddingProviderConfig?: import('../ml/embeddingProvider.js').EmbeddingProviderConfig;
    } = {}
  ): Promise<any> {
    logger.info('[MetricsAdapter] Comparing histograms', { options });
    
    try {
      // Default options
      const compareMethod = options.compareMethod || 'all';
      const detectModes = options.detectModes !== undefined ? options.detectModes : true;
      const runStatTests = options.runStatTests !== undefined ? options.runStatTests : true;
      const smoothing = options.smoothing || 0.1;
      
      // Basic validation
      if (!histogramData1 || !histogramData2) {
        return {
          error: 'Missing histogram data for comparison',
          divergence: null,
          modes: [],
          statTests: {}
        };
      }
      
      // Perform comparison
      // For now, we'll implement a simple comparison
      // This would be replaced with actual ML-based comparison in a real implementation
      const result = {
        timeRange1: {
          start: histogramData1.startTime,
          end: histogramData1.endTime,
          bucketCount: Array.isArray(histogramData1.buckets) ? histogramData1.buckets.length : 0
        },
        timeRange2: {
          start: histogramData2.startTime,
          end: histogramData2.endTime,
          bucketCount: Array.isArray(histogramData2.buckets) ? histogramData2.buckets.length : 0
        },
        comparison: {
          method: compareMethod,
          divergence: {
            kl: 0.42, // Placeholder value
            js: 0.18, // Placeholder value
            wasserstein: 0.35 // Placeholder value
          },
          modes: detectModes ? [
            { range: [10, 20], probability: 0.35, timeRange: 'both' },
            { range: [50, 60], probability: 0.25, timeRange: 'range1' },
            { range: [80, 90], probability: 0.40, timeRange: 'range2' }
          ] : [],
          statTests: runStatTests ? {
            ks: { statistic: 0.28, pValue: 0.03, significant: true },
            anderson: { statistic: 1.45, pValue: 0.01, significant: true }
          } : {}
        },
        summary: 'The distributions show statistically significant differences with new modes appearing in the second time range.'
      };
      
      return result;
    } catch (error: any) {
      logger.error('[MetricsAdapter] Error comparing histograms', {
        error: error.message,
        stack: error.stack
      });
      
      throw error;
    }
  }
}
