import { ElasticsearchCore } from '../../core/core.js';
import { logger } from '../../../../utils/logger.js';
import { extractErrorMessage, extractServiceName } from '../../scripts/logs/logScripts.js';

/**
 * Module for analyzing errors from logs
 */
export class LogErrorAnalysisModule {
  private esCore: ElasticsearchCore;

  constructor(esCore: ElasticsearchCore) {
    this.esCore = esCore;
  }

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
    logger.info('[ES Adapter] getErrorsFromLogs called', { 
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
          // Look for logs with error level
          {
            bool: {
              should: [
                { term: { 'level': 'ERROR' } },
                { term: { 'level': 'Error' } },
                { term: { 'level': 'error' } },
                { term: { 'severity_text': 'ERROR' } },
                { term: { 'severity_text': 'Error' } },
                { term: { 'severity_text': 'error' } },
                { term: { 'Severity': 'ERROR' } },
                { term: { 'Severity': 'Error' } },
                { term: { 'Severity': 'error' } }
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
          fields: ['body', 'Body', 'message', 'Message', 'log.message', '*'],
          type: 'best_fields'
        }
      });
    }
    
    // Prepare the aggregation request
    const searchRequest = {
      index: '.ds-logs-*,logs*,*logs*,otel-logs*',
      body: {
        size: 0,  // We don't need the actual documents, just the aggregations
        query: esQuery,
        runtime_mappings: {
          error_message: {
            type: 'keyword',
            script: {
              source: extractErrorMessage
            }
          },
          service_name: {
            type: 'keyword',
            script: {
              source: extractServiceName
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
                    'level', 
                    'severity_text', 
                    'Severity', 
                    'service_name',
                    'trace_id', 
                    'span_id'
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
      logger.debug('[ES Adapter] Executing log error analysis', { request: JSON.stringify(searchRequest) });
      const response = await this.esCore.callEsRequest('POST', `${searchRequest.index}/_search`, searchRequest.body);
      
      // Process the results
      if (!response.aggregations || !response.aggregations.error_messages || !response.aggregations.error_messages.buckets) {
        logger.info('[ES Adapter] No errors found in logs');
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
        
        // Determine the log level
        const level = topHit.level || topHit.severity_text || topHit.Severity || 'ERROR';
        
        // Create the error object
        return {
          error: errorBucket.key,
          count: errorBucket.doc_count,
          level,
          service: topHit.service_name || 'unknown-service',
          timestamp: topHit['@timestamp'] || '',
          trace_id: topHit.trace_id || '',
          span_id: topHit.span_id || ''
        };
      }).filter(Boolean);  // Remove null entries
      
      logger.info('[ES Adapter] Returning errors from logs', { count: errors.length });
      return errors;
    } catch (error) {
      logger.error('[ES Adapter] Error analyzing logs for errors', { error });
      return [];
    }
  }

  /**
   * Get error distribution by service from logs
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @returns Array of service objects with error counts
   */
  public async getErrorDistributionByService(
    startTime: string,
    endTime: string
  ): Promise<Array<{ service: string, count: number }>> {
    logger.info('[ES Adapter] getErrorDistributionByService called', { startTime, endTime });
    
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
          // Look for logs with error level
          {
            bool: {
              should: [
                { term: { 'level': 'ERROR' } },
                { term: { 'level': 'Error' } },
                { term: { 'level': 'error' } },
                { term: { 'severity_text': 'ERROR' } },
                { term: { 'severity_text': 'Error' } },
                { term: { 'severity_text': 'error' } },
                { term: { 'Severity': 'ERROR' } },
                { term: { 'Severity': 'Error' } },
                { term: { 'Severity': 'error' } }
              ],
              minimum_should_match: 1
            }
          }
        ]
      }
    };
    
    // Prepare the aggregation request
    const searchRequest = {
      index: '.ds-logs-*,logs*,*logs*,otel-logs*',
      body: {
        size: 0,
        query: esQuery,
        runtime_mappings: {
          service_name: {
            type: 'keyword',
            script: {
              source: extractServiceName
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
      
      logger.info('[ES Adapter] Returning error distribution by service', { count: distribution.length });
      return distribution;
    } catch (error) {
      logger.error('[ES Adapter] Error getting error distribution by service', { error });
      return [];
    }
  }

  /**
   * Get error trends over time from logs
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param interval Time interval for buckets (e.g., '1h', '30m')
   * @param service Optional service name to filter by
   * @returns Array of time buckets with error counts
   */
  public async getErrorTrends(
    startTime: string,
    endTime: string,
    interval: string = '1h',
    service?: string
  ): Promise<Array<{ timestamp: string, count: number }>> {
    logger.info('[ES Adapter] getErrorTrends called', { startTime, endTime, interval, service });
    
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
          // Look for logs with error level
          {
            bool: {
              should: [
                { term: { 'level': 'ERROR' } },
                { term: { 'level': 'Error' } },
                { term: { 'level': 'error' } },
                { term: { 'severity_text': 'ERROR' } },
                { term: { 'severity_text': 'Error' } },
                { term: { 'severity_text': 'error' } },
                { term: { 'Severity': 'ERROR' } },
                { term: { 'Severity': 'Error' } },
                { term: { 'Severity': 'error' } }
              ],
              minimum_should_match: 1
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
      index: '.ds-logs-*,logs*,*logs*,otel-logs*',
      body: {
        size: 0,
        query: esQuery,
        aggs: {
          error_over_time: {
            date_histogram: {
              field: '@timestamp',
              fixed_interval: interval
            }
          }
        }
      }
    };
    
    try {
      // Execute the search
      const response = await this.esCore.callEsRequest('POST', `${searchRequest.index}/_search`, searchRequest.body);
      
      // Process the results
      if (!response.aggregations || !response.aggregations.error_over_time || !response.aggregations.error_over_time.buckets) {
        return [];
      }
      
      // Transform the aggregation results
      const trends = response.aggregations.error_over_time.buckets.map((bucket: any) => ({
        timestamp: bucket.key_as_string || new Date(bucket.key).toISOString(),
        count: bucket.doc_count
      }));
      
      logger.info('[ES Adapter] Returning error trends', { count: trends.length });
      return trends;
    } catch (error) {
      logger.error('[ES Adapter] Error getting error trends', { error });
      return [];
    }
  }
}
