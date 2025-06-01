import { LogCore } from './logCore.js';
import { logger } from '../../../../utils/logger.js';
import { createErrorResponse, ErrorResponse, isErrorResponse } from '../../../../utils/errorHandling.js';
import { SemanticLogSearch } from '../semanticLogSearch.js';

/**
 * Semantic search functionality for the OpenSearch Logs Adapter
 */
export class LogSemanticSearch extends LogCore {
  private semanticSearch: SemanticLogSearch;
  
  constructor(options: any) {
    super(options);
    this.semanticSearch = new SemanticLogSearch(options);
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
  ): Promise<any | ErrorResponse> {
    try {
      logger.info('[OpenSearch LogSemanticSearch] searchLogsWithSemanticQuery called', {
        query, startTime, endTime, service, level, k, minSimilarity
      });
      
      // Validate inputs
      if (!query || query.trim() === '') {
        return createErrorResponse('Query is required');
      }
      
      // Use the semantic search implementation
      // Use the real semanticLogSearch method
      return this.semanticSearch.semanticLogSearch(
        query,
        {
          startTime,
          endTime,
          service,
          level,
          k,
          minSimilarity
        }
      );
    } catch (error) {
      return createErrorResponse(`Error searching logs with semantic query: ${error instanceof Error ? error.message : String(error)}`);
    }
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
  ): Promise<any | ErrorResponse> {
    try {
      logger.info('[OpenSearch LogSemanticSearch] findSimilarLogs called', {
        startTime, endTime, service, level, k, minSimilarity, includeContext, contextWindowSize
      });
      
      // Validate inputs
      if (!message || message.trim() === '') {
        return createErrorResponse('Message is required');
      }
      
      // Use the semantic search implementation
      // Use the real semanticLogSearch method to find similar logs by treating message as query
      return this.semanticSearch.semanticLogSearch(
        message,
        {
          startTime,
          endTime,
          service,
          level,
          k,
          minSimilarity,
          includeContext,
          contextWindowSize
        }
      );
    } catch (error) {
      return createErrorResponse(`Error finding similar logs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
