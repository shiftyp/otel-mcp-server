import { ElasticsearchCore } from '../../core/core.js';
import { logger } from '../../../../utils/logger.js';
import { extractFirstLineErrorMessage } from '../../scripts/logs/logScripts.js';

/**
 * Module for log error analysis functionality
 */
export class LogErrorsModule {
  private esCore: ElasticsearchCore;

  constructor(esCore: ElasticsearchCore) {
    this.esCore = esCore;
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
    logger.info('[ES Adapter] topErrors called', { options });
    
    const {
      startTime,
      endTime,
      service,
      limit = 10,
      includeExamples = true
    } = options;
    
    // Build the Elasticsearch query
    const esQuery: any = {
      bool: {
        must: [
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
    
    // Add time range filter if provided
    if (startTime || endTime) {
      const timeFilter: any = {
        range: {
          '@timestamp': {}
        }
      };
      
      if (startTime) {
        timeFilter.range['@timestamp'].gte = startTime;
      }
      
      if (endTime) {
        timeFilter.range['@timestamp'].lte = endTime;
      }
      
      esQuery.bool.must.push(timeFilter);
    }
    
    // Add service filter if provided
    if (service) {
      // Handle both resource.service.name and service.name
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
        size: 0,  // We don't need the actual documents, just the aggregations
        query: esQuery,
        runtime_mappings: {
          error_message: {
            type: 'keyword',
            script: {
              source: extractFirstLineErrorMessage
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
              size: limit,
              order: { '_count': 'desc' }
            },
            aggs: {
              // Group by service within each error message
              services: {
                terms: {
                  field: 'service_name',
                  size: 10
                },
                aggs: {
                  // Get the most recent examples for each error
                  recent_examples: {
                    top_hits: {
                      size: includeExamples ? 3 : 0,
                      sort: [{ '@timestamp': { order: 'desc' } }],
                      _source: ['@timestamp', 'body', 'Body', 'message', 'Message', 'log.message', 'trace_id', 'service_name']
                    }
                  }
                }
              }
            }
          }
        }
      }
    };
    
    try {
      // Execute the search
      logger.debug('[ES Adapter] Executing error analysis', { request: JSON.stringify(searchRequest) });
      const response = await this.esCore.callEsRequest('POST', `${searchRequest.index}/_search`, searchRequest.body);
      
      // Process the results
      if (!response.aggregations || !response.aggregations.error_messages || !response.aggregations.error_messages.buckets) {
        logger.info('[ES Adapter] No errors found');
        return [];
      }
      
      // Transform the aggregation results into a more usable format
      const errors = response.aggregations.error_messages.buckets.map((errorBucket: any) => {
        // Skip empty error messages
        if (!errorBucket.key || errorBucket.key === 'Unknown error') {
          return null;
        }
        
        // Process service information
        const serviceInfo = errorBucket.services.buckets[0] || { key: 'unknown-service', doc_count: 0 };
        
        // Create the error object
        const errorObj: any = {
          error: errorBucket.key,
          count: errorBucket.doc_count,
          service: serviceInfo.key
        };
        
        // Add examples if requested
        if (includeExamples && serviceInfo.recent_examples && serviceInfo.recent_examples.hits.hits.length > 0) {
          errorObj.examples = serviceInfo.recent_examples.hits.hits.map((hit: any) => {
            const source = hit._source;
            return {
              timestamp: source['@timestamp'] || '',
              message: source.body || source.Body || source.message || source.Message || source['log.message'] || 'No message content',
              trace_id: source.trace_id || '',
              service: serviceInfo.key
            };
          });
        }
        
        return errorObj;
      }).filter(Boolean);  // Remove null entries
      
      logger.info('[ES Adapter] Returning top errors', { count: errors.length });
      return errors;
    } catch (error) {
      logger.error('[ES Adapter] Error analyzing logs for errors', { error });
      return [];
    }
  }
}
