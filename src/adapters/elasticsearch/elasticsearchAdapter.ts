import { ElasticsearchCore, ElasticsearchAdapterOptions } from './core/core.js';
import { TracesAdapter } from './traces/index.js';
import { MetricsAdapter } from './metrics/metrics.js';
import { LogsAdapter } from './logs/logs.js';
import { BaseSearchAdapter, SearchEngineType } from '../base/searchAdapter.js';
import { logger } from '../../utils/logger.js';
import { createErrorResponse, ErrorResponse, isErrorResponse } from '../../utils/errorHandling.js';
import { 
  CoreAdapter, 
  ServiceDiscovery, 
  DependencyGraph,
  TraceAnalysis,
  ErrorAnalysis
} from './modules/index.js';

/**
 * Main ElasticsearchAdapter that combines functionality from specialized adapters
 * and modules using a facade pattern
 */
export class ElasticsearchAdapter extends BaseSearchAdapter {
  public readonly tracesAdapter: TracesAdapter;
  public readonly metricsAdapter: MetricsAdapter;
  public readonly logsAdapter: LogsAdapter;
  
  // Core modules
  private readonly coreModule: CoreAdapter;
  private readonly serviceDiscoveryModule: ServiceDiscovery;
  private readonly dependencyGraphModule: DependencyGraph;
  private readonly traceAnalysisModule: TraceAnalysis;
  private readonly errorAnalysisModule: ErrorAnalysis;
  
  constructor(options: ElasticsearchAdapterOptions) {
    super(options);
    
    // Initialize specialized adapters
    this.tracesAdapter = new TracesAdapter(options);
    this.metricsAdapter = new MetricsAdapter(options);
    this.logsAdapter = new LogsAdapter(options);
    
    // Initialize modules
    this.coreModule = new CoreAdapter(options);
    this.serviceDiscoveryModule = new ServiceDiscovery(options);
    this.dependencyGraphModule = new DependencyGraph(options);
    this.traceAnalysisModule = new TraceAnalysis(options);
    this.errorAnalysisModule = new ErrorAnalysis(options);
  }
  
  //===========================================================================
  // Core methods - implement BaseSearchAdapter abstract methods
  //===========================================================================
  
  /**
   * Make a request to Elasticsearch
   */
  public callRequest(method: string, url: string, data?: any, config?: any): Promise<any> {
    return this.coreModule.callRequest(method, url, data, config);
  }
  
  /**
   * Get a list of indices in Elasticsearch
   */
  public async getIndices(): Promise<string[]> {
    const result = await this.coreModule.getIndices();
    if (isErrorResponse(result)) {
      logger.error('[ES Adapter] Error getting indices', { error: result });
      return [];
    }
    return result;
  }
  
  /**
   * Search metrics with a custom query
   */
  public searchMetrics(query: any): Promise<any> {
    return this.metricsAdapter.searchMetrics(query);
  }
  
  /**
   * Query logs with a custom query
   */
  public queryLogs(query: any): Promise<any> {
    return this.logsAdapter.queryLogs(query);
  }
  
  /**
   * List available log fields
   */
  public listLogFields(includeSourceDoc?: boolean): Promise<any[]> {
    return this.logsAdapter.listLogFields(includeSourceDoc);
  }
  
  /**
   * Check if the Elasticsearch connection is working
   */
  public async checkConnection(): Promise<boolean> {
    const result = await this.coreModule.checkConnection();
    if (isErrorResponse(result)) {
      logger.error('[ES Adapter] Error checking connection', { error: result });
      return false;
    }
    return result;
  }
  
  /**
   * Get information about the Elasticsearch cluster
   */
  public getInfo(): Promise<any | ErrorResponse> {
    return this.coreModule.getInfo();
  }
  
  /**
   * Get the search engine type
   */
  public getType(): string {
    return SearchEngineType.ELASTICSEARCH;
  }
  
  /**
   * Get the Elasticsearch version
   */
  public async getVersion(): Promise<string> {
    const result = await this.coreModule.getVersion();
    if (isErrorResponse(result)) {
      logger.error('[ES Adapter] Error getting version', { error: result });
      return 'unknown';
    }
    return result;
  }
  
  /**
   * Check if a feature is supported
   */
  public supportsFeature(feature: string): boolean {
    return this.coreModule.supportsFeature(feature);
  }
  
  /**
   * Legacy method for backward compatibility
   */
  public callEsRequest(method: string, url: string, data?: any, config?: any): Promise<any> {
    return this.callRequest(method, url, data, config);
  }
  
  //===========================================================================
  // Traces methods
  //===========================================================================
  
  /**
   * Analyze a trace by its trace ID
   */
  public analyzeTrace(traceId: string): Promise<any | ErrorResponse> {
    return this.traceAnalysisModule.analyzeTrace(traceId);
  }
  
  /**
   * Lookup a span by its span ID
   */
  public spanLookup(spanId: string): Promise<any | ErrorResponse> {
    return this.traceAnalysisModule.spanLookup(spanId);
  }
  
