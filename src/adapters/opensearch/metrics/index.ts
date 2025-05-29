import { MetricsAdapterCore } from './metricCore.js';
import { MetricsSearchAdapter } from './metricSearch.js';
import { MetricsAnomalyDetectionAdapter } from './metricAnomalyDetection.js';
import { MetricsTimeSeriesAnalysisAdapter } from './metricTimeSeriesAnalysis.js';

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
   * Get metric fields with optional search filter
   */
  public async getMetricFields(search?: string): Promise<any[]> {
    return this.searchAdapter.getMetricFields(search);
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
}
