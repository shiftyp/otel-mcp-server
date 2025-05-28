import { ElasticsearchCore } from '../../core/core.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Module for direct log querying functionality
 */
export class LogQueryModule {
  private esCore: ElasticsearchCore;

  constructor(esCore: ElasticsearchCore) {
    this.esCore = esCore;
  }

  /**
   * Execute a direct query against log indices
   * @param query Elasticsearch query object
   * @returns Query results
   */
  public async queryLogs(query: any): Promise<any> {
    logger.info('[ES Adapter] queryLogs called');
    
    try {
      // Determine the index pattern to use
      const indexPattern = '.ds-logs-*,logs*,*logs*,otel-logs*';
      
      // Add default sort by timestamp if not specified
      if (!query.sort) {
        query.sort = [{ '@timestamp': { order: 'desc' } }];
      }
      
      // Execute the query
      logger.debug('[ES Adapter] Executing direct log query', { 
        indexPattern,
        querySize: query.size || 'default',
        queryFrom: query.from || 'default'
      });
      
      const response = await this.esCore.callEsRequest('POST', `${indexPattern}/_search`, query);
      
      // Log the response size
      logger.info('[ES Adapter] Log query returned results', { 
        totalHits: response.hits?.total?.value || 0,
        returnedHits: response.hits?.hits?.length || 0
      });
      
      return response;
    } catch (error) {
      logger.error('[ES Adapter] Error executing log query', { error });
      throw error;
    }
  }

  /**
   * Count logs matching a query
   * @param query Elasticsearch query object
   * @returns Count result
   */
  public async countLogs(query: any): Promise<number> {
    logger.info('[ES Adapter] countLogs called');
    
    try {
      // Determine the index pattern to use
      const indexPattern = '.ds-logs-*,logs*,*logs*,otel-logs*';
      
      // Execute the count query
      const countQuery = { query: query.query };
      logger.debug('[ES Adapter] Executing log count query');
      
      const response = await this.esCore.callEsRequest('POST', `${indexPattern}/_count`, countQuery);
      
      // Return the count
      logger.info('[ES Adapter] Log count query returned', { count: response.count });
      return response.count || 0;
    } catch (error) {
      logger.error('[ES Adapter] Error executing log count query', { error });
      return 0;
    }
  }

  /**
   * Get a sample of logs for exploration
   * @param size Number of logs to sample
   * @returns Sample of logs
   */
  public async sampleLogs(size: number = 10): Promise<any> {
    logger.info('[ES Adapter] sampleLogs called', { size });
    
    const query = {
      size,
      query: {
        function_score: {
          query: { match_all: {} },
          random_score: {}
        }
      }
    };
    
    return this.queryLogs(query);
  }
}
