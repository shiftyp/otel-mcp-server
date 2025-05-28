import { ElasticsearchCore } from '../../core/core.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Module for direct metric querying functionality
 */
export class MetricQueryModule {
  private esCore: ElasticsearchCore;

  constructor(esCore: ElasticsearchCore) {
    this.esCore = esCore;
  }

  /**
   * Execute a direct query against metric indices
   * @param query Elasticsearch query object
   * @returns Query results
   */
  public async queryMetrics(query: any): Promise<any> {
    logger.info('[ES Adapter] queryMetrics called');
    
    try {
      // Determine the index pattern to use
      const indexPattern = '.ds-metrics-*,metrics*,*metrics*,otel-metric*';
      
      // Add default sort by timestamp if not specified
      if (!query.sort) {
        query.sort = [{ '@timestamp': { order: 'desc' } }];
      }
      
      // Execute the query
      logger.debug('[ES Adapter] Executing direct metric query', { 
        indexPattern,
        querySize: query.size || 'default',
        queryFrom: query.from || 'default'
      });
      
      const response = await this.esCore.callEsRequest('POST', `${indexPattern}/_search`, query);
      
      // Log the response size
      logger.info('[ES Adapter] Metric query returned results', { 
        totalHits: response.hits?.total?.value || 0,
        returnedHits: response.hits?.hits?.length || 0
      });
      
      return response;
    } catch (error) {
      logger.error('[ES Adapter] Error executing metric query', { error });
      throw error;
    }
  }

  /**
   * Count metrics matching a query
   * @param query Elasticsearch query object
   * @returns Count result
   */
  public async countMetrics(query: any): Promise<number> {
    logger.info('[ES Adapter] countMetrics called');
    
    try {
      // Determine the index pattern to use
      const indexPattern = '.ds-metrics-*,metrics*,*metrics*,otel-metric*';
      
      // Execute the count query
      const countQuery = { query: query.query };
      logger.debug('[ES Adapter] Executing metric count query');
      
      const response = await this.esCore.callEsRequest('POST', `${indexPattern}/_count`, countQuery);
      
      // Return the count
      logger.info('[ES Adapter] Metric count query returned', { count: response.count });
      return response.count || 0;
    } catch (error) {
      logger.error('[ES Adapter] Error executing metric count query', { error });
      return 0;
    }
  }

  /**
   * Get a sample of metrics for exploration
   * @param size Number of metrics to sample
   * @returns Sample of metrics
   */
  public async sampleMetrics(size: number = 10): Promise<any> {
    logger.info('[ES Adapter] sampleMetrics called', { size });
    
    const query = {
      size,
      query: {
        function_score: {
          query: { match_all: {} },
          random_score: {}
        }
      }
    };
    
    return this.queryMetrics(query);
  }

  /**
   * Get available metric names
   * @param service Optional service name to filter by
   * @returns Array of metric names with counts
   */
  public async getMetricNames(service?: string): Promise<Array<{ name: string, count: number }>> {
    logger.info('[ES Adapter] getMetricNames called', { service });
    
    // Build the query
    const query: any = {
      size: 0,
      query: {
        bool: {
          must: []
        }
      },
      aggs: {
        metric_names: {
          terms: {
            field: 'name',
            size: 1000,
            order: { '_count': 'desc' }
          }
        }
      }
    };
    
    // Add service filter if provided
    if (service) {
      query.query.bool.must.push({
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
    
    try {
      // Execute the query
      const response = await this.queryMetrics(query);
      
      // Process the results
      if (!response.aggregations || !response.aggregations.metric_names || !response.aggregations.metric_names.buckets) {
        return [];
      }
      
      // Transform the aggregation results
      const metricNames = response.aggregations.metric_names.buckets.map((bucket: any) => ({
        name: bucket.key,
        count: bucket.doc_count
      }));
      
      logger.info('[ES Adapter] Returning metric names', { count: metricNames.length });
      return metricNames;
    } catch (error) {
      logger.error('[ES Adapter] Error getting metric names', { error });
      return [];
    }
  }
}
