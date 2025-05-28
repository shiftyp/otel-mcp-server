import { ElasticsearchCore } from '../core/core.js';
import { logger } from '../../../utils/logger.js';
import { 
  MetricFieldsModule, 
  MetricAggregationModule, 
  MetricQueryModule 
} from './modules/index.js';

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
