import { ElasticsearchCore } from '../core/core.js';
import { logger } from '../../../utils/logger.js';
import { 
  LogFieldsModule, 
  LogSearchModule, 
  LogErrorsModule, 
  LogQueryModule 
} from './modules/index.js';

/**
 * Adapter for interacting with logs in Elasticsearch
 * This class delegates functionality to specialized modules
 */
export class LogsAdapter extends ElasticsearchCore {
  private fieldsModule: LogFieldsModule;
  private searchModule: LogSearchModule;
  private errorsModule: LogErrorsModule;
  private queryModule: LogQueryModule;

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
