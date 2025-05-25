import { ElasticsearchCore } from './core.js';
import { logger } from '../../utils/logger.js';
import { LogErrorsAdapter } from './logErrors.js';

export class LogsAdapter extends ElasticsearchCore {
  // Instance of LogErrorsAdapter for error-related functionality
  private errorAdapter: LogErrorsAdapter;
  
  constructor(config: any) {
    super(config);
    this.errorAdapter = new LogErrorsAdapter(config);
  }
  
  /**
   * Search OTEL logs for a pattern following OpenTelemetry specification
   * https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/logs/data-model.md
   * 
   * @param pattern Optional search pattern
   * @param serviceOrServices Optional service name or array of services to filter logs by
   * @param logLevel Optional log level to filter by (e.g., 'error', 'info')
   * @returns Array of log objects with structured data
   */
  public async searchOtelLogs(pattern: string, serviceOrServices?: string | string[], logLevel?: string, startTime?: string, endTime?: string): Promise<{
    timestamp: string;
    service: string;
    level: string;
    message: string;
    trace_id?: string;
    span_id?: string;
    attributes?: Record<string, any>;
  }[]> {
    logger.info('[ES Adapter] Searching logs', { pattern, serviceOrServices, logLevel, startTime, endTime });
    
    try {
      // Prepare service filter if provided
      const services = serviceOrServices ? 
        (Array.isArray(serviceOrServices) ? serviceOrServices : [serviceOrServices]) : 
        undefined;
      
      // Build a simple, direct query
      const query: any = {
        bool: {
          must: [
            // Time range for logs
            {
              range: {
                '@timestamp': {
                  gte: startTime || 'now-30d',  // Use provided start time or default to 30 days
                  lte: endTime || 'now'        // Use provided end time or default to now
                }
              }
            }
          ]
        }
      };
      
      // Add log level filter if provided
      if (logLevel) {
        const normalizedLevel = logLevel.toLowerCase();
        query.bool.must.push({
          bool: {
            should: [
              { term: { 'severity_text': normalizedLevel } },
              { term: { 'SeverityText': normalizedLevel.toUpperCase() } },
              { term: { 'log.level': normalizedLevel } },
              { term: { 'severity': normalizedLevel } }
            ],
            minimum_should_match: 1
          }
        });
      }
      
      // Add pattern search if provided
      if (pattern) {
        // Use a simpler approach that won't try to apply wildcards to numeric fields
        query.bool.must.push({
          bool: {
            should: [
              // Search in specific text fields that we know are safe for wildcard searches
              { wildcard: { "Body": `*${pattern}*` } },
              { wildcard: { "body": `*${pattern}*` } },
              { wildcard: { "message": `*${pattern}*` } },
              { wildcard: { "exception.message": `*${pattern}*` } },
              { wildcard: { "error.message": `*${pattern}*` } },
              { wildcard: { "log.message": `*${pattern}*` } },
              // For non-text fields, use a match query which is safer
              { match: { "_all": pattern } }
            ],
            minimum_should_match: 1
          }
        });
      }
      
      // Add service filter if provided
      if (services?.length) {
        if (!query.bool.filter) {
          query.bool.filter = [];
        }
        
        query.bool.filter.push({
          bool: {
            should: [
              { terms: { 'resource.service.name': services } },
              { terms: { 'Resource.service.name': services } },
              { terms: { 'service.name': services } }
            ],
            minimum_should_match: 1
          }
        });
      }
      
      // Search across all possible log indices with a simple approach
      const response = await this.request('POST', '/logs*,*logs*/_search', {
        size: 100,
        query,
        sort: [
          { '@timestamp': { order: 'desc' } }
        ],
        _source: true  // Get all fields
      }).catch(err => {
        logger.warn('[ES Adapter] Error searching logs', { error: err });
        return { hits: { hits: [] } };
      });
      
      logger.info('[ES Adapter] Log search results', { count: response.hits?.hits?.length || 0 });
      
      // Process the results, handling various OTEL log formats
      return response.hits?.hits?.map((hit: any) => {
        const source = hit._source || {};
        
        // Extract timestamp from various possible fields
        const timestamp = 
          source['@timestamp'] || 
          source['timestamp'] || 
          new Date().toISOString();
        
        // Extract service name from various possible fields
        const service = 
          source['service']?.name || 
          source['resource']?.['service.name'] || 
          source['Resource']?.['service.name'] || 
          source['Resource']?.service?.name || 
          'unknown';
        
        // Extract log level from various possible fields
        const level = 
          source['severity_text'] || 
          source['SeverityText'] || 
          source['log']?.level || 
          source['severity'] || 
          'info';
        
        // Extract message directly from source fields
        // Try Body first since that's what might be marked as _ignored
        const message = 
          source['Body'] || 
          source['body'] ||
          source['message'] || 
          source['exception']?.message || 
          source['error']?.message || 
          JSON.stringify(source);
        
        // Extract trace ID from various possible fields
        const traceId = 
          source['trace_id'] || 
          source['trace']?.id || 
          source['TraceId'] || 
          '';
        
        // Extract span ID from various possible fields
        const spanId = 
          source['span_id'] || 
          source['span']?.id || 
          source['SpanId'] || 
          '';
        
        // Return a structured object with all the relevant log information
        const formattedMessage = typeof message === 'string' ? message : JSON.stringify(message);
        return {
          timestamp,
          service,
          level: level.toUpperCase(),
          message: formattedMessage,
          trace_id: traceId || undefined,
          span_id: spanId || undefined,
          attributes: {
            ...Object.entries(source)
              .filter(([key]) => !['@timestamp', 'timestamp', 'service', 'level', 'message', 'trace_id', 'span_id'].includes(key))
              .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {})
          }
        };
      }) || [{
        timestamp: new Date().toISOString(),
        service: 'log-search',
        level: 'ERROR',
        message: `No logs found matching the search criteria. This might be due to:\n - No logs matching the pattern "${pattern}"\n - No logs from the specified service(s): ${serviceOrServices ? (Array.isArray(serviceOrServices) ? serviceOrServices.join(', ') : serviceOrServices) : 'all services'}\n - Logs exist but are in fields marked as _ignored by Elasticsearch`,
        trace_id: undefined,
        span_id: undefined,
        attributes: {}
      }];
    } catch (error) {
      logger.error('[ES Adapter] Error in searchOtelLogs', { error });
      return [{
        timestamp: new Date().toISOString(),
        service: 'log-search',
        level: 'ERROR',
        message: `An error occurred while searching logs: ${error instanceof Error ? error.message : String(error)}\nPlease check the server logs for more details.`,
        trace_id: undefined,
        span_id: undefined,
        attributes: {}
      }];
    }
  }
  
  /**
   * Get the top N errors in logs for a time window
   * Following OpenTelemetry specification for logs and traces
   * 
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param N Number of top errors to return
   * @param serviceOrServices Optional service name or array of services to filter by
   * @param searchPattern Optional search pattern to filter errors
   * @returns Array of error objects with count and metadata
   */
  public async topErrors(
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
    logger.info('[ES Adapter] Finding top errors', { startTime, endTime, serviceOrServices, searchPattern });
    
    try {
      // First try to get errors from logs (following OTEL spec)
      // Always use 'error' as the log level for the topErrors functionality
      const logErrors = await this.errorAdapter.getErrorsFromLogs(startTime, endTime, N, serviceOrServices, searchPattern);
      
      // If we found errors in logs, return them
      if (logErrors.length > 0) {
        logger.info('[ES Adapter] Found errors in logs', { count: logErrors.length });
        return logErrors;
      }
      
      // If no errors in logs, try to get errors from traces
      logger.info('[ES Adapter] No errors found in logs, trying traces');
      const traceErrors = await this.errorAdapter.getErrorsFromTraces(startTime, endTime, N, serviceOrServices, searchPattern);
      
      if (traceErrors.length > 0) {
        logger.info('[ES Adapter] Found errors in traces', { count: traceErrors.length });
        return traceErrors;
      }
      
      // No errors found in either logs or traces
      logger.info('[ES Adapter] No errors found in logs or traces');
      return [];
    } catch (error) {
      logger.error('[ES Adapter] Error finding top errors', { error });
      return [];
    }
  }
  
  /**
   * Query logs with a custom query
   * Ensures _source is enabled by default to access all fields including ignored ones
   * Supports runtime_mappings and script_fields for advanced Elasticsearch queries
   */
  public async queryLogs(query: any): Promise<any> {
    // If _source isn't explicitly set to false, ensure it's enabled
    if (query._source !== false) {
      query._source = query._source || true;
    }
    
    // Log the query for debugging purposes
    logger.debug('[ES Adapter] Executing logs query', { 
      hasRuntimeMappings: !!query.runtime_mappings,
      hasScriptFields: !!query.script_fields,
      queryStructure: Object.keys(query)
    });
    
    try {
      return await this.request('POST', '/logs*,*logs*/_search', query);
    } catch (error: unknown) {
      // Provide more detailed error information for runtime field issues
      if (error instanceof Error && 
          (error.message.includes('runtime_mappings') || error.message.includes('script'))) {
        logger.error('[ES Adapter] Error with runtime mappings or scripts', { 
          error: error.message,
          query: JSON.stringify(query)
        });
        throw new Error(`Error with runtime mappings or scripts: ${error.message}`);
      }
      
      // Re-throw the original error
      throw error;
    }
  }
}
