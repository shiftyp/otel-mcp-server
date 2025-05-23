import { ElasticsearchCore } from './core.js';
import { logger } from '../../utils/logger.js';

export class LogsAdapter extends ElasticsearchCore {
  /**
   * Search OTEL logs for a pattern following OpenTelemetry specification
   * https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/logs/data-model.md
   * 
   * @param pattern Optional search pattern
   * @param serviceOrServices Optional service name or array of services to filter logs by
   * @returns Array of formatted log strings
   */
  public async searchOtelLogs(pattern: string, serviceOrServices?: string | string[]): Promise<string[]> {
    logger.info('[ES Adapter] Searching logs', { pattern, serviceOrServices });
    
    try {
      // Build the query
      let query: any;
      
      // If service filtering is requested
      if (serviceOrServices) {
        // Convert service parameter to array for consistent handling
        const services = Array.isArray(serviceOrServices) ? serviceOrServices : [serviceOrServices];
        
        // Build a bool query with service filter
        query = {
          bool: {
            must: pattern ? [
              {
                multi_match: {
                  query: pattern,
                  fields: [
                    // Standard OTEL fields
                    'body^3', 
                    'message^3',
                    'exception.message^2',
                    'error.message^2',
                    // Other possible fields
                    'log.message',
                    'attributes.*',
                    'Resource.*'
                  ],
                  type: 'best_fields',
                  operator: 'or'
                }
              }
            ] : [],
            filter: [
              {
                bool: {
                  should: [
                    { terms: { 'resource.service.name': services } },
                    { terms: { 'Resource.service.name': services } },
                    { terms: { 'service.name': services } }
                  ],
                  minimum_should_match: 1
                }
              }
            ]
          }
        };
      } else {
        // If no service filter, use the standard approach
        query = pattern ? {
          multi_match: {
            query: pattern,
            fields: [
              // Standard OTEL fields
              'body^3', 
              'message^3',
              'exception.message^2',
              'error.message^2',
              // Other possible fields
              'log.message',
              'attributes.*',
              'Resource.*'
            ],
            type: 'best_fields',
            operator: 'or'
          }
        } : { match_all: {} };
      }
      
      // Search across all possible log indices
      const response = await this.request('POST', '/logs*,*logs*/_search', {
        size: 100,
        query,
        sort: [
          { '@timestamp': { order: 'desc' } }
        ]
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
          source['log']?.level || 
          source['severity'] || 
          'info';
        
        // Extract message from various possible fields
        const message = 
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
        
        // Format the log entry for display
        return JSON.stringify({
          timestamp,
          service,
          level,
          message: typeof message === 'string' ? message : JSON.stringify(message),
          trace_id: traceId,
          span_id: spanId
        }, null, 2);
      }) || [];
    } catch (error) {
      logger.error('[ES Adapter] Error in searchOtelLogs', { error });
      return [];
    }
  }
  
