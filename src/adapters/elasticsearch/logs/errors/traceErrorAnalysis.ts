import { ElasticsearchCore } from '../../core/core.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Module for analyzing errors from traces
 */
export class TraceErrorAnalysisModule {
  private esCore: ElasticsearchCore;

  constructor(esCore: ElasticsearchCore) {
    this.esCore = esCore;
  }

  /**
   * Get errors from traces
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
    service?: string, 
    timestamp?: string, 
    trace_id?: string, 
    span_id?: string,
    http_status_code?: number
  }[]> {
    logger.info('[ES Adapter] getErrorsFromTraces called', { 
      startTime, 
      endTime, 
      N, 
      serviceOrServices, 
      searchPattern 
    });
    
    // Build the Elasticsearch query
    const esQuery: any = {
      bool: {
        must: [
          // Time range filter
          {
            range: {
              '@timestamp': {
                gte: startTime,
                lte: endTime
              }
            }
          },
          // Look for error spans
          {
            bool: {
              should: [
                { term: { 'status.code': 'ERROR' } },
                { term: { 'status.code': 'Error' } },
                { term: { 'status.code': 'error' } },
                { term: { 'status.code': 2 } },  // OpenTelemetry status code for error
                { range: { 'http.status_code': { gte: 500 } } }  // HTTP 5xx errors
              ],
              minimum_should_match: 1
            }
          }
        ]
      }
    };
    
    // Add service filter if provided
    if (serviceOrServices) {
      const services = Array.isArray(serviceOrServices) ? serviceOrServices : [serviceOrServices];
      
      if (services.length > 0) {
        const serviceFilters = services.map(service => {
          return {
            bool: {
              should: [
                { term: { 'resource.service.name': service } },
                { term: { 'service.name': service } },
                { term: { 'Resource.attributes.service.name': service } },
                { term: { 'resource.attributes.service.name': service } }
              ],
              minimum_should_match: 1
            }
          };
        });
        
        if (serviceFilters.length === 1) {
          esQuery.bool.must.push(serviceFilters[0]);
        } else {
          esQuery.bool.must.push({
            bool: {
              should: serviceFilters,
              minimum_should_match: 1
            }
          });
        }
      }
    }
    
    // Add search pattern filter if provided
    if (searchPattern) {
      esQuery.bool.must.push({
        multi_match: {
          query: searchPattern,
          fields: ['name', 'span.name', 'attributes.*', 'exception.*'],
          type: 'best_fields'
        }
      });
    }
    
    // Prepare the aggregation request with runtime fields for better error extraction
    const searchRequest = {
      index: '.ds-traces-*,traces*,*traces*,otel-traces*',
      body: {
        size: 0,
        query: esQuery,
        runtime_mappings: {
          error_message: {
            type: 'keyword',
            script: {
              source: `
                // Try to extract error message from various fields
                if (doc.containsKey('exception.message') && doc['exception.message'].size() > 0) {
                  emit(doc['exception.message'].value);
                } else if (doc.containsKey('exception.type') && doc['exception.type'].size() > 0) {
                  emit(doc['exception.type'].value);
                } else if (doc.containsKey('error.message') && doc['error.message'].size() > 0) {
                  emit(doc['error.message'].value);
                } else if (doc.containsKey('http.status_code') && doc['http.status_code'].size() > 0) {
                  emit("HTTP " + doc['http.status_code'].value);
                } else if (doc.containsKey('span.name') && doc['span.name'].size() > 0) {
                  emit("Error in " + doc['span.name'].value);
                } else {
                  emit("Unknown error");
                }
              `
            }
          },
          service_name: {
            type: 'keyword',
            script: {
              source: `
                // Try to extract service name from various fields
                if (doc.containsKey('resource.service.name') && doc['resource.service.name'].size() > 0) {
                  emit(doc['resource.service.name'].value);
                } else if (doc.containsKey('service.name') && doc['service.name'].size() > 0) {
                  emit(doc['service.name'].value);
                } else if (doc.containsKey('Resource.attributes.service.name') && doc['Resource.attributes.service.name'].size() > 0) {
                  emit(doc['Resource.attributes.service.name'].value);
                } else if (doc.containsKey('resource.attributes.service.name') && doc['resource.attributes.service.name'].size() > 0) {
                  emit(doc['resource.attributes.service.name'].value);
                } else {
                  emit("unknown-service");
                }
              `
            }
          }
        },
        aggs: {
          // Group by error message
          error_messages: {
            terms: {
              field: 'error_message',
              size: N,
              order: { '_count': 'desc' }
            },
            aggs: {
              // Get the top document for each error to extract metadata
              top_hit: {
                top_hits: {
                  size: 1,
                  sort: [{ '@timestamp': { order: 'desc' } }],
                  _source: [
                    '@timestamp', 
                    'service_name',
                    'trace_id', 
                    'span_id',
                    'http.status_code'
                  ]
                }
              }
            }
          }
        }
      }
    };
    
    try {
      // Execute the search
      logger.debug('[ES Adapter] Executing trace error analysis', { request: JSON.stringify(searchRequest) });
      const response = await this.esCore.callEsRequest('POST', `${searchRequest.index}/_search`, searchRequest.body);
      
      // Process the results
      if (!response.aggregations || !response.aggregations.error_messages || !response.aggregations.error_messages.buckets) {
        logger.info('[ES Adapter] No errors found in traces');
        return [];
      }
      
      // Transform the aggregation results into a more usable format
      const errors = response.aggregations.error_messages.buckets.map((errorBucket: any) => {
        // Skip empty error messages
        if (!errorBucket.key || errorBucket.key === 'Unknown error') {
          return null;
        }
        
        // Get metadata from the top hit
        const topHit = errorBucket.top_hit.hits.hits[0]?._source || {};
        
        // Create the error object
        return {
          error: errorBucket.key,
          count: errorBucket.doc_count,
          service: topHit.service_name || 'unknown-service',
          timestamp: topHit['@timestamp'] || '',
          trace_id: topHit.trace_id || '',
          span_id: topHit.span_id || '',
          http_status_code: topHit['http.status_code']
        };
      }).filter(Boolean);  // Remove null entries
      
      logger.info('[ES Adapter] Returning errors from traces', { count: errors.length });
      return errors;
    } catch (error) {
      logger.error('[ES Adapter] Error analyzing traces for errors', { error });
      return [];
    }
  }

  /**
   * Get error distribution by service from traces
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @returns Array of service objects with error counts
   */
  public async getTraceErrorDistributionByService(
    startTime: string,
    endTime: string
  ): Promise<Array<{ service: string, count: number }>> {
    logger.info('[ES Adapter] getTraceErrorDistributionByService called', { startTime, endTime });
    
    // Build the Elasticsearch query
    const esQuery: any = {
      bool: {
        must: [
          // Time range filter
          {
            range: {
              '@timestamp': {
                gte: startTime,
                lte: endTime
              }
            }
          },
          // Look for error spans
          {
            bool: {
              should: [
                { term: { 'status.code': 'ERROR' } },
                { term: { 'status.code': 'Error' } },
                { term: { 'status.code': 'error' } },
                { term: { 'status.code': 2 } },  // OpenTelemetry status code for error
                { range: { 'http.status_code': { gte: 500 } } }  // HTTP 5xx errors
              ],
              minimum_should_match: 1
            }
          }
        ]
      }
    };
    
    // Prepare the aggregation request
    const searchRequest = {
      index: '.ds-traces-*,traces*,*traces*,otel-traces*',
      body: {
        size: 0,
        query: esQuery,
        runtime_mappings: {
          service_name: {
            type: 'keyword',
            script: {
              source: `
                // Try to extract service name from various fields
                if (doc.containsKey('resource.service.name') && doc['resource.service.name'].size() > 0) {
                  emit(doc['resource.service.name'].value);
                } else if (doc.containsKey('service.name') && doc['service.name'].size() > 0) {
                  emit(doc['service.name'].value);
                } else if (doc.containsKey('Resource.attributes.service.name') && doc['Resource.attributes.service.name'].size() > 0) {
                  emit(doc['Resource.attributes.service.name'].value);
                } else if (doc.containsKey('resource.attributes.service.name') && doc['resource.attributes.service.name'].size() > 0) {
                  emit(doc['resource.attributes.service.name'].value);
                } else {
                  emit("unknown-service");
                }
              `
            }
          }
        },
        aggs: {
          services: {
            terms: {
              field: 'service_name',
              size: 100,
              order: { '_count': 'desc' }
            }
          }
        }
      }
    };
    
    try {
      // Execute the search
      const response = await this.esCore.callEsRequest('POST', `${searchRequest.index}/_search`, searchRequest.body);
      
      // Process the results
      if (!response.aggregations || !response.aggregations.services || !response.aggregations.services.buckets) {
        return [];
      }
      
      // Transform the aggregation results
      const distribution = response.aggregations.services.buckets.map((bucket: any) => ({
        service: bucket.key,
        count: bucket.doc_count
      }));
      
      logger.info('[ES Adapter] Returning trace error distribution by service', { count: distribution.length });
      return distribution;
    } catch (error) {
      logger.error('[ES Adapter] Error getting trace error distribution by service', { error });
      return [];
    }
  }

