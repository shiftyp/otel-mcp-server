import { OpenSearchCore } from '../core/core.js';
import { logger } from '../../../utils/logger.js';
import { createErrorResponse, ErrorResponse, isErrorResponse } from '../../../utils/errorHandling.js';
import {
  LogCore,
  LogFields,
  LogSemanticSearch,
  LogAnalysis,
  LogNLP,
  LogTimeSeriesAnalysis
} from './modules/index.js';

/**
 * OpenSearch Logs Adapter
 * Provides functionality for working with OpenTelemetry logs data in OpenSearch
 * Takes advantage of OpenSearch-specific ML capabilities for log analysis
 * 
 * This class delegates functionality to specialized modules to improve maintainability
 */
export class LogsAdapter extends OpenSearchCore {
  private coreModule: LogCore;
  private fieldsModule: LogFields;
  private semanticSearchModule: LogSemanticSearch;
  private analysisModule: LogAnalysis;
  private nlpModule: LogNLP;
  private timeSeriesModule: LogTimeSeriesAnalysis;
  
  constructor(options: any) {
    super(options);
    
    // Initialize modules
    this.coreModule = new LogCore(options);
    this.fieldsModule = new LogFields(options);
    this.semanticSearchModule = new LogSemanticSearch(options);
    this.analysisModule = new LogAnalysis(options);
    this.nlpModule = new LogNLP(options);
    this.timeSeriesModule = new LogTimeSeriesAnalysis(options);
    
    logger.info('[OpenSearch LogsAdapter] Initialized with modules');
  }

  /**
   * Make a request to OpenSearch
   */
  public async request(method: string, url: string, body: any) {
    return this.coreModule.request(method, url, body);
  }
  
  /**
   * Query logs with custom query (required by OpenSearchCore)
   * @param query The query object
   */
  public async queryLogs(query: any): Promise<any> {
    return this.coreModule.queryLogs(query);
  }
  
  /**
   * List available log fields (required by OpenSearchCore)
   * @param includeSourceDoc Whether to include source document fields
   */
  public async listLogFields(includeSourceDoc?: boolean): Promise<any[] | ErrorResponse> {
    return this.fieldsModule.listLogFields(includeSourceDoc);
  }
  
  /**
   * Search metrics with a custom query (required by OpenSearchCore)
   * @param query The query to execute
   */
  public async searchMetrics(query: any): Promise<any> {
    logger.warn('[OpenSearch LogsAdapter] searchMetrics called, but this is not a metrics adapter');
    return createErrorResponse('This is a logs adapter, not a metrics adapter');
  }
  
  /**
   * Query traces with a custom query (required by OpenSearchCore)
   * @param query The query to execute
   */
  public async queryTraces(query: any): Promise<any> {
    logger.warn('[OpenSearch LogsAdapter] queryTraces called, but this is not a traces adapter');
    return createErrorResponse('This is a logs adapter, not a traces adapter');
  }
  
  /**
   * Search logs with a semantic query
   * @param query Natural language query
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param service Optional service filter
   * @param level Optional log level filter
   * @param k Number of results to return
   * @param minSimilarity Minimum similarity score (0-1)
   */
  public async searchLogsWithSemanticQuery(
    query: string,
    startTime: string,
    endTime: string,
    service?: string,
    level?: string,
    k: number = 10,
    minSimilarity: number = 0.7
  ): Promise<any> {
    return this.semanticSearchModule.searchLogsWithSemanticQuery(
      query, startTime, endTime, service, level, k, minSimilarity
    );
  }
  
  /**
   * Search logs with a custom query
   * @param query The query object
   */
  public async searchLogs(query: any): Promise<any> {
    return this.coreModule.searchLogs(query);
  }
  
  /**
   * Get log fields with optional search filter
   * @param search Optional search term to filter fields
   */
  public async getLogFields(search?: string): Promise<any[] | ErrorResponse> {
    return this.fieldsModule.getLogFields(search);
  }
  
  /**
   * Detect anomalies in logs
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param service Optional service filter
   * @param level Optional log level filter
   * @param method Detection method (pattern or ngram)
   * @param minScore Minimum anomaly score (0-1)
   * @param maxResults Maximum number of results to return
   */
  public async detectLogAnomalies(
    startTime: string,
    endTime: string,
    service?: string,
    level?: string,
    method: 'pattern' | 'ngram' = 'pattern',
    minScore: number = 0.7,
    maxResults: number = 100
  ): Promise<any> {
    return this.analysisModule.detectLogAnomalies(
      startTime, endTime, service, level, method, minScore, maxResults
    );
  }
  
  /**
   * Find logs similar to a given log message
   * @param message Log message to find similar logs for
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param service Optional service filter
   * @param level Optional log level filter
   * @param k Number of results to return
   * @param minSimilarity Minimum similarity score (0-1)
   * @param includeContext Whether to include surrounding log context
   * @param contextWindowSize Number of logs before/after each match to include
   */
  public async findSimilarLogs(
    message: string,
    startTime: string,
    endTime: string,
    service?: string,
    level?: string,
    k: number = 10,
    minSimilarity: number = 0.7,
    includeContext: boolean = false,
    contextWindowSize: number = 5
  ): Promise<any> {
    return this.semanticSearchModule.findSimilarLogs(
      message, startTime, endTime, service, level, k, minSimilarity, includeContext, contextWindowSize
    );
  }
  
