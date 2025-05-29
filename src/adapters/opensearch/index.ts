import { EventEmitter } from 'events';
import { OpenSearchCore, OpenSearchAdapterOptions } from './core/core.js';
import { TracesAdapter } from './traces/index.js';
import { MetricsAdapter } from './metrics/index.js';
import { LogsAdapter } from './logs/index.js';
import { logger } from '../../utils/logger.js';
import { BaseSearchAdapter } from '../base/searchAdapter.js';

/**
 * Main OpenSearchAdapter that combines functionality from specialized adapters
 * This adapter leverages OpenSearch-specific features including ML capabilities
 */
export class OpenSearchAdapter extends BaseSearchAdapter {
  public readonly coreAdapter: OpenSearchCore;
  public readonly tracesAdapter: TracesAdapter;
  public readonly metricsAdapter: MetricsAdapter;
  public readonly logsAdapter: LogsAdapter;
  
  constructor(options: OpenSearchAdapterOptions) {
    super(options);
    this.coreAdapter = new OpenSearchCore(options);
    this.tracesAdapter = new TracesAdapter(options);
    this.metricsAdapter = new MetricsAdapter(options);
    this.logsAdapter = new LogsAdapter(options);
  }
  
  // Core methods - delegate to core adapter
  public callRequest(method: string, url: string, data?: any, config?: any): Promise<any> {
    return this.coreAdapter.callRequest(method, url, data, config);
  }
  
  public async getIndices(): Promise<string[]> {
    return this.coreAdapter.getIndices();
  }
  
  public async checkConnection(): Promise<boolean> {
    return this.coreAdapter.checkConnection();
  }
  
  public async getInfo(): Promise<any> {
    return this.coreAdapter.getInfo();
  }
  
  public getType(): string {
    return this.coreAdapter.getType();
  }
  
  public async getVersion(): Promise<string> {
    return this.coreAdapter.getVersion();
  }
  
  public supportsFeature(feature: string): boolean {
    return this.coreAdapter.supportsFeature(feature);
  }
  
  // Traces methods - delegate to traces adapter
  public async analyzeTrace(traceId: string): Promise<any> {
    return this.tracesAdapter.analyzeTrace(traceId);
  }
  
  public async spanLookup(spanId: string): Promise<any | null> {
    return this.tracesAdapter.spanLookup(spanId);
  }
  
  public async serviceDependencyGraph(startTime: string, endTime: string, sampleRate: number = 1.0): Promise<any> {
    return this.tracesAdapter.serviceDependencyGraph(startTime, endTime, sampleRate);
  }
  
  public async buildServiceDependencyTree(directRelationships: any[]): Promise<any> {
    return this.tracesAdapter.buildServiceDependencyTree(directRelationships);
  }
  
  // Metrics methods - delegate to metrics adapter
  public async searchMetrics(query: any): Promise<any> {
    return this.metricsAdapter.searchMetrics(query);
  }
  
  public async getMetricFields(search?: string): Promise<any[]> {
    return this.metricsAdapter.getMetricFields(search);
  }
  
  /**
   * Detect metric anomalies using OpenSearch's ML capabilities
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
    return this.metricsAdapter.detectMetricAnomalies(startTime, endTime, options);
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
    return this.metricsAdapter.timeSeriesAnalysis(startTime, endTime, options);
  }
  
  // Logs methods - delegate to logs adapter
  public async searchLogs(query: any): Promise<any> {
    return this.logsAdapter.searchLogs(query);
  }
  
  public async getLogFields(search?: string): Promise<any[]> {
    return this.logsAdapter.getLogFields(search);
  }
  
  /**
   * Detect log anomalies using OpenSearch's ML capabilities
   */
  public async detectLogAnomalies(
    startTime: string, 
    endTime: string, 
    options: {
      service?: string,
      level?: string,
      queryString?: string,
      maxResults?: number,
      minCount?: number
    } = {}
  ): Promise<any> {
    return this.logsAdapter.detectLogAnomalies(startTime, endTime, options);
  }
  
  /**
   * Find similar log messages using OpenSearch's k-NN capabilities
   */
  public async findSimilarLogs(
    logMessage: string,
    options: {
      startTime?: string,
      endTime?: string,
      service?: string,
      level?: string,
      k?: number,
      minSimilarity?: number,
      includeVectors?: boolean
    } = {}
  ): Promise<any> {
    return this.logsAdapter.findSimilarLogs(logMessage, options);
  }
  
  /**
   * Cluster log messages using k-NN to identify patterns
   */
  public async clusterLogMessages(
    options: {
      startTime: string,
      endTime: string,
      service?: string,
      level?: string,
      maxSamples?: number,
      clusterCount?: number,
      minClusterSize?: number
    }
  ): Promise<any> {
    return this.logsAdapter.clusterLogMessages(options);
  }
  
  /**
   * Perform time series analysis on log data using OpenSearch's PPL
   */
  public async logTimeSeriesAnalysis(
    startTime: string,
    endTime: string,
    options: {
      service?: string,
      interval?: string,
      metricField?: string,
      queryString?: string,
      analysisType?: 'basic' | 'trend' | 'seasonality' | 'outliers' | 'full'
    } = {}
  ): Promise<any> {
    return this.logsAdapter.timeSeriesAnalysis(startTime, endTime, options);
  }
}

// Re-export types
export { OpenSearchAdapterOptions } from './core/core.js';
export { OpenSearchCore } from './core/core.js';
