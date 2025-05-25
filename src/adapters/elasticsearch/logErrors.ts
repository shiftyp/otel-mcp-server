import { ElasticsearchCore } from './core.js';
import { logger } from '../../utils/logger.js';

export class LogErrorsAdapter extends ElasticsearchCore {
  /**
   * Get errors from logs following OpenTelemetry specification
   * https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/logs/data-model.md
   * 
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param N Number of top errors to return
   * @param serviceOrServices Optional service name or array of services to filter by
   * @param searchPattern Optional search pattern to filter errors
   * @returns Array of error objects with count and metadata
   */
  public async getErrorsFromLogs(
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
    logger.info('[ES Adapter] Getting errors from logs', { startTime, endTime, serviceOrServices, searchPattern });

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
      
      // Add search pattern if provided
      if (searchPattern) {
        query.bool.must.push({
          bool: {
            should: [
              // Search in specific text fields that we know are safe for wildcard searches
              { wildcard: { "Body": `*${searchPattern}*` } },
              { wildcard: { "body": `*${searchPattern}*` } },
              { wildcard: { "message": `*${searchPattern}*` } },
              { wildcard: { "exception.message": `*${searchPattern}*` } },
              { wildcard: { "error.message": `*${searchPattern}*` } },
              // For non-text fields, use a match query which is safer
              { match: { "_all": searchPattern } }
            ],
            minimum_should_match: 1
          }
        });
      }

      // Add service filter if provided
      if (serviceOrServices) {
        // Convert service parameter to array for consistent handling
        const services = Array.isArray(serviceOrServices) ? serviceOrServices : [serviceOrServices];

        query.bool.must.push({
          bool: {
            should: services.flatMap(service => [
              // Check all possible locations for service name to match our extraction logic
              { term: { 'resource.service.name': service } },
              { term: { 'Resource.service.name': service } },
              { term: { 'service.name': service } },
              { term: { 'Attributes.service.name': service } },
              { term: { 'Resource.k8s.deployment.name': service } },
              { term: { 'Resource.k8s.pod.name': service } },
              // Also try prefix matches for pod names (which often have random suffixes)
              { prefix: { 'Resource.k8s.pod.name': service } }
            ]),
            minimum_should_match: 1
          }
        });
        
        logger.info('[ES Adapter] Added service filter to logs query', { services });
      }

      // Enhanced runtime field script for error message extraction
      const runtime_mappings = {
        "error_message": {
          type: "keyword",
          script: {
            source: `
              // Access the full source document
              def source = doc['_source'];
              
              // Try to extract error message from various fields in priority order
              // 1. Exception fields
              if (source.containsKey('exception')) {
                def exception = source.exception;
                if (exception instanceof Map && exception.containsKey('message')) {
                  emit(exception.message.toString());
                  return;
                } else if (exception instanceof String) {
                  emit(exception.toString());
                  return;
                }
              }
              
              // 2. Error object fields
              if (source.containsKey('error')) {
                def error = source.error;
                if (error instanceof Map && error.containsKey('message')) {
                  emit(error.message.toString());
                  return;
                } else if (error instanceof String) {
                  emit(error.toString());
                  return;
                }
              }
              
              // 3. Standard message fields
              if (source.containsKey('message')) {
                def message = source.message;
                if (message != null) {
                  def msg = message.toString();
                  def newlineIndex = msg.indexOf('\n');
                  if (newlineIndex > 0) {
                    emit(msg.substring(0, newlineIndex));
                  } else {
                    emit(msg.length() > 150 ? msg.substring(0, 150) + "..." : msg);
                  }
                  return;
                }
              }
              
              // 4. Body fields (often contain the full error message)
              if (source.containsKey('Body')) {
                def body = source.Body;
                if (body != null) {
                  def bodyStr = body.toString();
                  def newlineIndex = bodyStr.indexOf('\n');
                  if (newlineIndex > 0) {
                    emit(bodyStr.substring(0, newlineIndex));
                  } else {
                    emit(bodyStr.length() > 150 ? bodyStr.substring(0, 150) + "..." : bodyStr);
                  }
                  return;
                }
              }
              
              if (source.containsKey('body')) {
                def body = source.body;
                if (body != null) {
                  def bodyStr = body.toString();
                  def newlineIndex = bodyStr.indexOf('\n');
                  if (newlineIndex > 0) {
                    emit(bodyStr.substring(0, newlineIndex));
                  } else {
                    emit(bodyStr.length() > 150 ? bodyStr.substring(0, 150) + "..." : bodyStr);
                  }
                  return;
                }
              }
              
              // 5. Look for any field that might contain 'error' or 'exception' in its name
              for (def entry : source.entrySet()) {
                def key = entry.getKey().toLowerCase();
                if (key.contains('error') || key.contains('exception')) {
                  def value = entry.getValue();
                  if (value != null) {
                    emit(value.toString().length() > 150 ? value.toString().substring(0, 150) + "..." : value.toString());
                    return;
                  }
                }
              }
              
              // If we get here, we couldn't find a suitable error message
              emit("Unknown error");
            `
          }
        },
        "service_name": {
          type: "keyword",
          script: {
            source: `
              def source = doc['_source'];
              
              // Try to extract service name from various fields
              if (source.containsKey('Resource') && source.Resource instanceof Map && 
                  source.Resource.containsKey('service') && source.Resource.service instanceof Map && 
                  source.Resource.service.containsKey('name')) {
                emit(source.Resource.service.name.toString());
                return;
              }
              
              if (source.containsKey('resource') && source.resource instanceof Map && 
                  source.resource.containsKey('service') && source.resource.service instanceof Map && 
                  source.resource.service.containsKey('name')) {
                emit(source.resource.service.name.toString());
                return;
              }
              
              if (source.containsKey('service') && source.service instanceof Map && 
                  source.service.containsKey('name')) {
                emit(source.service.name.toString());
                return;
              }
              
              emit("unknown");
            `
          }
        }
      };

      // Execute the query against all possible log indices with enhanced runtime mappings
      const response = await this.request('POST', '/logs*,*logs*/_search', {
        size: 0,
        runtime_mappings,
        query,
        aggs: {
          error_types: {
            terms: {
              field: "error_message",
              size: N,
              // Skip empty or unknown error messages
              exclude: ["", "Unknown error"]
            },
            aggs: {
              // Get a sample document for each error
              sample: {
                top_hits: {
                  size: 1,
                  _source: true  // Get the full source document
                }
              },
              // Get the service breakdown for this error
              services: {
                terms: {
                  field: "service_name",
                  size: 10
                }
              },
              // Get the latest occurrence of this error
              latest: {
                top_hits: {
                  size: 1,
                  sort: [{ "@timestamp": { order: "desc" } }],
                  _source: ["@timestamp", "trace_id", "span_id"]
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
        // Get the error message from the bucket key (from our runtime field)
        let errorMsg = bucket.key || 'Unknown error';

        // Get the sample document for additional information
        const sample = bucket.sample?.hits?.hits?.[0]?._source || {};
        const latest = bucket.latest?.hits?.hits?.[0]?._source || {};

        // Get the primary service associated with this error
        const services = bucket.services?.buckets || [];
        const primaryService = services.length > 0 ? services[0].key : 'unknown';

        // Get trace and span IDs from the latest occurrence
        const latestTraceId = latest.trace_id || latest.TraceId;
        const latestSpanId = latest.span_id || latest.SpanId;
        const sampleTraceId = sample.trace_id || sample.TraceId;
        const sampleSpanId = sample.span_id || sample.SpanId;

        // If we still don't have a good error message, use a default
        if (!errorMsg || errorMsg.includes('.keyword') || errorMsg.includes('.type')) {
          errorMsg = 'Unknown error';
        }

        // Extract service name from various possible fields
        let serviceName = primaryService; // Start with the service from aggregation
        
        // If primaryService is still 'unknown', try to extract from the sample document
        if (serviceName === 'unknown') {
          serviceName =
            sample['service.name'] ||
            sample['resource.service.name'] ||
            sample['Resource.service.name'] ||
            sample['Resource']?.['service.name'] ||
            sample['Resource']?.service?.name ||
            // Additional fields to check
            sample.service ||
            sample.Attributes?.['service.name'] ||
            sample.Attributes?.service ||
            // If we have a container name, use that
            sample['k8s.container.name'] ||
            sample['Resource']?.['k8s.container.name'] ||
            sample['Resource']?.['k8s.deployment.name'] ||
            // Still unknown
            'unknown';
        }

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
          error: errorMsg,
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
   * Extract service name from various possible fields
   * @param source The source document
   * @returns The extracted service name or 'unknown'
   */
  private extractServiceName(source: any): string {
    return source['Resource.service.name'] ||
      (source.Resource && source.Resource.service && source.Resource.service.name) ||
      (source.service && source.service.name) ||
      (source.Attributes && source.Attributes['service.name']) ||
      (source['Resource.k8s.deployment.name']) ||
      (source.Resource && source.Resource.k8s && source.Resource.k8s.deployment && source.Resource.k8s.deployment.name) ||
      // If we have a pod name, extract the service name part
      (source['Resource.k8s.pod.name'] && (() => {
        const podName = source['Resource.k8s.pod.name'];
        const dashIndex = podName.lastIndexOf('-');
        return dashIndex > 0 ? podName.substring(0, dashIndex) : podName;
      })()) ||
      'unknown';
  }

  /**
   * Get errors from traces following OpenTelemetry specification
   * https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/trace/api.md
   * 
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param N Number of top errors to return
   * @param serviceOrServices Optional service name or array of services to filter by
   * @param searchPattern Optional search pattern to filter errors
   * @returns Array of error objects with count and metadata
   */
  public async getErrorsFromTraces(
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
    logger.info('[ES Adapter] Getting errors from traces', { startTime, endTime, serviceOrServices, searchPattern });

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
      
      // Add search pattern if provided
      if (searchPattern) {
        query.bool.must.push({
          bool: {
            should: [
              // Search in specific trace-related fields
              { wildcard: { "Name": `*${searchPattern}*` } },
              { wildcard: { "Events.exception.exception.message": `*${searchPattern}*` } },
              { wildcard: { "Events.exception.exception.type": `*${searchPattern}*` } },
              { wildcard: { "Attributes.http.url": `*${searchPattern}*` } },
              { wildcard: { "Attributes.error": `*${searchPattern}*` } },
              // For non-text fields, use a match query which is safer
              { match: { "_all": searchPattern } }
            ],
            minimum_should_match: 1
          }
        });
      }

      // We'll apply service filtering after getting the results
      // This allows us to use our more sophisticated service name extraction logic
      // that can't be easily expressed in an Elasticsearch query
      
      // Log the service filter if provided
      if (serviceOrServices) {
        const services = Array.isArray(serviceOrServices) ? serviceOrServices : [serviceOrServices];
        logger.info('[ES Adapter] Will apply service filter after query', { services });
      }

      // Instead of using complex aggregations, let's use a simpler approach
      // Get error traces directly and process them in memory
      const response = await this.request('POST', '/traces*,*traces*/_search', {
        size: N * 5, // Get more than we need to ensure we have enough unique errors
        query,
        sort: [
          { "@timestamp": { "order": "desc" } } // Get the most recent errors
        ],
        _source: [
          "@timestamp", "TraceId", "SpanId", "Name", "Resource.service.name",
          "Attributes.http.method", "Attributes.http.status_code", "Attributes.http.url",
          "Attributes.error", "TraceStatusDescription", "Events"
        ]
      });
      
      // Log the raw response for debugging
      logger.info('[ES Adapter] Trace error search response', { 
        hitCount: response.hits.total.value,
        sampleHit: response.hits.hits.length > 0 ? JSON.stringify(response.hits.hits[0]._source).substring(0, 200) : 'No hits'
      });
      
      if (!response.hits.hits || response.hits.hits.length === 0) {
        logger.info('[ES Adapter] No error traces found');
        return [];
      }


      // Process the trace hits to extract error information
      const errorMap = new Map<string, { count: number, sources: any[] }>();
      
      // Process each trace hit
      for (const hit of response.hits.hits) {
        const source = hit._source;
        let errorMessage = 'Unknown error';
        
        // Extract the service name using our helper method
        const spanService = this.extractServiceName(source);
        
        // If we're filtering by service, check if this span belongs to the requested service
        if (serviceOrServices) {
          const services = Array.isArray(serviceOrServices) ? serviceOrServices : [serviceOrServices];
          
          // Skip this span if it doesn't belong to any of the requested services
          if (!services.includes(spanService)) {
            continue;
          }
        }
        
        // Try to extract error message from various fields
        if (source.TraceStatusDescription) {
          errorMessage = source.TraceStatusDescription;
        } else if (source.Attributes && source.Attributes.error === 'true' && source.Attributes['http.status_code']) {
          const statusCode = source.Attributes['http.status_code'];
          const method = source.Attributes['http.method'] || '';
          const url = source.Attributes['http.url'] || '';
          errorMessage = `HTTP ${statusCode} ${method} ${url}`;
        } else if (source.Name) {
          errorMessage = `Error in ${source.Name}`;
        }
        
        // Add to our map of error types
        const key = errorMessage;
        if (errorMap.has(key)) {
          const entry = errorMap.get(key)!;
          entry.count++;
          entry.sources.push(source);
        } else {
          errorMap.set(key, { count: 1, sources: [source] });
        }
        
        // Log the service name we extracted for debugging
        logger.debug('[ES Adapter] Processed trace error', { 
          errorMessage, 
          service: spanService,
          traceId: source.TraceId || ''
        });
      }
      
      // Convert the map to an array and sort by count
      const errors = Array.from(errorMap.entries())
        .map(([error, data]) => ({
          error,
          count: data.count,
          sources: data.sources
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, N);
      
      logger.info('[ES Adapter] Processed trace errors', { 
        errorCount: errors.length,
        topError: errors.length > 0 ? errors[0].error : 'None'
      });
      
      // Format the results
      return errors.map(error => {
        const sample = error.sources[0];
        
        // Use our helper method to extract the service name
        const serviceName = this.extractServiceName(sample);
        
        return {
          error: error.error,
          count: error.count,
          level: 'error',
          service: serviceName,
          timestamp: sample['@timestamp'] || '',
          trace_id: sample.TraceId || '',
          span_id: sample.SpanId || ''
        };
      });
    } catch (error) {
      logger.error('[ES Adapter] Error getting errors from traces', { error });
      return [];
    }
  }
}
