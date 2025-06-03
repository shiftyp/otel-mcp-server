import { OpenSearchSubAdapter } from '../core/baseAdapter.js';
import { logger } from '../../../utils/logger.js';

/**
 * Interface for histogram bucket
 */
export interface HistogramBucket {
  key: number;
  doc_count: number;
  [key: string]: any; // For aggregation results
}

/**
 * Interface for date histogram bucket
 */
export interface DateHistogramBucket {
  key_as_string: string;
  key: number;
  doc_count: number;
  [key: string]: any; // For aggregation results
}

/**
 * Interface for time series data point
 */
export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
  [key: string]: any;
}

/**
 * Interface for histogram metric
 */
export interface HistogramMetric {
  name: string;
  values: number[];
  counts: number[];
  min: number;
  max: number;
  sum: number;
  count: number;
  mean: number;
  stddev?: number;
}

/**
 * OpenSearch Metrics Adapter Core
 * Provides base functionality for working with metrics data in OpenSearch
 */
export class MetricsAdapterCore extends OpenSearchSubAdapter {
  protected metricsIndex: string;
  
  constructor(options: any) {
    super(options);
    this.metricsIndex = options.metricsIndex || 'metrics-*';
  }

  /**
   * Query metrics index
   */
  public async searchMetrics(query: any): Promise<any> {
    return this.request('POST', `/${this.metricsIndex}/_search`, query);
  }
  
  /**
   * Get metric fields from mapping
   */
  public async getMetricFields(): Promise<any[]> {
    const response = await this.request('GET', `/${this.metricsIndex}/_mapping`);
    
    const fields: any[] = [];
    for (const index in response) {
      const mappings = response[index].mappings;
      if (mappings && mappings.properties) {
        this.extractMetricFields(mappings.properties, '', fields);
      }
    }
    
    return fields;
  }
  
  /**
   * Helper to extract metric field information from mapping
   */
  protected extractMetricFields(properties: any, path: string, fields: any[]): void {
    for (const field in properties) {
      const fullPath = path ? `${path}.${field}` : field;
      const fieldInfo = properties[field];
      
      // Check if this is a metric field (numeric types)
      if (['long', 'integer', 'short', 'byte', 'double', 'float', 'half_float', 'scaled_float'].includes(fieldInfo.type)) {
        fields.push({
          field: fullPath,
          type: fieldInfo.type,
          metricType: this.inferMetricType(fullPath),
          unit: this.inferUnit(fullPath),
          aggregatable: true
        });
      }
      
      // Process nested fields
      if (fieldInfo.properties) {
        this.extractMetricFields(fieldInfo.properties, fullPath, fields);
      }
    }
  }
  
  /**
   * Infer metric type from field name
   */
  protected inferMetricType(fieldName: string): string {
    if (fieldName.includes('counter') || fieldName.includes('count')) {
      return 'counter';
    } else if (fieldName.includes('gauge')) {
      return 'gauge';
    } else if (fieldName.includes('histogram') || fieldName.includes('distribution')) {
      return 'histogram';
    } else if (fieldName.includes('summary')) {
      return 'summary';
    }
    return 'gauge'; // Default to gauge
  }
  
  /**
   * Infer unit from field name
   */
  protected inferUnit(fieldName: string): string {
    if (fieldName.includes('bytes')) return 'bytes';
    if (fieldName.includes('seconds') || fieldName.includes('duration')) return 'seconds';
    if (fieldName.includes('milliseconds') || fieldName.includes('_ms')) return 'milliseconds';
    if (fieldName.includes('percent') || fieldName.includes('ratio')) return 'percent';
    if (fieldName.includes('count')) return 'count';
    return '';
  }
  
  /**
   * Helper to build metric aggregations
   */
  public buildMetricAggregation(metricField: string, aggregationType: string = 'avg'): any {
    const validAggregations = ['avg', 'sum', 'min', 'max', 'cardinality', 'value_count'];
    if (!validAggregations.includes(aggregationType)) {
      aggregationType = 'avg';
    }
    
    return {
      [aggregationType]: {
        field: metricField
      }
    };
  }
  
  /**
   * Helper to build date histogram aggregation
   */
  public buildDateHistogram(interval: string = '1m', field: string = '@timestamp'): any {
    return {
      date_histogram: {
        field: field,
        interval: interval,
        min_doc_count: 0,
        extended_bounds: {
          min: 'now-1h',
          max: 'now'
        }
      }
    };
  }
}