import { Hit } from '@opensearch-project/opensearch/api/_types/_core.search.js';
import { logger } from '../../../../utils/logger.js';
import { LogsCoreAdapter } from '../core/adapter.js';
import { LogEntry } from '../core/types.js';
import { EmbeddingProvider } from './embeddingProvider.js';

/**
 * Semantic search options
 */
export interface SemanticSearchOptions {
  timeRange?: { from: string; to: string };
  service?: string | string[];
  level?: string | string[];
  limit?: number;
  threshold?: number;
  includeContext?: boolean;
  useCache?: boolean;
}

/**
 * Semantic search result
 */
export interface SemanticSearchResult {
  log: LogEntry;
  score: number;
  explanation?: string;
  context?: {
    before: LogEntry[];
    after: LogEntry[];
  };
}

/**
 * Semantic log searcher using embeddings
 */
export class SemanticLogSearcher {
  constructor(
    private readonly adapter: LogsCoreAdapter,
    private readonly embeddingProvider: EmbeddingProvider
  ) {}

  /**
   * Search logs semantically
   */
  public async search(
    query: string,
    options: SemanticSearchOptions = {}
  ): Promise<SemanticSearchResult[]> {
    logger.info('[SemanticLogSearcher] Searching semantically', { query, options });

    try {
      // Generate embedding for query
      const queryEmbedding = await this.embeddingProvider.generateEmbedding(query);

      // Build search query
      const searchQuery = this.buildSemanticSearchQuery(queryEmbedding, options, query);
      
      // Execute search
      const response = await this.adapter.searchLogs(searchQuery);
      
      // Process results
      const results = this.processSearchResults(response, options);
      
      // Add context if requested
      if (options.includeContext) {
        await this.addContext(results);
      }

      return results;
    } catch (error) {
      logger.error('[SemanticLogSearcher] Error in semantic search', { error });
      throw error;
    }
  }

  /**
   * Find similar logs to a given log
   */
  public async findSimilar(
    logEntry: LogEntry,
    options: SemanticSearchOptions = {}
  ): Promise<SemanticSearchResult[]> {
    logger.info('[SemanticLogSearcher] Finding similar logs');

    const embedding = await this.embeddingProvider.generateEmbedding(
      logEntry.message
    );

    const searchQuery = this.buildSimilaritySearchQuery(
      embedding,
      logEntry,
      options
    );

    const response = await this.adapter.searchLogs(searchQuery);
    
    return this.processSearchResults(response, options);
  }

  /**
   * Search using natural language processing
   */
  public async nlpSearch(
    naturalQuery: string,
    options: SemanticSearchOptions = {}
  ): Promise<{
    results: SemanticSearchResult[];
    interpretation: {
      intent: string;
      entities: Record<string, string>;
      filters: Record<string, any>;
    };
  }> {
    logger.info('[SemanticLogSearcher] NLP search', { naturalQuery });

    // Parse natural language query
    const interpretation = this.parseNaturalQuery(naturalQuery);
    
    // Apply interpreted filters
    const searchOptions: SemanticSearchOptions = {
      ...options,
      ...interpretation.filters
    };

    // Perform semantic search with extracted query
    const results = await this.search(
      interpretation.intent,
      searchOptions
    );

    return {
      results,
      interpretation
    };
  }

  /**
   * Cluster similar logs
   */
  public async clusterLogs(
    options: SemanticSearchOptions = {}
  ): Promise<Array<{
    clusterId: string;
    centroid: string;
    logs: LogEntry[];
    commonPatterns: string[];
  }>> {
    logger.info('[SemanticLogSearcher] Clustering logs', { options });

    // Fetch logs
    const logs = await this.fetchLogs(options);
    
    if (logs.length === 0) {
      return [];
    }

    // Generate embeddings for all logs
    const embeddings = await Promise.all(
      logs.map(log => this.embeddingProvider.generateEmbedding(log.message))
    );

    // Perform clustering (simplified k-means)
    const clusters = this.kMeansClustering(logs, embeddings, 5);

    // Extract common patterns for each cluster
    return clusters.map(cluster => ({
      ...cluster,
      commonPatterns: this.extractCommonPatterns(cluster.logs)
    }));
  }

  // Private helper methods

