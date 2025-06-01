import { ElasticsearchCore } from '../core/core.js';
import { logger } from '../../../utils/logger.js';
import { 
  LogFieldsModule, 
  LogSearchModule, 
  LogErrorsModule, 
  LogQueryModule 
} from './modules/index.js';
import { createErrorResponse, ErrorResponse, isErrorResponse } from '../../../utils/errorHandling.js';
import { createBoolQuery, createTermsQuery, createRangeQuery } from '../../../utils/queryBuilder.js';

/**
 * Adapter for interacting with logs in Elasticsearch
 * This class delegates functionality to specialized modules
 */
export class LogsAdapter extends ElasticsearchCore {
  private fieldsModule: LogFieldsModule;
  private searchModule: LogSearchModule;
  private errorsModule: LogErrorsModule;
  public readonly queryModule: LogQueryModule;

  constructor(options: any) {
    super(options);
    
    // Initialize modules
    this.fieldsModule = new LogFieldsModule(this);
    this.searchModule = new LogSearchModule(this);
    this.errorsModule = new LogErrorsModule(this);
    this.queryModule = new LogQueryModule(this);
    
    logger.info('[LogsAdapter] Initialized with modules');
  }

  /**
   * List all log fields and their types from logs indices
   * @param includeSourceDocument Whether to include fields from the _source document
   * @returns Array of { name, type, count, schema }
   */
  public async listLogFields(includeSourceDocument: boolean = true): Promise<Array<{ name: string, type: string, count: number, schema: any }>> {
    return this.fieldsModule.listLogFields(includeSourceDocument);
  }

  /**
   * Search for logs with a flexible query structure
   * @param options Search options
   * @returns Array of log objects
   */
  public async searchOtelLogs(
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
    return this.searchModule.searchOtelLogs(options);
  }

  /**
   * Get top errors from logs
   * @param options Options for error analysis
   * @returns Array of top errors with counts and examples
   */
  public async topErrors(
    options: {
      startTime?: string;
      endTime?: string;
      service?: string;
      limit?: number;
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
  }>> {
    return this.errorsModule.topErrors(options);
  }

  /**
   * Execute a direct query against log indices
   * @param query Elasticsearch query object
   * @returns Query results
   */
  public async queryLogs(query: any): Promise<any> {
    return this.queryModule.queryLogs(query);
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
        should.push(createTermsQuery('TraceId', [traceId]));
        should.push(createTermsQuery('trace_id', [traceId]));
        should.push(createTermsQuery('Attributes.trace_id', [traceId]));
        should.push(createTermsQuery('attributes.trace_id', [traceId]));
      }
      
      // Add span IDs condition
      if (spanIds && spanIds.length > 0) {
        should.push(createTermsQuery('SpanId', spanIds));
        should.push(createTermsQuery('span_id', spanIds));
        should.push(createTermsQuery('Attributes.span_id', spanIds));
        should.push(createTermsQuery('attributes.span_id', spanIds));
      }
      
      // Add time range filter
      const timeRangeFilter = createRangeQuery('@timestamp', startTime, endTime);
      
      // Build the complete query
      const query = {
        query: createBoolQuery({
          should,
          filter: [timeRangeFilter],
          minimumShouldMatch: 1
        }),
        size: maxResults,
        sort: [{ '@timestamp': { order: 'asc' } }]
      };
      
      // Execute the query
      const result = await this.queryLogs(query);
      
      if (!result || !result.hits || !result.hits.hits) {
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

  /**
   * Count logs matching a query
   * @param query Elasticsearch query object
   * @returns Count result
   */
  public async countLogs(query: any): Promise<number> {
    return this.queryModule.countLogs(query);
  }

  /**
   * Get a sample of logs for exploration
   * @param size Number of logs to sample
   * @returns Sample of logs
   */
  public async sampleLogs(size: number = 10): Promise<any> {
    return this.queryModule.sampleLogs(size);
  }
}
