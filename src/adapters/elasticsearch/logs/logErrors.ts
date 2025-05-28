import { ElasticsearchCore } from '../core/core.js';
import { logger } from '../../../utils/logger.js';
import { 
  LogErrorAnalysisModule,
  TraceErrorAnalysisModule 
} from './errors/index.js';

/**
 * Adapter for analyzing errors from logs and traces in Elasticsearch
 * This class delegates functionality to specialized modules
 */
export class LogErrorsAdapter extends ElasticsearchCore {
  private logErrorAnalysis: LogErrorAnalysisModule;
  private traceErrorAnalysis: TraceErrorAnalysisModule;

  constructor(options: any) {
    super(options);
    
    // Initialize modules
    this.logErrorAnalysis = new LogErrorAnalysisModule(this);
    this.traceErrorAnalysis = new TraceErrorAnalysisModule(this);
    
    logger.info('[LogErrorsAdapter] Initialized with modules');
  }

  /**
   * Get errors from logs following OpenTelemetry specification
   * 
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param N Number of top errors to return
   * @param serviceOrServices Optional service name or array of services to filter by
   * @param searchPattern Optional search pattern to filter errors
   * @returns Array of error objects with count and metadata
   */
  public async getErrorsFromLogs(
    startTime: string, 
    endTime: string, 
    N = 10, 
    serviceOrServices?: string | string[],
    searchPattern?: string
  ): Promise<{ 
    error: string, 
    count: number, 
    level?: string, 
    service?: string, 
    timestamp?: string, 
    trace_id?: string, 
    span_id?: string 
  }[]> {
    return this.logErrorAnalysis.getErrorsFromLogs(
      startTime,
      endTime,
      N,
      serviceOrServices,
      searchPattern
    );
  }

  /**
   * Get error distribution by service from logs
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @returns Array of service objects with error counts
   */
  public async getErrorDistributionByService(
    startTime: string,
    endTime: string
  ): Promise<Array<{ service: string, count: number }>> {
    return this.logErrorAnalysis.getErrorDistributionByService(startTime, endTime);
  }

  /**
   * Get error trends over time from logs
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param interval Time interval for buckets (e.g., '1h', '30m')
   * @param service Optional service name to filter by
   * @returns Array of time buckets with error counts
   */
  public async getErrorTrends(
    startTime: string,
    endTime: string,
    interval: string = '1h',
    service?: string
  ): Promise<Array<{ timestamp: string, count: number }>> {
    return this.logErrorAnalysis.getErrorTrends(startTime, endTime, interval, service);
  }

  /**
   * Get errors from traces
   * 
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param N Number of top errors to return
   * @param serviceOrServices Optional service name or array of services to filter by
   * @param searchPattern Optional search pattern to filter errors
   * @returns Array of error objects with count and metadata
   */
  public async getErrorsFromTraces(
    startTime: string, 
    endTime: string, 
    N = 10, 
    serviceOrServices?: string | string[],
    searchPattern?: string
  ): Promise<{ 
    error: string, 
    count: number, 
    service?: string, 
    timestamp?: string, 
    trace_id?: string, 
    span_id?: string,
    http_status_code?: number
  }[]> {
    return this.traceErrorAnalysis.getErrorsFromTraces(
      startTime,
      endTime,
      N,
      serviceOrServices,
      searchPattern
    );
  }

  /**
   * Get error distribution by service from traces
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @returns Array of service objects with error counts
   */
  public async getTraceErrorDistributionByService(
    startTime: string,
    endTime: string
  ): Promise<Array<{ service: string, count: number }>> {
    return this.traceErrorAnalysis.getTraceErrorDistributionByService(startTime, endTime);
  }

  /**
   * Get HTTP error distribution by status code from traces
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param service Optional service name to filter by
   * @returns Array of status code objects with counts
   */
  public async getHttpErrorDistribution(
    startTime: string,
    endTime: string,
    service?: string
  ): Promise<Array<{ status_code: number, count: number }>> {
    return this.traceErrorAnalysis.getHttpErrorDistribution(startTime, endTime, service);
  }

  /**
   * Get combined errors from both logs and traces
   * 
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param N Number of top errors to return
   * @param serviceOrServices Optional service name or array of services to filter by
   * @param searchPattern Optional search pattern to filter errors
   * @returns Array of error objects with count and metadata
   */
  public async getCombinedErrors(
    startTime: string, 
    endTime: string, 
    N = 10, 
    serviceOrServices?: string | string[],
    searchPattern?: string
  ): Promise<{ 
    error: string, 
    count: number, 
    source: 'log' | 'trace' | 'both',
    level?: string, 
    service?: string, 
    timestamp?: string, 
    trace_id?: string, 
    span_id?: string,
    http_status_code?: number
  }[]> {
    // Get errors from both sources
    const [logErrors, traceErrors] = await Promise.all([
      this.getErrorsFromLogs(startTime, endTime, N * 2, serviceOrServices, searchPattern),
      this.getErrorsFromTraces(startTime, endTime, N * 2, serviceOrServices, searchPattern)
    ]);
    
    // Combine and deduplicate errors
    const errorMap = new Map<string, {
      error: string, 
      count: number, 
      source: 'log' | 'trace' | 'both',
      level?: string, 
      service?: string, 
      timestamp?: string, 
      trace_id?: string, 
      span_id?: string,
      http_status_code?: number
    }>();
    
    // Process log errors
    for (const error of logErrors) {
      errorMap.set(error.error, {
        ...error,
        source: 'log'
      });
    }
    
    // Process trace errors and merge with log errors if they exist
    for (const error of traceErrors) {
      const existingError = errorMap.get(error.error);
      
      if (existingError) {
        // Merge the errors
        errorMap.set(error.error, {
          ...existingError,
          count: existingError.count + error.count,
          source: 'both',
          // Use the most recent timestamp
          timestamp: existingError.timestamp && error.timestamp 
            ? (new Date(existingError.timestamp) > new Date(error.timestamp) 
              ? existingError.timestamp 
              : error.timestamp)
            : (existingError.timestamp || error.timestamp),
          // Keep trace context if available
          trace_id: existingError.trace_id || error.trace_id,
          span_id: existingError.span_id || error.span_id,
          // Add HTTP status code if available
          http_status_code: error.http_status_code
        });
      } else {
        // Add as new trace error
        errorMap.set(error.error, {
          ...error,
          source: 'trace'
        });
      }
    }
    
    // Convert to array and sort by count
    const combinedErrors = Array.from(errorMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, N);
    
    logger.info('[LogErrorsAdapter] Returning combined errors', { count: combinedErrors.length });
    return combinedErrors;
  }
}