  private buildSemanticSearchQuery(
    embedding: number[],
    options: SemanticSearchOptions,
    searchQuery?: string
  ): any {
    const query: any = {
      size: options.limit || 100,
      query: {
        bool: {
          must: [],
          filter: []
        }
      }
    };

    // For now, fall back to text-based search until vector embeddings are properly configured
    // This allows the tool to work even without ML pipeline setup
    logger.warn('[SemanticLogSearcher] Vector search not configured, falling back to text search');
    
    // Use a simple text match query instead of vector similarity
    if (searchQuery) {
      query.query.bool.must.push({
        match: {
          message: {
            query: searchQuery,
            fuzziness: 'AUTO'
          }
        }
      });
    }

    // Add filters
    this.addFilters(query, options);

    return query;
  }

  private buildSimilaritySearchQuery(
    embedding: number[],
    referenceLog: LogEntry,
    options: SemanticSearchOptions
  ): any {
    const query = this.buildSemanticSearchQuery(embedding, options);
    
    // Exclude the reference log itself
    query.query.bool.must_not = [{
      term: { '_id': referenceLog.timestamp } // Assuming timestamp as ID
    }];

    return query;
  }

  private addFilters(query: any, options: SemanticSearchOptions): void {
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

    if (options.service) {
      const services = Array.isArray(options.service) ? options.service : [options.service];
      query.query.bool.filter.push({
        terms: { 'service.name': services }
      });
    }

    if (options.level) {
      const levels = Array.isArray(options.level) ? options.level : [options.level];
      query.query.bool.filter.push({
        terms: { level: levels.map(l => l.toLowerCase()) }
      });
    }
  }

  private processSearchResults(
    response: any,
    options: SemanticSearchOptions
  ): SemanticSearchResult[] {
    const threshold = options.threshold || 0.5;
    const results: SemanticSearchResult[] = [];

    for (const hit of response.hits?.hits || []) {
      const score = hit._score || 0;
      
      if (score >= threshold) {
        results.push({
          log: this.hitToLogEntry(hit),
          score,
          explanation: this.explainScore(score)
        });
      }
    }

    return results;
  }

  private hitToLogEntry(hit: Required<Hit>): LogEntry {
    return {
      timestamp: hit._source['@timestamp'] || hit._source.timestamp,
      level: hit._source.level || hit._source.SeverityText || 'info',
      message: hit._source.message || hit._source.Body || '',
      service: hit._source.service?.name || hit._source.resource?.service?.name,
      traceId: hit._source.traceId || hit._source.trace_id,
      spanId: hit._source.spanId || hit._source.span_id,
      attributes: hit._source.attributes || {}
    };
  }

  private explainScore(score: number): string {
    if (score > 0.9) return 'Very high similarity';
    if (score > 0.7) return 'High similarity';
    if (score > 0.5) return 'Moderate similarity';
    return 'Low similarity';
  }

  private async addContext(results: SemanticSearchResult[]): Promise<void> {
    for (const result of results) {
      const context = await this.getLogContext(result.log);
      result.context = context;
    }
  }

  private async getLogContext(
    log: LogEntry
  ): Promise<{ before: LogEntry[]; after: LogEntry[] }> {
    const contextSize = 3;
    const timeWindow = 60000; // 1 minute
    const logTime = new Date(log.timestamp).getTime();

    const query = {
      size: contextSize * 2 + 1,
      query: {
        bool: {
          filter: [
            {
              range: {
                '@timestamp': {
                  gte: new Date(logTime - timeWindow).toISOString(),
                  lte: new Date(logTime + timeWindow).toISOString()
                }
              }
            }
          ]
        }
      },
      sort: [{ '@timestamp': { order: 'asc' } }]
    };

    if (log.service) {
      query.query.bool.filter.push({
        term: { 'service.name': log.service }
      } as any);
    }

    const response = await this.adapter.searchLogs(query);
    const contextLogs = (response.hits?.hits || []).map((hit: Required<Hit>) => 
      this.hitToLogEntry(hit)
    ) as LogEntry[];

    // Find the index of the current log
    const currentIndex = contextLogs.findIndex(
      l => l.timestamp === log.timestamp && l.message === log.message
    );

    if (currentIndex === -1) {
      return { before: [], after: [] };
    }

    return {
      before: contextLogs.slice(Math.max(0, currentIndex - contextSize), currentIndex),
      after: contextLogs.slice(currentIndex + 1, currentIndex + 1 + contextSize)
    };
  }