  /**
   * Cluster log messages to find patterns
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param service Optional service filter
   * @param level Optional log level filter
   * @param clusterCount Number of clusters to create
   * @param method Clustering method (kmeans or dbscan)
   * @param maxSamples Maximum number of samples to process
   */
  public async clusterLogMessages(
    startTime: string,
    endTime: string,
    service?: string,
    level?: string,
    clusterCount: number = 5,
    method: 'kmeans' | 'dbscan' = 'kmeans',
    maxSamples: number = 1000
  ): Promise<any> {
    return this.analysisModule.clusterLogMessages(
      startTime, endTime, service, level, clusterCount, method, maxSamples
    );
  }
  
  /**
   * Analyze sentiment of log messages
   * @param logs Array of log objects with message property
   */
  public async analyzeSentiment(logs: Array<{
    message: string;
    [key: string]: any;
  }>): Promise<any> {
    return this.nlpModule.analyzeSentiment(logs);
  }
  
  /**
   * Extract entities from log messages
   * @param logs Array of log objects with message property
   */
  public async extractEntities(logs: Array<{
    message: string;
    [key: string]: any;
  }>): Promise<any> {
    return this.nlpModule.extractEntities(logs);
  }
  
  /**
   * Classify logs into categories
   * @param logs Array of log objects with message property
   */
  public async classifyLogs(logs: Array<{
    message: string;
    [key: string]: any;
  }>): Promise<any> {
    return this.nlpModule.classifyLogs(logs);
  }
  
  /**
   * Perform time series analysis on logs
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param service Optional service filter
   * @param level Optional log level filter
   * @param interval Time interval for aggregation
   * @param metric Metric to analyze (count, error_rate, etc.)
   */
  public async timeSeriesAnalysis(
    startTime: string,
    endTime: string,
    service?: string,
    level?: string,
    interval: string = '1h',
    metric: 'count' | 'error_rate' | 'unique_services' = 'count'
  ): Promise<any> {
    return this.timeSeriesModule.timeSeriesAnalysis(
      startTime, endTime, service, level, interval, metric
    );
  }
  
  /**
   * Find logs by trace ID or span IDs
   * @param traceId Trace ID to search for
   * @param spanIds Array of span IDs to search for
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param maxResults Maximum number of results to return
   * @returns Array of log entries related to the trace or spans
   */
  public async findLogsByTraceOrSpanIds(
    traceId: string,
    spanIds: string[],
    startTime: string,
    endTime: string,
    maxResults: number = 100
  ): Promise<any[] | ErrorResponse> {
    try {
      logger.debug(`[LogsAdapter] Finding logs for trace ${traceId} with ${spanIds.length} spans`);
      
      if (!traceId && (!spanIds || spanIds.length === 0)) {
        return createErrorResponse('Either traceId or spanIds must be provided');
      }
      
      // Build query to find logs with matching trace or span IDs
      const should = [];
      
      // Add trace ID condition
      if (traceId) {
        should.push({ terms: { 'TraceId': [traceId] } });
        should.push({ terms: { 'trace_id': [traceId] } });
        should.push({ terms: { 'Attributes.trace_id': [traceId] } });
        should.push({ terms: { 'attributes.trace_id': [traceId] } });
      }
      
      // Add span IDs condition
      if (spanIds && spanIds.length > 0) {
        should.push({ terms: { 'SpanId': spanIds } });
        should.push({ terms: { 'span_id': spanIds } });
        should.push({ terms: { 'Attributes.span_id': spanIds } });
        should.push({ terms: { 'attributes.span_id': spanIds } });
      }
      
      // Add time range filter
      const timeRangeFilter = { range: { '@timestamp': { gte: startTime, lte: endTime } } };
      
      // Build the complete query
      const query = {
        query: {
          bool: {
            should,
            filter: [timeRangeFilter],
            minimum_should_match: 1
          }
        },
        size: maxResults,
        sort: [{ '@timestamp': { order: 'asc' } }]
      };
      
      // Execute the query
      const result = await this.searchLogs(query);
      
      if (isErrorResponse(result)) {
        return result;
      }
      
      if (!result.hits || !result.hits.hits) {
        return [];
      }
      
      // Extract and return log entries
      return result.hits.hits.map((hit: any) => {
        const source = hit._source;
        return {
          id: hit._id,
          timestamp: source['@timestamp'],
          service: source.Resource?.service?.name || source.service?.name || 'unknown',
          level: source.SeverityText || source.severityText || source.level || 'unknown',
          message: source.Body || source.body || source.message || '',
          trace_id: source.TraceId || source.trace_id || source.Attributes?.trace_id || source.attributes?.trace_id,
          span_id: source.SpanId || source.span_id || source.Attributes?.span_id || source.attributes?.span_id,
          attributes: source.Attributes || source.attributes || {}
        };
      });
    } catch (error) {
      return createErrorResponse(`Error finding logs by trace/span IDs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
