import { ElasticsearchCore } from '../core/core.js';
import { logger } from '../../../utils/logger.js';
import { TraceCore } from './modules/traceCore.js';
import { TraceAnalysis } from './modules/traceAnalysis.js';
import { ServiceDependencies } from './modules/serviceDependencies.js';
import { TraceQueries } from './modules/traceQueries.js';
import { createErrorResponse, ErrorResponse, isErrorResponse, withErrorHandling } from '../../../utils/errorHandling.js';
import { TimeRange, parseTimeRange, getDefaultTimeRange } from '../../../utils/timeRangeParser.js';
import { ServiceResolver } from '../../../utils/serviceResolver.js';

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
  public async analyzeTrace(traceId: string): Promise<any | ErrorResponse> {
    try {
      if (!traceId) {
        return createErrorResponse('Trace ID is required');
      }
      return this.traceAnalysis.analyzeTrace(traceId);
    } catch (error) {
      return createErrorResponse(`Error analyzing trace: ${error instanceof Error ? error.message : String(error)}`);
    }
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
  } | ErrorResponse> {
    try {
      const timeRange = parseTimeRange(startTime, endTime);
      if (isErrorResponse(timeRange)) {
        return timeRange;
      }
      
      return this.serviceDependencies.serviceDependencyGraph(timeRange.startTime, timeRange.endTime, sampleRate);
    } catch (error) {
      return createErrorResponse(`Error building service dependency graph: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Build a service dependency tree structure with relationship-specific metrics and nested paths
   */
  public buildServiceDependencyTree(directRelationships: { parent: string, child: string, count: number, errorCount?: number, errorRate?: number }[]) {
    return this.serviceDependencies.buildServiceDependencyTree(directRelationships);
  }

  /**
   * Get service dependencies - alias for serviceDependencyGraph to maintain compatibility
   * with the integration layer
   */
  public async getServiceDependencies(service: string, startTime: string, endTime: string): Promise<any | ErrorResponse> {
    try {
      // Parse and validate time range
      const timeRangeResult = parseTimeRange(startTime, endTime);
      if (isErrorResponse(timeRangeResult)) {
        return timeRangeResult;
      }
      
      const timeRange = timeRangeResult || getDefaultTimeRange();
      
      // Get the dependency graph
      const graph = await this.serviceDependencyGraph(timeRange.startTime, timeRange.endTime);
      
      // If we got an error response, return it
      if (isErrorResponse(graph)) {
        return graph;
      }
      
      // If a specific service was requested, filter the relationships
      if (service) {
        const filteredRelationships = graph.relationships.filter(rel => 
          rel.parent === service || rel.child === service
        );
        
        return {
          ...graph,
          relationships: filteredRelationships
        };
      }
      
      return graph;
    } catch (error) {
      return createErrorResponse(`Error getting service dependencies: ${error instanceof Error ? error.message : String(error)}`);
    }
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
  public async getServices(search?: string, startTime?: string, endTime?: string): Promise<Array<{name: string, versions: string[]}> | ErrorResponse> {
    try {
      // Use default time range if not provided
      let timeRange: TimeRange;
      if (startTime && endTime) {
        const parsedTimeRange = parseTimeRange(startTime, endTime);
        if (isErrorResponse(parsedTimeRange)) {
          return parsedTimeRange;
        }
        timeRange = parsedTimeRange;
      } else {
        timeRange = getDefaultTimeRange();
      }
      
      return this.traceQueries.getServices(search, timeRange.startTime, timeRange.endTime);
    } catch (error) {
      return createErrorResponse(`Error getting services: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get operations for a specific service
   */
  public async getOperations(service: string): Promise<string[]> {
    return this.traceQueries.getOperations(service);
  }
  
  /**
   * Get a complete trace by traceId
   * @param traceId Trace ID to retrieve
   * @returns Complete trace with all spans
   */
  public async getTrace(traceId: string): Promise<any | ErrorResponse> {
    try {
      if (!traceId) {
        return createErrorResponse('Trace ID is required');
      }
      
      // Get all spans for the trace
      const spans = await this.traceAnalysis.getAllSpansForTrace(traceId);
      if (!spans || spans.length === 0) {
        return createErrorResponse(`No spans found for trace ID: ${traceId}`);
      }
      
      // Organize spans into a trace structure
      const trace = {
        traceId,
        spans,
        services: new Set<string>(),
        duration: 0,
        timestamp: null,
        rootSpan: null
      };
      
      // Find the root span and calculate trace duration
      const rootSpan = await this.traceAnalysis.getRootSpan(traceId);
      if (rootSpan) {
        trace.rootSpan = rootSpan;
        trace.timestamp = rootSpan.timestamp || rootSpan.Timestamp;
        trace.duration = rootSpan.duration || rootSpan.Duration || 0;
      }
      
      // Extract unique services
      for (const span of spans) {
        const serviceName = span.serviceName || 
                          (span.Resource && span.Resource.service && span.Resource.service.name) ||
                          'unknown';
        trace.services.add(serviceName);
      }
      
      // Convert services Set to Array for JSON serialization
      return {
        ...trace,
        services: Array.from(trace.services)
      };
    } catch (error) {
      return createErrorResponse(`Error retrieving trace: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  

}
