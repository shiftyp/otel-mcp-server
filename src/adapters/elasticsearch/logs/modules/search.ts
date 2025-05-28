import { ElasticsearchCore } from '../../core/core.js';
import { logger } from '../../../../utils/logger.js';
import { extractFirstLineErrorMessage } from '../../scripts/logs/logScripts.js';

/**
 * Module for log searching functionality
 */
export class LogSearchModule {
  private esCore: ElasticsearchCore;

  constructor(esCore: ElasticsearchCore) {
    this.esCore = esCore;
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
    logger.info('[ES Adapter] searchOtelLogs called', { options });
    
    const {
      query,
      service,
      level,
      startTime,
      endTime,
      limit = 100,
      offset = 0,
      sortDirection = 'desc',
      traceId,
      spanId
    } = options;
    
    // Build the Elasticsearch query
    const esQuery: any = {
      bool: {
        must: []
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
    
    // Add log level filter if provided
    if (level) {
      // Handle different level field formats
      esQuery.bool.must.push({
        bool: {
          should: [
            { term: { 'level': level } },
            { term: { 'severity_text': level } },
            { term: { 'Severity': level } }
          ],
          minimum_should_match: 1
        }
      });
    }
    
    // Add trace ID filter if provided
    if (traceId) {
      esQuery.bool.must.push({
        term: { 'trace_id': traceId }
      });
    }
    
    // Add span ID filter if provided
    if (spanId) {
      esQuery.bool.must.push({
        term: { 'span_id': spanId }
      });
    }
    
    // Add text search if provided
    if (query) {
      // Use wildcard queries for text fields to improve matching
      const textFields = ['body', 'Body', 'message', 'Message', 'log.message'];
      const wildcardQueries = textFields.map(field => ({
        wildcard: {
          [field]: {
            value: `*${query}*`,
            case_insensitive: true
          }
        }
      }));
      
      // Add a fallback match query for other fields
      const matchQuery = {
        multi_match: {
          query,
          fields: ['*'],
          type: 'best_fields',
          fuzziness: 'AUTO'
        }
      };
      
      esQuery.bool.must.push({
        bool: {
          should: [...wildcardQueries, matchQuery],
          minimum_should_match: 1
        }
      });
    }
    
    // Prepare the full request
    const searchRequest = {
      index: '.ds-logs-*,logs*,*logs*,otel-logs*',
      body: {
        from: offset,
        size: limit,
        sort: [
          { '@timestamp': { order: sortDirection } }
        ],
        query: esQuery,
        // Add runtime fields for consistent access to log data
        runtime_mappings: {
          log_message: {
            type: 'keyword',
            script: {
              source: `
                // Try to extract message from various fields
                if (doc.containsKey('body') && doc['body'].size() > 0) {
                  emit(doc['body'].value);
                } else if (doc.containsKey('Body') && doc['Body'].size() > 0) {
                  emit(doc['Body'].value);
                } else if (doc.containsKey('message') && doc['message'].size() > 0) {
                  emit(doc['message'].value);
                } else if (doc.containsKey('Message') && doc['Message'].size() > 0) {
                  emit(doc['Message'].value);
                } else if (doc.containsKey('log.message') && doc['log.message'].size() > 0) {
                  emit(doc['log.message'].value);
                } else {
                  emit("No message content available");
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
          },
          log_level: {
            type: 'keyword',
            script: {
              source: `
                // Try to extract log level from various fields
                if (doc.containsKey('level') && doc['level'].size() > 0) {
                  emit(doc['level'].value);
                } else if (doc.containsKey('severity_text') && doc['severity_text'].size() > 0) {
                  emit(doc['severity_text'].value);
                } else if (doc.containsKey('Severity') && doc['Severity'].size() > 0) {
                  emit(doc['Severity'].value);
                } else {
                  emit("INFO");
                }
              `
            }
          }
        }
      }
    };
    
    try {
      // Execute the search
      logger.debug('[ES Adapter] Executing log search', { request: JSON.stringify(searchRequest) });
      const response = await this.esCore.callEsRequest('POST', `${searchRequest.index}/_search`, searchRequest.body);
      
      // Process the results
      if (!response.hits || !response.hits.hits || response.hits.hits.length === 0) {
        logger.info('[ES Adapter] No logs found matching criteria');
        return [];
      }
      
      // Transform the results into a more usable format
      const logs = response.hits.hits.map((hit: any) => {
        const source = hit._source;
        
        // Extract key fields with fallbacks
        const timestamp = source['@timestamp'] || source.timestamp || '';
        const message = source.body || source.Body || source.message || source.Message || source['log.message'] || 'No message content';
        const level = source.level || source.severity_text || source.Severity || 'INFO';
        const serviceName = source['resource.service.name'] || 
                           source['service.name'] || 
                           source['Resource.attributes.service.name'] || 
                           source['resource.attributes.service.name'] || 
                           'unknown-service';
        
        // Extract trace context if available
        const traceId = source.trace_id || source['trace.id'] || '';
        const spanId = source.span_id || source['span.id'] || '';
        
        // Return the structured log object
        return {
          ...source,  // Include all original fields
          timestamp,
          service: serviceName,
          level,
          message,
          trace_id: traceId,
          span_id: spanId,
          _id: hit._id,
          _index: hit._index
        };
      });
      
      logger.info('[ES Adapter] Returning logs', { count: logs.length });
      return logs;
    } catch (error) {
      logger.error('[ES Adapter] Error searching logs', { error });
      return [];
    }
  }
}
