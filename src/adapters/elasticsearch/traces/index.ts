import { ElasticsearchCore } from '../core/core.js';
import { logger } from '../../../utils/logger.js';
import { TraceCore } from './modules/traceCore.js';
import { TraceAnalysis } from './modules/traceAnalysis.js';
import { ServiceDependencies } from './modules/serviceDependencies.js';
import { TraceQueries } from './modules/traceQueries.js';

/**
 * Main TracesAdapter that combines functionality from specialized trace modules
 */
export class TracesAdapter extends ElasticsearchCore {
  private traceAnalysis: TraceAnalysis;
  private serviceDependencies: ServiceDependencies;
  private traceQueries: TraceQueries;
  
  constructor(options: any) {
    super(options);
    this.traceAnalysis = new TraceAnalysis(options);
    this.serviceDependencies = new ServiceDependencies(options);
    this.traceQueries = new TraceQueries(options);
  }

  /**
   * Make a request to Elasticsearch
   */
  public async request(method: string, url: string, body: any) {
    return this.traceAnalysis.request(method, url, body);
  }

  /**
   * Analyze a trace by traceId
   */
  public async analyzeTrace(traceId: string): Promise<any> {
    return this.traceAnalysis.analyzeTrace(traceId);
  }
  
  /**
   * Lookup a span by spanId
   */
  public async spanLookup(spanId: string): Promise<any | null> {
    return this.traceAnalysis.spanLookup(spanId);
  }
  
  /**
   * Build a service dependency graph for a time window
   */
  public async serviceDependencyGraph(startTime: string, endTime: string, sampleRate: number = 1.0): Promise<{ 
    relationships: { parent: string, child: string, count: number, errorCount?: number, errorRate?: number }[],
    spanCounts: { processed: number, total: number, percentage: string }
  }> {
    return this.serviceDependencies.serviceDependencyGraph(startTime, endTime, sampleRate);
  }
  
  /**
   * Build a service dependency tree structure with relationship-specific metrics and nested paths
   */
  public buildServiceDependencyTree(directRelationships: { parent: string, child: string, count: number, errorCount?: number, errorRate?: number }[]) {
    return this.serviceDependencies.buildServiceDependencyTree(directRelationships);
  }
  
  /**
   * Execute a query against the traces index
   */
  public async queryTraces(query: any): Promise<any> {
    return this.traceQueries.queryTraces(query);
  }
  
  /**
   * Get a list of services from trace data
   */
  public async getServices(search?: string, startTime?: string, endTime?: string): Promise<Array<{name: string, versions: string[]}>> {
    return this.traceQueries.getServices(search, startTime, endTime);
  }
  
  /**
   * Get operations for a specific service
   */
  public async getOperations(service: string): Promise<string[]> {
    return this.traceQueries.getOperations(service);
  }
}