  private parseNaturalQuery(query: string): {
    intent: string;
    entities: Record<string, string>;
    filters: Record<string, any>;
  } {
    const entities: Record<string, string> = {};
    const filters: Record<string, any> = {};
    let intent = query;

    // Extract time references
    const timePatterns = [
      { pattern: /last (\d+) (hours?|minutes?|days?)/i, type: 'relative' },
      { pattern: /since (yesterday|today)/i, type: 'relative' },
      { pattern: /between (.+) and (.+)/i, type: 'range' }
    ];

    for (const { pattern, type } of timePatterns) {
      const match = query.match(pattern);
      if (match) {
        if (type === 'relative' && match[1] && match[2]) {
          const amount = parseInt(match[1]);
          const unit = match[2].toLowerCase();
          const now = new Date();
          const from = new Date(now);
          
          if (unit.startsWith('hour')) {
            from.setHours(now.getHours() - amount);
          } else if (unit.startsWith('minute')) {
            from.setMinutes(now.getMinutes() - amount);
          } else if (unit.startsWith('day')) {
            from.setDate(now.getDate() - amount);
          }
          
          filters.timeRange = {
            from: from.toISOString(),
            to: now.toISOString()
          };
          
          entities.timeRange = match[0];
          intent = intent.replace(match[0], '').trim();
        }
      }
    }

    // Extract service references
    const serviceMatch = query.match(/(?:from|in|service) (\w+)/i);
    if (serviceMatch) {
      filters.service = serviceMatch[1];
      entities.service = serviceMatch[1];
      intent = intent.replace(serviceMatch[0], '').trim();
    }

    // Extract level references
    const levelMatch = query.match(/\b(error|warning|info|debug)\b/i);
    if (levelMatch) {
      filters.level = levelMatch[1].toLowerCase();
      entities.level = levelMatch[1];
      intent = intent.replace(levelMatch[0], '').trim();
    }

    return {
      intent: intent || query,
      entities,
      filters
    };
  }

  private async fetchLogs(options: SemanticSearchOptions): Promise<LogEntry[]> {
    const query: any = {
      size: 1000,
      query: { bool: { must: [], filter: [] } }
    };

    this.addFilters(query, options);

    const response = await this.adapter.searchLogs(query);
    return (response.hits?.hits || []).map((hit: any) => this.hitToLogEntry(hit));
  }

  private kMeansClustering(
    logs: LogEntry[],
    embeddings: number[][],
    k: number
  ): Array<{
    clusterId: string;
    centroid: string;
    logs: LogEntry[];
  }> {
    // Simplified k-means implementation
    const clusters: Array<{
      clusterId: string;
      centroid: number[];
      logs: LogEntry[];
    }> = [];

    // Initialize random centroids
    const indices = new Set<number>();
    while (indices.size < k && indices.size < logs.length) {
      indices.add(Math.floor(Math.random() * logs.length));
    }

    Array.from(indices).forEach((idx, i) => {
      clusters.push({
        clusterId: `cluster-${i}`,
        centroid: embeddings[idx],
        logs: []
      });
    });

    // Assign logs to clusters (simplified - single iteration)
    for (let i = 0; i < logs.length; i++) {
      let minDist = Infinity;
      let closestCluster = 0;

      for (let j = 0; j < clusters.length; j++) {
        const dist = this.euclideanDistance(embeddings[i], clusters[j].centroid);
        if (dist < minDist) {
          minDist = dist;
          closestCluster = j;
        }
      }

      clusters[closestCluster].logs.push(logs[i]);
    }

    // Find representative log for each cluster
    return clusters.map(cluster => ({
      clusterId: cluster.clusterId,
      centroid: cluster.logs.length > 0 ? cluster.logs[0].message : '',
      logs: cluster.logs
    }));
  }

  private euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += Math.pow(a[i] - b[i], 2);
    }
    return Math.sqrt(sum);
  }

  private extractCommonPatterns(logs: LogEntry[]): string[] {
    const words = new Map<string, number>();
    
    // Count word frequencies
    for (const log of logs) {
      const tokens = log.message.toLowerCase().split(/\s+/);
      for (const token of tokens) {
        if (token.length > 3) { // Skip short words
          words.set(token, (words.get(token) || 0) + 1);
        }
      }
    }

    // Get most common words
    return Array.from(words.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }
}