import { BoolQuery } from '@opensearch-project/opensearch/api/_types/_common.query_dsl.js';
import { logger } from '../../../../utils/logger.js';
import { ILogsAdapter } from '../core/interface.js';
import { LogEntry } from './logAnalyzer.js';

/**
 * Semantic search options
 */
export interface SemanticSearchOptions {
  k?: number;
  minSimilarity?: number;
  timeRange?: { from: string; to: string };
  service?: string;
  level?: string;
  includeContext?: boolean;
  contextSize?: number;
}

/**
 * Semantic search result
 */
export interface SemanticSearchResult {
  log: LogEntry;
  score: number;
  highlights?: string[];
  context?: {
    before: LogEntry[];
    after: LogEntry[];
  };
}

/**
 * Clean semantic search for logs
 */
export class LogSemanticSearcher {
  constructor(
    private readonly adapter: ILogsAdapter
  ) {}

  /**
   * Search logs semantically
   */
  public async search(
    query: string,
    options: SemanticSearchOptions = {}
  ): Promise<SemanticSearchResult[]> {
    const k = options.k || 10;
    const minSimilarity = options.minSimilarity || 0.7;
    
    logger.info('[LogSemanticSearcher] Searching logs', {
      query,
      options
    });

    try {
      // Build search query
      const searchQuery = this.buildSemanticQuery(query, options);
      
      // Execute search
      const response = await this.adapter.searchLogs(searchQuery);
      
      if (!response.hits?.hits) {
        return [];
      }

      // Process results
      const results: SemanticSearchResult[] = [];
      
      for (const hit of response.hits.hits) {
        const score = (hit._score ?? 0) / ((hit._score ?? 0) + 1); // Normalize score to 0-1
        
        if (score >= minSimilarity) {
          const log = this.extractLogEntry(hit._source);
          
          const result: SemanticSearchResult = {
            log,
            score,
            highlights: hit.highlight?.message || []
          };

          // Add context if requested
          if (options.includeContext) {
            result.context = await this.getLogContext(
              log,
              options.contextSize || 3
            );
          }

          results.push(result);
        }
      }

      return results.slice(0, k);
    } catch (error) {
      logger.error('[LogSemanticSearcher] Search error', { error });
      throw error;
    }
  }

  /**
   * Find similar logs
   */
  public async findSimilar(
    referenceLog: LogEntry,
    options: SemanticSearchOptions = {}
  ): Promise<SemanticSearchResult[]> {
    logger.info('[LogSemanticSearcher] Finding similar logs', {
      referenceLog: referenceLog.message.substring(0, 100),
      options
    });

    // Use the message as the query
    return this.search(referenceLog.message, {
      ...options,
      // Exclude the reference log itself
      minSimilarity: options.minSimilarity || 0.8
    });
  }

  /**
   * Search with natural language query
   */
  public async nlpSearch(
    query: string,
    options: SemanticSearchOptions = {}
  ): Promise<{
    results: SemanticSearchResult[];
    interpretation: {
      intent: string;
      entities: Record<string, string>;
      filters: Record<string, any>;
    };
  }> {
    logger.info('[LogSemanticSearcher] NLP search', { query });

    // Parse natural language query
    const interpretation = this.interpretQuery(query);
    
    // Apply interpreted filters to options
    const enhancedOptions = {
      ...options,
      ...interpretation.filters
    };

    // Perform search with interpreted query
    const results = await this.search(
      interpretation.intent,
      enhancedOptions
    );

    return {
      results,
      interpretation
    };
  }

  // Private helper methods

