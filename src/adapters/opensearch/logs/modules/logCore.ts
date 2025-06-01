import { OpenSearchCore } from '../../core/core.js';
import { logger } from '../../../../utils/logger.js';
import { createErrorResponse, ErrorResponse, isErrorResponse } from '../../../../utils/errorHandling.js';

/**
 * Core functionality for the OpenSearch Logs Adapter
 */
export class LogCore extends OpenSearchCore {
  constructor(options: any) {
    super(options);
  }

  /**
   * Make a request to OpenSearch
   */
  public async request(method: string, url: string, body: any) {
    return this.callRequest(method, url, body);
  }
  
  /**
   * Query logs with custom query
   * @param query The query object
   */
  public async queryLogs(query: any): Promise<any | ErrorResponse> {
    try {
      logger.info('[OpenSearch LogCore] queryLogs called');
      return this.searchLogs(query);
    } catch (error) {
      return createErrorResponse(`Error querying logs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Search logs with a custom query
   * @param query The query object
   */
  public async searchLogs(query: any): Promise<any | ErrorResponse> {
    try {
      logger.info('[OpenSearch LogCore] searchLogs called');
      
      // Ensure query has the right index pattern
      const index = this.getLogsIndexPattern();
      
      // Execute the search
      const result = await this.callRequest('POST', `/${index}/_search`, query);
      
      if (!result || result.error) {
        const errorMessage = result?.error?.reason || 'Unknown error';
        return createErrorResponse(`Error searching logs: ${errorMessage}`);
      }
      
      return result;
    } catch (error) {
      return createErrorResponse(`Error searching logs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get the logs index pattern
   * @returns The logs index pattern
   */
  public getLogsIndexPattern(): string {
    // Use only the known existing index to avoid index not found errors
    logger.info('[LogCore] Using logs index pattern: logs-generic-default');
    return 'logs-generic-default';
  }
}
