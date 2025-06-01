import { ElasticsearchCore } from '../core/core.js';
import { logger } from '../../../utils/logger.js';
import { 
  MetricFieldsModule, 
  MetricAggregationModule, 
  MetricQueryModule 
} from './modules/index.js';
import { createErrorResponse, ErrorResponse, isErrorResponse } from '../../../utils/errorHandling.js';
import { createBoolQuery, createTermQuery, createRangeQuery, createQueryStringQuery } from '../../../utils/queryBuilder.js';
import { ServiceResolver } from '../../../utils/serviceResolver.js';

/**
 * Adapter for interacting with metrics in Elasticsearch
 * This class delegates functionality to specialized modules
 */
export class MetricsAdapter extends ElasticsearchCore {
  private fieldsModule: MetricFieldsModule;
  private aggregationModule: MetricAggregationModule;
  private queryModule: MetricQueryModule;

  constructor(options: any) {
    super(options);
    
    // Initialize modules
    this.fieldsModule = new MetricFieldsModule(this);
    this.aggregationModule = new MetricAggregationModule(this);
    this.queryModule = new MetricQueryModule(this);
    
    logger.info('[MetricsAdapter] Initialized with modules');
  }

  /**
   * List all metric fields and their types from metrics indices
   * @returns Array of { name, type }
   */
  public async listMetricFields(): Promise<Array<{ name: string, type: string }>> {
    return this.fieldsModule.listMetricFields();
  }

  /**
   * Aggregate metrics over a time range
   * @param options Aggregation options
   * @returns Aggregated metrics data
   */
  public async aggregateOtelMetricsRange(
    options: {
      metricName: string;
      service?: string;
      startTime: string;
      endTime: string;
      interval?: string;
      percentiles?: number[];
      dimensions?: string[];
      filters?: Record<string, any>;
    }
  ): Promise<{
    metricName: string;
    service?: string;
    timeRange: { start: string; end: string };
    interval: string;
    buckets: Array<{
      timestamp: string;
      value: number;
      count: number;
      min?: number;
      max?: number;
      avg?: number;
      sum?: number;
      percentiles?: Record<string, number>;
      dimensions?: Record<string, any>;
    }>;
  }> {
    return this.aggregationModule.aggregateOtelMetricsRange(options);
  }

  /**
   * Execute a direct query against metric indices
   * @param query Elasticsearch query object
   * @returns Query results
   */
  public async queryMetrics(query: any): Promise<any> {
    return this.queryModule.queryMetrics(query);
  }
  
  /**
   * Get metrics for a specific service
   * @param service Service name to get metrics for
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param maxResults Maximum number of results to return
   * @returns Array of metrics for the service
   */
  public async getMetricsForService(
    service: string,
    startTime: string,
    endTime: string,
    maxResults: number = 100
  ): Promise<any[] | ErrorResponse> {
    try {
      logger.debug(`[MetricsAdapter] Getting metrics for service ${service}`);
      
      if (!service) {
        return createErrorResponse('Service name is required');
      }
      
      // Create service query using the ServiceResolver for consistent handling
      const serviceQuery = ServiceResolver.createServiceQuery(
        service,
        'METRICS',
        { allowWildcards: true }
      );
      
      if (isErrorResponse(serviceQuery)) {
        return serviceQuery;
      }
      
      // Add time range filter
      const timeRangeFilter = createRangeQuery('@timestamp', startTime, endTime);
      
      // Build the complete query
      const query = {
        query: createBoolQuery({
          must: [serviceQuery],
          filter: [timeRangeFilter]
        }),
        size: maxResults,
        sort: [{ '@timestamp': { order: 'desc' } }]
      };
      
      // Execute the query
      const result = await this.queryMetrics(query);
      
      if (!result || !result.hits || !result.hits.hits) {
        return [];
      }
      
      // Extract and return metric entries
      return result.hits.hits.map((hit: any) => {
        const source = hit._source;
        return {
          id: hit._id,
          timestamp: source['@timestamp'],
          service: source.Resource?.service?.name || source.service?.name || 'unknown',
          name: source.name || source.Name || source.metric_name || 'unknown',
          value: source.value || source.Value || source.gauge?.value || source.sum?.value || 0,
          unit: source.unit || source.Unit || '',
          attributes: source.Attributes || source.attributes || {}
        };
      });
    } catch (error) {
      return createErrorResponse(`Error getting metrics for service: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Search metrics with a custom query (required by BaseSearchAdapter)
   * @param query The query to execute
   * @returns Search results
   */
  public async searchMetrics(query: any): Promise<any> {
    logger.info('[MetricsAdapter] Searching metrics with query', { query });
    return this.queryModule.queryMetrics(query);
  }

  /**
   * Count metrics matching a query
   * @param query Elasticsearch query object
   * @returns Count result
   */
  public async countMetrics(query: any): Promise<number> {
    return this.queryModule.countMetrics(query);
  }

  /**
   * Get a sample of metrics for exploration
   * @param size Number of metrics to sample
   * @returns Sample of metrics
   */
  public async sampleMetrics(size: number = 10): Promise<any> {
    return this.queryModule.sampleMetrics(size);
  }

  /**
   * Get available metric names
   * @param service Optional service name to filter by
   * @returns Array of metric names with counts
   */
  public async getMetricNames(service?: string): Promise<Array<{ name: string, count: number }>> {
    return this.queryModule.getMetricNames(service);
  }
}
