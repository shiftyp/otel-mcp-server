import { ElasticsearchAdapter } from '../elasticsearch/index.js';
import { OpenSearchAdapter } from '../opensearch/index.js';
import { SearchAdapterInterface } from './adapterInterfaces.js';
import { TimeRange, parseTimeRange } from '../../utils/timeRangeParser.js';
import { createErrorResponse, ErrorResponse, isErrorResponse } from '../../utils/errorHandling.js';
import { logger } from '../../utils/logger.js';

/**
 * Telemetry type enum
 */
export enum TelemetryType {
  LOGS = 'logs',
  TRACES = 'traces',
  METRICS = 'metrics'
}

/**
 * Telemetry correlation context
 */
export interface TelemetryContext {
  timeRange: TimeRange;
  service?: string;
  traceId?: string;
  spanId?: string;
  metricName?: string;
  query?: string;
  [key: string]: any;
}

/**
 * Correlation result
 */
export interface CorrelationResult {
  logs?: any[];
  traces?: any[];
  metrics?: any[];
  relationships?: any[];
  context?: TelemetryContext;
}

/**
 * Correlation options
 */
export interface CorrelationOptions {
  maxResults?: number;
  includeContext?: boolean;
  contextWindowSize?: number;
  minSimilarity?: number;
}

/**
 * Default correlation options
 */
const DEFAULT_OPTIONS: CorrelationOptions = {
  maxResults: 10,
  includeContext: true,
  contextWindowSize: 5,
  minSimilarity: 0.7
};

/**
 * TelemetryCorrelator class for cross-adapter integration
 * Facilitates communication between different telemetry types
 */
export class TelemetryCorrelator {
  constructor(
    private searchAdapter: SearchAdapterInterface
  ) {}

  /**
   * Correlates logs with a trace
   * @param traceId Trace ID to correlate with
   * @param timeRange Time range for correlation
   * @param options Correlation options
   * @returns Correlated logs
   */
  public async correlateLogsWithTrace(
    traceId: string,
    timeRange: TimeRange,
    options: CorrelationOptions = {}
  ): Promise<any[] | ErrorResponse> {
    try {
      logger.debug(`[TelemetryCorrelator] Correlating logs with trace ${traceId}`);
      
      // Get the trace first
      const trace = await this.searchAdapter.tracesAdapter.analyzeTrace(traceId);
      if (isErrorResponse(trace)) {
        return trace;
      }
      
      // Extract span IDs from the trace
      const spanIds = this.extractSpanIdsFromTrace(trace);
      if (spanIds.length === 0) {
        return createErrorResponse(`No spans found in trace ${traceId}`);
      }
      
      // Find logs with matching trace ID or span IDs using searchOtelLogs
      // Build a query that searches for the trace ID or any of the span IDs
      const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
      const searchResults = await this.searchAdapter.logsAdapter.searchOtelLogs({
        traceId: traceId,
        startTime: timeRange.startTime,
        endTime: timeRange.endTime,
        limit: mergedOptions.maxResults
      });
      
      if (isErrorResponse(searchResults)) {
        return searchResults;
      }
      
      return searchResults;
    } catch (error) {
      return createErrorResponse(
        `Error correlating logs with trace: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Correlates metrics with a service
   * @param service Service name
   * @param timeRange Time range for correlation
   * @param options Correlation options
   * @returns Correlated metrics
   */
  public async correlateMetricsWithService(
    service: string,
    timeRange: TimeRange,
    options: CorrelationOptions = {}
  ): Promise<any[] | ErrorResponse> {
    try {
      const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
      
      logger.debug(`Correlating metrics with service ${service}`);
      
      // Find metrics for the service
      const metrics = await this.searchAdapter.metricsAdapter.getMetricsForService(
        service,
        timeRange.startTime,
        timeRange.endTime,
        mergedOptions.maxResults
      );
      
      return metrics;
    } catch (error) {
      return createErrorResponse(
        `Error correlating metrics with service: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Correlates across all telemetry types
   * @param context Telemetry context
   * @param options Correlation options
   * @returns Correlation results
   */
  public async correlateAcrossTelemetry(
    context: TelemetryContext,
    options: CorrelationOptions = {}
  ): Promise<CorrelationResult | ErrorResponse> {
    try {
      const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
      const result: CorrelationResult = {
        context: { ...context }
      };
      
      logger.debug(`Correlating across telemetry types with context: ${JSON.stringify(context)}`);
      
      // If we have a trace ID, get related logs
      if (context.traceId) {
        const logs = await this.correlateLogsWithTrace(
          context.traceId,
          context.timeRange,
          mergedOptions
        );
        
        if (!isErrorResponse(logs)) {
          result.logs = logs;
        }
      }
      
      // If we have a service, get related metrics
      if (context.service) {
        const metrics = await this.correlateMetricsWithService(
          context.service,
          context.timeRange,
          mergedOptions
        );
        
        if (!isErrorResponse(metrics)) {
          result.metrics = metrics;
        }
        
        // Get service dependencies
        const dependencies = await this.searchAdapter.tracesAdapter.getServiceDependencies(
          context.service,
          context.timeRange.startTime,
          context.timeRange.endTime
        );
        
        if (!isErrorResponse(dependencies)) {
          result.relationships = dependencies;
        }
      }
      
      return result;
    } catch (error) {
      return createErrorResponse(
        `Error correlating across telemetry: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Extracts span IDs from a trace
   * @param trace Trace object
   * @returns Array of span IDs
   */
  private extractSpanIdsFromTrace(trace: any): string[] {
    const spanIds: string[] = [];
    
    if (!trace || !trace.spans) {
      return spanIds;
    }
    
    for (const span of trace.spans) {
      if (span.spanId) {
        spanIds.push(span.spanId);
      } else if (span.SpanId) {
        spanIds.push(span.SpanId);
      }
    }
    
    return spanIds;
  }
}
