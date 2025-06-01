import { EventEmitter } from 'events';
import { OpenSearchCore, OpenSearchAdapterOptions } from './core/core.js';
import { TracesAdapter } from './traces/index.js';
import { MetricsAdapter } from './metrics/index.js';
import { LogsAdapter } from './logs/index.js';
import { logger } from '../../utils/logger.js';
import { BaseSearchAdapter, SearchEngineType } from '../base/searchAdapter.js';
import { HistogramComparison } from './metrics/histogramComparison.js';
import { SemanticLogSearch } from './logs/semanticLogSearch.js';
import { DependencyEvolutionAnalysis } from './traces/dependencyEvolution.js';
// Import TraceAttributeClustering dynamically to avoid circular dependencies

/**
 * Main OpenSearchAdapter that combines functionality from specialized adapters
 * This adapter leverages OpenSearch-specific features including ML capabilities
 */
export class OpenSearchAdapter extends BaseSearchAdapter {
  public readonly coreAdapter: OpenSearchCore;
  public readonly tracesAdapter: TracesAdapter;
  public readonly metricsAdapter: MetricsAdapter;
  public readonly logsAdapter: LogsAdapter;
  private readonly dependencyEvolutionAnalysis: DependencyEvolutionAnalysis;
  
  constructor(options: OpenSearchAdapterOptions) {
    super(options);
    this.coreAdapter = new OpenSearchCore(options);
    this.tracesAdapter = new TracesAdapter(options);
    this.metricsAdapter = new MetricsAdapter(options);
    this.logsAdapter = new LogsAdapter(options);
    this.dependencyEvolutionAnalysis = new DependencyEvolutionAnalysis(options);
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
    return SearchEngineType.OPENSEARCH;
  }
  
  public async getVersion(): Promise<string> {
    return this.coreAdapter.getVersion();
  }
  
  public supportsFeature(feature: string): boolean {
    return this.coreAdapter.supportsFeature(feature);
  }
  
  /**
   * Query logs with custom query
   * @param query The query object
   */
  public async queryLogs(query: any): Promise<any> {
    logger.info('OpenSearchAdapter.queryLogs', { query });
    return this.logsAdapter.searchLogs(query);
  }
  
  /**
   * List available log fields
   * @param includeSourceDoc Whether to include source document fields
   */
  public async listLogFields(includeSourceDoc: boolean = true): Promise<any[]> {
    logger.info('OpenSearchAdapter.listLogFields', { includeSourceDoc });
    return this.logsAdapter.getLogFields(includeSourceDoc ? undefined : '');
  }
  
  /**
   * Query traces with custom query
   * @param query The query object
   */
  public async queryTraces(query: any): Promise<any> {
    logger.info('OpenSearchAdapter.queryTraces', { query });
    return this.tracesAdapter.searchTraces(query);
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
  
  /**
   * Compare histogram patterns across multiple time ranges
   * Phase 1 ML tool: Enhanced histogram comparison with statistical tests
   */
  public async compareHistogramPatterns(
    histogramData1: any[],
    histogramData2: any[],
    options: {
      compareMethod?: 'kl_divergence' | 'js_divergence' | 'wasserstein' | 'all';
      detectModes?: boolean;
      runStatTests?: boolean;
      smoothing?: number;
    } = {}
  ): Promise<any> {
    // Pass the metricsAdapter's core adapter to match the expected MetricsAdapterCore type
    return HistogramComparison.compareHistogramPatterns(
      (this.metricsAdapter as any).coreAdapter,
      histogramData1,
      histogramData2,
      {
        ...options,
        engineType: this.getType()
      }
    );
  }
  
  /**
   * Perform semantic search on logs with enhanced context handling
   * Phase 1 ML tool: Enhanced semantic log search with context handling
   */
  public async semanticLogSearch(
    query: string,
    options: {
      startTime?: string;
      endTime?: string;
      service?: string;
      level?: string;
      queryString?: string;
      k?: number;
      minSimilarity?: number;
      includeContext?: boolean;
      contextWindowSize?: number;
      samplingPercent?: number;
      embeddingProviderConfig?: import('./ml/embeddingProvider.js').EmbeddingProviderConfig;
    } = {}
  ): Promise<any> {
    // Create enhanced options with both the client and coreAdapter for proper embedding generation
    const enhancedOptions = {
      ...this.options,
      client: this.coreAdapter, // Pass the core adapter which has the callRequest method
      coreAdapter: this.coreAdapter // Also pass it as coreAdapter for direct access
    };
    
    const semanticSearch = new SemanticLogSearch(enhancedOptions);
    return semanticSearch.semanticLogSearch(query, {
      ...options,
      engineType: this.getType()
    });
  }
  
  /**
   * Analyze the evolution of service dependencies over time
   * Phase 1 ML tool: Enhanced dependency analysis with temporal tracking
   */
  public async analyzeDependencyEvolution(
    startTime1: string,
    endTime1: string,
    startTime2: string,
    endTime2: string,
    options: {
      service?: string;
      queryString?: string;
      minCallCount?: number;
      significantChangeThreshold?: number;
      errorRateChangeThreshold?: number;
    } = {}
  ): Promise<any> {
    return this.dependencyEvolutionAnalysis.analyzeDependencyEvolution(
      startTime1,
      endTime1,
      startTime2,
      endTime2,
      {
        ...options,
        engineType: this.getType()
      }
    );
  }
  
  /**
   * Cluster trace attributes to identify patterns
   * Phase 1 ML tool: Enhanced trace attribute analysis with clustering
   */
  public async clusterTraceAttributes(
    attributeKey: string,
    startTime: string,
    endTime: string,
    options: {
      service?: string;
      queryString?: string;
      clusterCount?: number;
      minClusterSize?: number;
      includeOutliers?: boolean;
      // Sampling parameters for embedding generation
      enableSampling?: boolean;
      samplingPercent?: number;
      maxSamples?: number;
      embeddingBatchSize?: number;
    } = {}
  ): Promise<any> {
    logger.info('[OpenSearchAdapter] Clustering trace attributes', {
      attributeKey,
      startTime,
      endTime
    });
    
    // Use the TracesAdapter's implementation which handles the dynamic import
    return this.tracesAdapter.clusterTraceAttributes(
      attributeKey,
      startTime,
      endTime,
      options
    );
  }
}

// Re-export types
export { OpenSearchAdapterOptions } from './core/core.js';
export { OpenSearchCore } from './core/core.js';
