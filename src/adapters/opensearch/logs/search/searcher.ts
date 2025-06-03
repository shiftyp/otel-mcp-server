import { logger } from '../../../../utils/logger.js';
import { LogsCoreAdapter } from '../core/adapter.js';
import { LogEntry, LogQueryOptions, LogSearchResponse } from '../core/types.js';

/**
 * Log search functionality
 */
export class LogSearcher {
  constructor(private readonly adapter: LogsCoreAdapter) {}

  /**
   * Search logs with various options
   */
  public async search(options: LogQueryOptions): Promise<LogSearchResponse> {
    logger.info('[LogSearcher] Searching logs', { options });

    const query = this.buildSearchQuery(options);
    const response = await this.adapter.searchLogs(query);

    return {
      logs: this.processLogHits(response.hits?.hits || []),
      total: response.hits?.total?.value || 0,
      aggregations: response.aggregations
    };
  }

  /**
   * Find logs by text search
   */
  public async findByText(
    text: string,
    options: Omit<LogQueryOptions, 'query'> = {}
  ): Promise<LogSearchResponse> {
    return this.search({
      ...options,
      query: text
    });
  }

  /**
   * Find logs by trace ID
   */
  public async findByTraceId(
    traceId: string,
    options: Omit<LogQueryOptions, 'traceId'> = {}
  ): Promise<LogSearchResponse> {
    return this.search({
      ...options,
      traceId
    });
  }

  /**
   * Find logs by service
   */
  public async findByService(
    service: string | string[],
    options: Omit<LogQueryOptions, 'service'> = {}
  ): Promise<LogSearchResponse> {
    return this.search({
      ...options,
      service
    });
  }

  /**
   * Find error logs
   */
  public async findErrors(
    options: Omit<LogQueryOptions, 'level'> = {}
  ): Promise<LogSearchResponse> {
    return this.search({
      ...options,
      level: ['error', 'fatal', 'critical']
    });
  }

  /**
   * Search with highlighting
   */
  public async searchWithHighlight(
    searchText: string,
    options: LogQueryOptions = {}
  ): Promise<LogSearchResponse & { highlights: Record<string, string[]>[] }> {
    const query = this.buildSearchQuery({ ...options, query: searchText });
    
    // Add highlighting
    query.highlight = {
      fields: {
        message: {},
        'attributes.*': {}
      },
      pre_tags: ['<mark>'],
      post_tags: ['</mark>']
    };

    const response = await this.adapter.searchLogs(query);
    const result = {
      logs: this.processLogHits(response.hits?.hits || []),
      total: response.hits?.total?.value || 0,
      aggregations: response.aggregations,
      highlights: response.hits?.hits?.map((hit: any) => hit.highlight || {}) || []
    };

    return result;
  }

  /**
   * Build search query from options
   */
  private buildSearchQuery(options: LogQueryOptions): any {
    const query: any = {
      size: options.size || 100,
      from: options.from || 0,
      query: { bool: { must: [], filter: [] } }
    };

    // Add text query
    if (options.query) {
      query.query.bool.must.push({
        query_string: {
          query: options.query,
          default_field: 'message',
          default_operator: 'AND'
        }
      });
    }

    // Add time range filter
    if (options.timeRange) {
      query.query.bool.filter.push({
        range: {
          '@timestamp': {
            gte: options.timeRange.from,
            lte: options.timeRange.to
          }
        }
      });
    }

    // Add service filter
    if (options.service) {
      const services = Array.isArray(options.service) ? options.service : [options.service];
      query.query.bool.filter.push({
        terms: { 'service.name': services }
      });
    }

    // Add level filter
    if (options.level) {
      const levels = Array.isArray(options.level) ? options.level : [options.level];
      query.query.bool.filter.push({
        terms: { level: levels.map(l => l.toLowerCase()) }
      });
    }

    // Add trace ID filter
    if (options.traceId) {
      query.query.bool.filter.push({
        term: { traceId: options.traceId }
      });
    }

    // Add span ID filter
    if (options.spanId) {
      query.query.bool.filter.push({
        term: { spanId: options.spanId }
      });
    }

    // Add sorting
    if (options.sort) {
      query.sort = options.sort;
    } else {
      query.sort = [{ '@timestamp': { order: 'desc' } }];
    }

    // Add source filtering
    if (options.fields) {
      query._source = options.fields;
    }

    // If no conditions, match all
    if (query.query.bool.must.length === 0 && query.query.bool.filter.length === 0) {
      query.query = { match_all: {} };
    }

    return query;
  }

  /**
   * Process log hits into structured entries
   */
  private processLogHits(hits: any[]): LogEntry[] {
    return hits.map(hit => ({
      timestamp: hit._source['@timestamp'] || hit._source.timestamp,
      level: hit._source.level || hit._source.SeverityText || 'info',
      message: hit._source.message || hit._source.Body || '',
      service: hit._source.service?.name || hit._source.resource?.service?.name,
      traceId: hit._source.traceId || hit._source.trace_id,
      spanId: hit._source.spanId || hit._source.span_id,
      attributes: this.extractAttributes(hit._source)
    }));
  }

  /**
   * Extract custom attributes from log source
   */
  private extractAttributes(source: any): Record<string, any> {
    const standardFields = [
      '@timestamp', 'timestamp', 'level', 'SeverityText', 
      'message', 'Body', 'service', 'resource', 
      'traceId', 'trace_id', 'spanId', 'span_id'
    ];

    const attributes: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(source)) {
      if (!standardFields.includes(key)) {
        attributes[key] = value;
      }
    }

    // Also include explicit attributes field
    if (source.attributes) {
      Object.assign(attributes, source.attributes);
    }

    return attributes;
  }
}