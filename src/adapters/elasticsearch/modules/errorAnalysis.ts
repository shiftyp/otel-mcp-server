import { ElasticsearchCore, ElasticsearchAdapterOptions } from '../core/core.js';
import { logger } from '../../../utils/logger.js';
import { createErrorResponse, ErrorResponse, isErrorResponse } from '../../../utils/errorHandling.js';
import { createBoolQuery, createRangeQuery, createTermQuery } from '../../../utils/queryBuilder.js';
import { ServiceResolver } from '../../../utils/serviceResolver.js';
import { parseTimeRange } from '../../../utils/timeRangeParser.js';

/**
 * Error analysis functionality for the Elasticsearch Adapter
 */
export class ErrorAnalysis {
  private coreAdapter: ElasticsearchCore;
  
  constructor(options: ElasticsearchAdapterOptions) {
    this.coreAdapter = new ElasticsearchCore(options);
  }
  
  /**
   * Get top errors for a time range
   * @param options Options for the query
   * @returns List of top errors with counts and examples
   */
  public async topErrors(
    options: {
      startTime: string;
      endTime: string;
      limit?: number;
      service?: string;
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
  }> | ErrorResponse> {
    try {
      logger.info('[ErrorAnalysis] Getting top errors', options);
      
      const { startTime, endTime, limit = 10, service, includeExamples = false } = options;
      
      // Validate parameters
      if (!startTime || !endTime) {
        return createErrorResponse('Start time and end time are required');
      }
      
      // Parse time range
      const timeRange = parseTimeRange(startTime, endTime);
      if (isErrorResponse(timeRange)) {
        return timeRange;
      }
      
      // Build query
      const must = [
        createRangeQuery('@timestamp', timeRange.startTime, timeRange.endTime),
        {
          exists: {
            field: 'exception.message'
          }
        }
      ];
      
      // Add service filter if provided
      if (service) {
        const serviceQuery = ServiceResolver.createServiceQuery(service, 'LOGS');
        if (!isErrorResponse(serviceQuery)) {
          must.push(serviceQuery);
        }
      }
      
      // Build aggregation
      const aggs = {
        errors: {
          terms: {
            field: 'exception.message.keyword',
            size: limit
          },
          aggs: {
            services: {
              terms: {
                field: 'Resource.service.name',
                size: 1
              }
            },
            examples: {
              top_hits: {
                size: includeExamples ? 3 : 0,
                _source: [
                  '@timestamp',
                  'message',
                  'trace_id',
                  'Resource.service.name'
                ]
              }
            }
          }
        }
      };
      
      // Build query
      const query = {
        query: createBoolQuery({ must }),
        size: 0,
        aggs
      };
      
      // Execute query
      const result = await this.coreAdapter.callEsRequest('POST', '/.ds-logs-*/_search', query);
      
      if (!result || result.error) {
        const errorMessage = result?.error?.reason || 'Unknown error';
        return createErrorResponse(`Error getting top errors: ${errorMessage}`);
      }
      
      // Extract errors
      const errorBuckets = result.aggregations?.errors?.buckets || [];
      
      return errorBuckets.map((bucket: any) => {
        const serviceBucket = bucket.services?.buckets?.[0];
        const serviceValue = serviceBucket?.key || 'unknown';
        
        const examples = includeExamples
          ? (bucket.examples?.hits?.hits || []).map((hit: any) => {
              const source = hit._source;
              return {
                timestamp: source['@timestamp'],
                message: source.message,
                trace_id: source.trace_id,
                service: source.Resource?.service?.name || 'unknown'
              };
            })
          : undefined;
        
        return {
          error: bucket.key,
          count: bucket.doc_count,
          service: serviceValue,
          examples
        };
      });
    } catch (error) {
      return createErrorResponse(`Error getting top errors: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
