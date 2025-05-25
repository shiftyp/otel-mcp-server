import { ElasticsearchCore } from './core.js';
import { logger } from '../../utils/logger.js';

export class LogErrorsAdapter extends ElasticsearchCore {
  /**
   * Get errors from logs following OpenTelemetry specification
   * https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/logs/data-model.md
   */
  public async getErrorsFromLogs(
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
    logger.info('[ES Adapter] Getting errors from logs', { startTime, endTime, serviceOrServices });
    
    try {
      // Build the query
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
                  // Error levels in various formats
                  { term: { 'severity_text': 'error' } },
                  { term: { 'SeverityText': 'ERROR' } },
                  { term: { 'log.level': 'error' } },
                  { term: { 'severity': 'error' } },
                  
                  // Error codes
                  { range: { 'SeverityNumber': { gte: 17 } } }, // 17+ is Error in OTEL spec
                  
                  // Exception fields
                  { exists: { field: 'exception' } },
                  { exists: { field: 'error' } }
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
              { term: { 'resource.service.name': service } },
              { term: { 'Resource.service.name': service } },
              { term: { 'service.name': service } }
            ]),
            minimum_should_match: 1
          }
        });
      }
      
      // Execute the query against all possible log indices
      const response = await this.request('POST', '/logs*,*logs*/_search', {
        size: 0,
        runtime_mappings: {
          "error_message": {
            type: "keyword",
            script: {
              source: `
                def source = doc['_source'];
                
                // Try to extract error message from various fields
                if (source.containsKey('exception') && source.exception.containsKey('message')) {
                  emit(source.exception.message);
                  return;
                }
                
                if (source.containsKey('error') && source.error.containsKey('message')) {
                  emit(source.error.message);
                  return;
                }
                
                if (source.containsKey('Body')) {
                  def body = source.Body;
                  if (body != null && body.length() > 0) {
                    def newlineIndex = body.indexOf('\\n');
                    if (newlineIndex > 0) {
                      emit(body.substring(0, newlineIndex));
                    } else {
                      emit(body.length() > 100 ? body.substring(0, 100) + "..." : body);
                    }
                    return;
                  }
                }
                
                if (source.containsKey('body')) {
                  def body = source.body;
                  if (body != null && body.length() > 0) {
                    def newlineIndex = body.indexOf('\\n');
                    if (newlineIndex > 0) {
                      emit(body.substring(0, newlineIndex));
                    } else {
                      emit(body.length() > 100 ? body.substring(0, 100) + "..." : body);
                    }
                    return;
                  }
                }
                
                if (source.containsKey('message')) {
                  def message = source.message;
                  if (message != null && message.length() > 0) {
                    def newlineIndex = message.indexOf('\\n');
                    if (newlineIndex > 0) {
                      emit(message.substring(0, newlineIndex));
                    } else {
                      emit(message.length() > 100 ? message.substring(0, 100) + "..." : message);
                    }
                    return;
                  }
                }
                
                // If we get here, we couldn't find a suitable error message
                emit("");
              `
            }
          }
        },
        query,
        aggs: {
          error_types: {
            terms: {
              field: "error_message",
              size: N,
              // Skip empty error messages
              exclude: [""]
            },
            aggs: {
              // Get a sample document for each error
              sample: {
                top_hits: {
                  size: 1,
                  _source: [
                    'body', 'message', 'exception', 'error.message', 
                    // Primary OpenTelemetry fields
                    'SeverityText', 'SeverityNumber',
                    // Legacy/alternative fields
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
        
        // Try to get the most descriptive error message
        let errorMessage = bucket.key || '';
        
        // If the error message looks like a field name rather than an actual message,
        // try to extract a better message from the sample document
        if (errorMessage.includes('.keyword') || errorMessage.includes('.type')) {
          if (sample.exception?.message) {
            errorMessage = sample.exception.message;
          } else if (sample.error?.message) {
            errorMessage = sample.error.message;
          } else if (sample.message) {
            errorMessage = sample.message;
          } else if (sample.body) {
            errorMessage = sample.body;
          } else if (sample.Body) {
            errorMessage = sample.Body;
          }
        }
        
        // If we still don't have a good error message, use a default
        if (!errorMessage || errorMessage.includes('.keyword') || errorMessage.includes('.type')) {
          errorMessage = 'Unknown error';
        }
        
        // Extract service name from various possible fields
        const serviceName = 
          sample['service.name'] || 
          sample['resource.service.name'] || 
          sample['Resource.service.name'] || 
          sample['Resource']?.['service.name'] || 
          sample['Resource']?.service?.name || 
          'unknown';
        
        // Extract severity/level from various possible fields
        const level = 
          sample['SeverityText'] || 
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
    } catch (error) {
      logger.error('[ES Adapter] Error getting errors from logs', { error });
      return [];
    }
  }
  
  /**
   * Get errors from traces following OpenTelemetry specification
   * https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/trace/api.md
   */
  public async getErrorsFromTraces(
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
    logger.info('[ES Adapter] Getting errors from traces', { startTime, endTime, serviceOrServices });
    
    try {
      // Build the query
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
              script: {
                source: `
                  def source = doc['_source'];
                  
                  // Try to extract error message from various fields
                  if (source.containsKey('Events') && source.Events.containsKey('exception')) {
                    def exception = source.Events.exception;
                    if (exception.containsKey('exception') && exception.exception.containsKey('message')) {
                      return exception.exception.message;
                    } else if (exception.containsKey('exception') && exception.exception.containsKey('type')) {
                      return exception.exception.type;
                    }
                  }
                  
                  // Try to extract from HTTP status code for client errors
                  if (source.containsKey('Attributes') && source.Attributes.containsKey('http.status_code')) {
                    def statusCode = source.Attributes['http.status_code'];
                    if (statusCode >= 400) {
                      def method = source.Attributes.containsKey('http.method') ? source.Attributes['http.method'] : '';
                      def url = source.Attributes.containsKey('http.url') ? source.Attributes['http.url'] : '';
                      return 'HTTP ' + statusCode + ' ' + method + ' ' + url;
                    }
                  }
                  
                  // Default to span name if nothing else is available
                  if (source.containsKey('Name')) {
                    return 'Error in ' + source.Name;
                  }
                  
                  return 'Unknown error';
                `
              },
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
        // Get the sample span
        const sample = bucket.sample?.hits?.hits?.[0]?._source || {};
        
        // Extract error message from various possible fields
        const errorMessage = 
          sample.Events?.exception?.exception?.message || 
          sample.Events?.exception?.exception?.type || 
          bucket.key || 
          'Unknown error';
        
        // Extract service name from sample
        const serviceName = 
          sample['Resource.service.name'] || 
          sample['service.name'] || 
          sample['Resource']?.['service.name'] || 
          sample['Resource']?.service?.name || 
          'unknown';
        
        // Extract timestamp
        const timestamp = sample['@timestamp'] || '';
        
        // Extract trace and span IDs
        const traceId = sample.TraceId || '';
        const spanId = sample.SpanId || '';
        
        return {
          error: errorMessage,
          count: bucket.doc_count,
          level: 'error',
          service: serviceName,
          timestamp,
          trace_id: traceId,
          span_id: spanId
        };
      });
    } catch (error) {
      logger.error('[ES Adapter] Error getting errors from traces', { error });
      return [];
    }
  }
}
