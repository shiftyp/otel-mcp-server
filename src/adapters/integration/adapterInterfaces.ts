/**
 * This file defines interfaces for adapter compatibility with the integration layer.
 * It ensures that all adapters implement the methods expected by the TelemetryCorrelator.
 */

import { ErrorResponse } from '../../utils/errorHandling.js';

/**
 * Interface for logs adapters used by the integration layer
 */
export interface LogsAdapterInterface {
  /**
   * Search for logs with a flexible query structure
   */
  searchOtelLogs(options: {
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
  }): Promise<any[] | ErrorResponse>;
  
  /**
   * Find logs by trace ID or span IDs
   * This is for backward compatibility with the integration layer
   */
  findLogsByTraceOrSpanIds?(
    traceId: string,
    spanIds: string[],
    startTime: string,
    endTime: string,
    maxResults?: number
  ): Promise<any[] | ErrorResponse>;
}

/**
 * Interface for metrics adapters used by the integration layer
 */
export interface MetricsAdapterInterface {
  /**
   * Get metrics for a specific service
   */
  getMetricsForService(
    service: string,
    startTime: string,
    endTime: string,
    maxResults?: number
  ): Promise<any[] | ErrorResponse>;
}

/**
 * Interface for traces adapters used by the integration layer
 */
export interface TracesAdapterInterface {
  /**
   * Analyze a trace by traceId
   */
  analyzeTrace(traceId: string): Promise<any | ErrorResponse>;
  
  /**
   * Get service dependencies
   */
  getServiceDependencies(
    service: string,
    startTime: string,
    endTime: string
  ): Promise<any | ErrorResponse>;
}

/**
 * Interface for search adapters used by the integration layer
 */
export interface SearchAdapterInterface {
  logsAdapter: LogsAdapterInterface;
  metricsAdapter: MetricsAdapterInterface;
  tracesAdapter: TracesAdapterInterface;
}