  private buildSemanticQuery(query: string, options: SemanticSearchOptions): any {
    const must: any[] = [];
    const should: any[] = [];
    const filter: any[] = [];

    // Main search query
    should.push({
      match: {
        message: {
          query,
          boost: 2
        }
      }
    });

    // Also search in attributes
    should.push({
      match: {
        'attributes.*': {
          query,
          boost: 1
        }
      }
    });

    // Add time range filter
    if (options.timeRange) {
      filter.push({
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
      filter.push({
        term: {
          'service.name': options.service
        }
      });
    }

    // Add level filter
    if (options.level) {
      filter.push({
        term: {
          level: options.level.toLowerCase()
        }
      });
    }

    return {
      size: (options.k || 10) * 2, // Get extra for filtering
      query: {
        bool: {
          must,
          should,
          filter,
          minimum_should_match: 1
        }
      },
      highlight: {
        fields: {
          message: {
            fragment_size: 150,
            number_of_fragments: 3
          }
        }
      },
      _source: true
    };
  }

  private extractLogEntry(source: any): LogEntry {
    return {
      timestamp: source['@timestamp'] || source.timestamp,
      level: source.level || source.SeverityText || 'info',
      message: source.message || source.Body || '',
      service: source.service?.name || source.resource?.service?.name,
      traceId: source.traceId || source.trace_id,
      spanId: source.spanId || source.span_id,
      attributes: source.attributes || {}
    };
  }

  private async getLogContext(
    log: LogEntry,
    contextSize: number
  ): Promise<{ before: LogEntry[]; after: LogEntry[] }> {
    const timeWindow = 60000; // 1 minute window
    const logTime = new Date(log.timestamp).getTime();

    // Query for logs before
    const beforeQuery = {
      size: contextSize,
      query: {
        bool: {
          filter: [
            {
              range: {
                '@timestamp': {
                  gte: new Date(logTime - timeWindow).toISOString(),
                  lt: log.timestamp
                }
              }
            }
          ] as Required<BoolQuery>['filter'][]
        }
      },
      sort: [{ '@timestamp': { order: 'desc' } }]
    };

    // Query for logs after
    const afterQuery = {
      size: contextSize,
      query: {
        bool: {
          filter: [
            {
              range: {
                '@timestamp': {
                  gt: log.timestamp,
                  lte: new Date(logTime + timeWindow).toISOString()
                }
              }
            }
          ] as Required<BoolQuery>['filter'][]
        }
      },
      sort: [{ '@timestamp': { order: 'asc' } }]
    };

    // Add service filter if available
    if (log.service) {
      beforeQuery.query.bool.filter.push({
        term: { 'service.name': log.service }
      });
      afterQuery.query.bool.filter.push({
        term: { 'service.name': log.service }
      });
    }

    const [beforeResponse, afterResponse] = await Promise.all([
      this.adapter.searchLogs(beforeQuery),
      this.adapter.searchLogs(afterQuery)
    ]);

    return {
      before: (beforeResponse.hits?.hits || [])
        .map((hit: any) => this.extractLogEntry(hit._source))
        .reverse(),
      after: (afterResponse.hits?.hits || [])
        .map((hit: any) => this.extractLogEntry(hit._source))
    };
  }

  private interpretQuery(query: string): {
    intent: string;
    entities: Record<string, string>;
    filters: Record<string, any>;
  } {
    const lowerQuery = query.toLowerCase();
    const entities: Record<string, string> = {};
    const filters: Record<string, any> = {};
    let intent = query;

    // Extract time references
    const timePatterns = [
      { pattern: /last (\d+) (minutes?|hours?|days?)/i, key: 'timeRange' },
      { pattern: /past (\d+) (minutes?|hours?|days?)/i, key: 'timeRange' },
      { pattern: /since (\d+ (?:minutes?|hours?|days?) ago)/i, key: 'timeRange' }
    ];

    for (const { pattern, key } of timePatterns) {
      const match = query.match(pattern);
      if (match) {
        entities[key] = match[0];
        intent = intent.replace(match[0], '').trim();
        
        // Convert to time range
        const value = parseInt(match[1]);
        const unit = match[2].replace(/s$/, '');
        const now = new Date();
        const from = new Date(now);
        
        switch (unit) {
          case 'minute':
            from.setMinutes(from.getMinutes() - value);
            break;
          case 'hour':
            from.setHours(from.getHours() - value);
            break;
          case 'day':
            from.setDate(from.getDate() - value);
            break;
        }
        
        filters.timeRange = {
          from: from.toISOString(),
          to: now.toISOString()
        };
      }
    }

    // Extract service references
    const serviceMatch = query.match(/(?:from|in|service[:\s]+)(\S+)/i);
    if (serviceMatch) {
      entities.service = serviceMatch[1];
      filters.service = serviceMatch[1];
      intent = intent.replace(serviceMatch[0], '').trim();
    }

    // Extract level references
    const levelPatterns = ['error', 'warn', 'warning', 'info', 'debug'];
    for (const level of levelPatterns) {
      if (lowerQuery.includes(level)) {
        entities.level = level;
        filters.level = level === 'warning' ? 'warn' : level;
        intent = intent.replace(new RegExp(level, 'gi'), '').trim();
      }
    }

    // Clean up intent
    intent = intent.replace(/\s+/g, ' ').trim();
    if (!intent) {
      intent = 'logs';
    }

    return { intent, entities, filters };
  }
}