  /**
   * Get the top N errors in logs for a time window
   * Following OpenTelemetry specification for logs and traces
   */
  public async topErrors(
    startTime: string, 
    endTime: string, 
    N = 10, 
    serviceOrServices?: string | string[]
  ): Promise<{ 
    error: string, 
    count: number, 
    level?: string, 
    service?: string, 
    timestamp?: string, 
    trace_id?: string, 
    span_id?: string 
  }[]> {
    logger.info('[ES Adapter] Finding top errors', { startTime, endTime, serviceOrServices });
    
    try {
      // First try to get errors from logs (following OTEL spec)
      const logErrors = await this.getErrorsFromLogs(startTime, endTime, N, serviceOrServices);
      
      // If we found errors in logs, return them
      if (logErrors.length > 0) {
        logger.info('[ES Adapter] Found errors in logs', { count: logErrors.length });
        return logErrors;
      }
      
      // If no errors in logs, try to get errors from traces
      logger.info('[ES Adapter] No errors found in logs, trying traces');
      const traceErrors = await this.getErrorsFromTraces(startTime, endTime, N, serviceOrServices);
      
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
   * Get errors from logs following OpenTelemetry specification
   * https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/logs/data-model.md
   */
  private async getErrorsFromLogs(
    startTime: string, 
    endTime: string, 
    N = 10, 
    serviceOrServices?: string | string[]
  ): Promise<{ 
    error: string, 
    count: number, 
    level?: string, 
    service?: string, 
    timestamp?: string, 
    trace_id?: string, 
    span_id?: string 
  }[]> {
    // Build the query following OTEL spec fields
    const query: any = {
      bool: {
        must: [
          {
            range: {
              '@timestamp': {
                gte: startTime,
                lte: endTime
              }
            }
          }
        ],
        should: [
          // Standard OTEL fields
          { exists: { field: 'exception' } },
          { term: { 'severity_text': 'ERROR' } },
          { term: { 'severity_text': 'FATAL' } },
          { term: { 'severity_number': 17 } }, // ERROR in OTEL spec
          { term: { 'severity_number': 21 } }, // FATAL in OTEL spec
          
          // Common implementations
          { exists: { field: 'error.message' } },
          { term: { 'log.level': 'error' } },
          { term: { 'log.level': 'fatal' } },
          { range: { 'severity': { gte: 'ERROR' } } },
          
          // Text-based detection
          { match: { 'body': 'error' } },
          { match: { 'body': 'exception' } },
          { match: { 'message': 'error' } },
          { match: { 'message': 'exception' } }
        ],
        minimum_should_match: 1
      }
    };
    
    // Add service filter if provided - support multiple service name field patterns
    if (serviceOrServices) {
      // Convert service parameter to array for consistent handling
      const services = Array.isArray(serviceOrServices) ? serviceOrServices : [serviceOrServices];
      
      query.bool.must.push({
        bool: {
          should: services.flatMap(service => [
            { term: { 'service.name': service } },
            { term: { 'resource.service.name': service } },
            { term: { 'Resource.service.name': service } }
          ]),
          minimum_should_match: 1
        }
      });
    }
    
    // Execute the query against all possible log indices
    const response = await this.request('POST', '/logs*,*logs*/_search', {
      size: 0,
      query,
      aggs: {
        error_types: {
          terms: {
            field: 'body.keyword',
            missing: 'message.keyword',
            size: N
          },
          aggs: {
            // Get a sample document for each error
            sample: {
              top_hits: {
                size: 1,
                _source: [
                  'body', 'message', 'exception', 'error.message', 
                  'severity_text', 'log.level', 'severity',
                  'service.name', 'resource.service.name', 'Resource.service.name',
                  '@timestamp', 'timestamp',
                  'trace_id', 'trace.id', 'TraceId',
                  'span_id', 'span.id', 'SpanId'
                ]
              }
            }
          }
        }
      }
    }).catch(err => {
      logger.warn('[ES Adapter] Error querying logs', { error: err });
      return { aggregations: { error_types: { buckets: [] } } };
    });
    
    // Process and return the results
    return (response.aggregations?.error_types?.buckets || []).map((bucket: any) => {
      // Try to get the most descriptive error message from various fields
      const sample = bucket.sample?.hits?.hits?.[0]?._source || {};
      
      // Extract error message from various possible fields
      const errorMessage = 
        sample['exception']?.message || 
        sample['error.message'] || 
        sample['body'] || 
        sample['message'] || 
        bucket.key || 
        'Unknown error';
      
      // Extract service name from various possible fields
      const serviceName = 
        sample['service.name'] || 
        sample['resource.service.name'] || 
        sample['Resource.service.name'] || 
        'unknown';
      
      // Extract severity/level from various possible fields
      const level = 
        sample['severity_text'] || 
        sample['log.level'] || 
        sample['severity'] || 
        'error';
      
      // Extract timestamp from various possible fields
      const timestamp = 
        sample['@timestamp'] || 
        sample['timestamp'] || 
        '';
      
      // Extract trace ID from various possible fields
      const traceId = 
        sample['trace_id'] || 
        sample['trace.id'] || 
        sample['TraceId'] || 
        '';
      
      // Extract span ID from various possible fields
      const spanId = 
        sample['span_id'] || 
        sample['span.id'] || 
        sample['SpanId'] || 
        '';
      
      return {
        error: errorMessage,
        count: bucket.doc_count,
        level,
        service: serviceName,
        timestamp,
        trace_id: traceId,
        span_id: spanId
      };
    });
  }
  
  /**
   * Get errors from traces following OpenTelemetry specification
   * https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/trace/api.md
   */
  private async getErrorsFromTraces(
    startTime: string, 
    endTime: string, 
    N = 10, 
    serviceOrServices?: string | string[]
  ): Promise<{ 
    error: string, 
    count: number, 
    level?: string, 
    service?: string, 
    timestamp?: string, 
    trace_id?: string, 
    span_id?: string 
  }[]> {
    // Build query to find error spans based on OTEL spec
    const query: any = {
      bool: {
        must: [
          {
            range: {
              '@timestamp': {
                gte: startTime,
                lte: endTime
              }
            }
          },
          {
            bool: {
              should: [
                // OTEL spec status codes
                { term: { 'Status.code': 'ERROR' } },
                { term: { 'TraceStatus': 2 } }, // 2 = ERROR in OTEL
                
                // Error events
                { exists: { field: 'Events.exception' } },
                
                // Error attributes
                { exists: { field: 'Attributes.error' } }
              ],
              minimum_should_match: 1
            }
          }
        ]
      }
    };
    
    // Add service filter if provided
    if (serviceOrServices) {
      // Convert service parameter to array for consistent handling
      const services = Array.isArray(serviceOrServices) ? serviceOrServices : [serviceOrServices];
      
      query.bool.must.push({
        bool: {
          should: services.flatMap(service => [
            { term: { 'Resource.service.name': service } },
            { term: { 'service.name': service } }
          ]),
          minimum_should_match: 1
        }
      });
    }
    
    // Execute the query against all possible trace indices
    const response = await this.request('POST', '/traces*,*traces*/_search', {
      size: 0,
      query,
      aggs: {
        // Group by error message/name if available
        error_types: {
          terms: {
            field: 'Events.exception.exception.message.keyword',
            missing: 'Events.exception.exception.type.keyword',
            size: N
          },
          aggs: {
            // Get a sample span for each error type
            sample: {
              top_hits: {
                size: 1,
                _source: [
                  'Events.exception.exception.message', 'Events.exception.exception.type',
                  'Name', 'Resource.service.name', '@timestamp',
                  'TraceId', 'SpanId'
                ]
              }
            }
          }
        }
      }
    }).catch(err => {
      logger.warn('[ES Adapter] Error querying traces', { error: err });
      return { aggregations: { error_types: { buckets: [] } } };
    });
    
    // Process and return the results
    return (response.aggregations?.error_types?.buckets || []).map((bucket: any) => {
      const sample = bucket.sample?.hits?.hits?.[0]?._source || {};
      
      // Extract error message from exception or use span name
      const errorMessage = 
        sample['Events.exception.exception.message'] || 
        sample['Events.exception.exception.type'] || 
        `Error in ${sample['Name'] || 'operation'}`;
      
      return {
        error: errorMessage,
        count: bucket.doc_count,
        level: 'error', // Traces don't have levels, default to 'error'
        service: sample['Resource.service.name'] || 'unknown',
        timestamp: sample['@timestamp'] || '',
        trace_id: sample['TraceId'] || '',
        span_id: sample['SpanId'] || ''
      };
    });
  }
  
  /**
   * Query logs with a custom query
   */
  public async queryLogs(query: any): Promise<any> {
    return this.request('POST', '/logs*,*logs*/_search', query);
  }
}