  /**
   * Get HTTP error distribution by status code from traces
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param service Optional service name to filter by
   * @returns Array of status code objects with counts
   */
  public async getHttpErrorDistribution(
    startTime: string,
    endTime: string,
    service?: string
  ): Promise<Array<{ status_code: number, count: number }>> {
    logger.info('[ES Adapter] getHttpErrorDistribution called', { startTime, endTime, service });
    
    // Build the Elasticsearch query
    const esQuery: any = {
      bool: {
        must: [
          // Time range filter
          {
            range: {
              '@timestamp': {
                gte: startTime,
                lte: endTime
              }
            }
          },
          // Look for HTTP status codes >= 400
          {
            range: {
              'http.status_code': {
                gte: 400
              }
            }
          }
        ]
      }
    };
    
    // Add service filter if provided
    if (service) {
      esQuery.bool.must.push({
        bool: {
          should: [
            { term: { 'resource.service.name': service } },
            { term: { 'service.name': service } },
            { term: { 'Resource.attributes.service.name': service } },
            { term: { 'resource.attributes.service.name': service } }
          ],
          minimum_should_match: 1
        }
      });
    }
    
    // Prepare the aggregation request
    const searchRequest = {
      index: '.ds-traces-*,traces*,*traces*,otel-traces*',
      body: {
        size: 0,
        query: esQuery,
        aggs: {
          status_codes: {
            terms: {
              field: 'http.status_code',
              size: 100,
              order: { '_count': 'desc' }
            }
          }
        }
      }
    };
    
    try {
      // Execute the search
      const response = await this.esCore.callEsRequest('POST', `${searchRequest.index}/_search`, searchRequest.body);
      
      // Process the results
      if (!response.aggregations || !response.aggregations.status_codes || !response.aggregations.status_codes.buckets) {
        return [];
      }
      
      // Transform the aggregation results
      const distribution = response.aggregations.status_codes.buckets.map((bucket: any) => ({
        status_code: bucket.key,
        count: bucket.doc_count
      }));
      
      logger.info('[ES Adapter] Returning HTTP error distribution', { count: distribution.length });
      return distribution;
    } catch (error) {
      logger.error('[ES Adapter] Error getting HTTP error distribution', { error });
      return [];
    }
  }
}