  /**
   * Get service dependency graph data
   */
  public serviceDependencyGraph(
    startTime: string, 
    endTime: string, 
    sampleRate: number = 1.0
  ): Promise<{ 
    relationships: { parent: string, child: string, count: number, errorCount?: number, errorRate?: number }[],
    spanCounts: { processed: number, total: number, percentage: string }
  } | ErrorResponse> {
    return this.dependencyGraphModule.serviceDependencyGraph(startTime, endTime, sampleRate);
  }
  
  /**
   * Build a service dependency tree structure with relationship-specific metrics and nested paths
   */
  public buildServiceDependencyTree(
    directRelationships: { parent: string, child: string, count: number, errorCount?: number, errorRate?: number }[]
  ): Promise<{ 
    rootServices: string[];
    serviceTree: Map<string, {
      children: {
        serviceName: string;
        metrics: {
          calls: number;
          errors: number;
          errorRate: number;
          errorRatePercentage: number;
        };
        path: {
          minLatency?: number;
          maxLatency?: number;
          avgLatency?: number;
          p95Latency?: number;
          p99Latency?: number;
        };
      }[];
      parents: {
        serviceName: string;
        metrics: {
          calls: number;
          errors: number;
          errorRate: number;
          errorRatePercentage: number;
        };
      }[];
      metrics: {
        incomingCalls: number;
        outgoingCalls: number;
        errors: number;
        errorRate: number;
        errorRatePercentage: number;
      };
    }>;
  } | ErrorResponse> {
    return this.dependencyGraphModule.buildServiceDependencyTree(directRelationships);
  }
  
  /**
   * Query traces with a custom query
   */
  public queryTraces(query: any): Promise<any | ErrorResponse> {
    return this.traceAnalysisModule.queryTraces(query);
  }
  
  //===========================================================================
  // Service discovery methods
  //===========================================================================
  
  /**
   * Get a list of all services across all telemetry types (traces, metrics, and logs)
   */
  public getServices(
    search?: string, 
    startTime?: string, 
    endTime?: string
  ): Promise<Array<{name: string, versions: string[]}> | ErrorResponse> {
    return this.serviceDiscoveryModule.getServices(search, startTime, endTime);
  }
  
  /**
   * Get operations for a specific service
   */
  public getOperations(service: string): Promise<string[] | ErrorResponse> {
    return this.serviceDiscoveryModule.getOperations(service);
  }
  
  /**
   * Get services from metrics data
   */
  public getServicesFromMetrics(
    search?: string, 
    startTime?: string, 
    endTime?: string
  ): Promise<Array<{name: string, versions: string[]}> | ErrorResponse> {
    return this.serviceDiscoveryModule.getServicesFromMetrics(search, startTime, endTime);
  }
  
  /**
   * Get services from logs data
   */
  public getServicesFromLogs(
    search?: string, 
    startTime?: string, 
    endTime?: string
  ): Promise<Array<{name: string, versions: string[]}> | ErrorResponse> {
    return this.serviceDiscoveryModule.getServicesFromLogs(search, startTime, endTime);
  }
  
  //===========================================================================
  // Metrics methods
  //===========================================================================
  
  /**
   * List available metric fields
   */
  public listMetricFields(): Promise<Array<{ name: string, type: string }>> {
    return this.metricsAdapter.listMetricFields();
  }
  
  /**
   * Aggregate metrics over a time range
   */
  public aggregateOtelMetricsRange(
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
    return this.metricsAdapter.aggregateOtelMetricsRange(options);
  }
  
  /**
   * Query metrics with a custom query
   */
  public queryMetrics(query: any): Promise<any> {
    return this.metricsAdapter.queryMetrics(query);
  }
  
  //===========================================================================
  // Logs methods
  //===========================================================================
  
  /**
   * Search logs with specific criteria
   */
  public searchOtelLogs(
    options: {
      query?: string;
      service?: string;
      level?: string;
      startTime?: string;
      endTime?: string;
      limit?: number;
      offset?: number;
      sortDirection?: 'asc' | 'desc';
      traceId?: string;
      spanId?: string;
    }
  ): Promise<any[]> {
    return this.logsAdapter.searchOtelLogs(options);
  }
  
  /**
   * Get top errors for a time range
   */
  public topErrors(
    options: {
      startTime: string;
      endTime: string;
      limit?: number;
      service?: string;
      includeExamples?: boolean;
    }
  ): Promise<Array<{
    error: string;
    count: number;
    service: string;
    examples?: Array<{
      timestamp: string;
      message: string;
      trace_id?: string;
      service: string;
    }>;
  }> | ErrorResponse> {
    return this.errorAnalysisModule.topErrors(options);
  }
  
  //===========================================================================
  // Resource discovery methods
  //===========================================================================
  
  /**
   * Discover resources in Elasticsearch
   */
  public discoverResources(): Promise<any[] | ErrorResponse> {
    return this.coreModule.discoverResources();
  }
}
