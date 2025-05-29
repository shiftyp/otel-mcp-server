import { OpenSearchCore } from '../core/core.js';
import { logger } from '../../../utils/logger.js';

// Types for ML operations
export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
}

export interface HistogramBucket {
  key: number;
  doc_count: number;
}

export interface HistogramMetric {
  timestamp: string;
  buckets: HistogramBucket[];
}

/**
 * OpenSearch Metrics Adapter Core
 * Provides base functionality for working with OpenTelemetry metrics data in OpenSearch
 */
export class MetricsAdapterCore extends OpenSearchCore {
  constructor(options: any) {
    super(options);
  }

  /**
   * Make a request to OpenSearch
   */
  public async request(method: string, url: string, body: any) {
    return this.callRequest(method, url, body);
  }
  
  /**
   * Recursively extract fields from mapping properties
   */
  protected extractFields(properties: any, prefix: string, fields: any[]): void {
    for (const fieldName in properties) {
      if (Object.prototype.hasOwnProperty.call(properties, fieldName)) {
        const field = properties[fieldName];
        const fullName = prefix ? `${prefix}.${fieldName}` : fieldName;
        
        // Add the field to the list
        fields.push({
          name: fullName,
          type: field.type || 'object',
          description: field.description || '',
          isMetric: this.isMetricField(fullName, field)
        });
        
        // Recursively process nested properties
        if (field.properties) {
          this.extractFields(field.properties, fullName, fields);
        }
      }
    }
  }
  
  /**
   * Determine if a field is a metric field based on naming conventions
   */
  protected isMetricField(name: string, field: any): boolean {
    // Check if the field is a numeric type
    const numericTypes = ['long', 'integer', 'short', 'byte', 'double', 'float', 'half_float', 'scaled_float'];
    const isNumeric = numericTypes.includes(field.type);
    
    // Check if the field name contains common metric indicators
    const metricIndicators = ['count', 'sum', 'min', 'max', 'avg', 'value', 'gauge', 'counter', 'histogram'];
    const hasMetricIndicator = metricIndicators.some(indicator => name.toLowerCase().includes(indicator));
    
    // Check if the field is in a metrics-specific path
    const metricPaths = ['metrics.', 'value.', 'sum.', 'gauge.', 'counter.'];
    const isInMetricPath = metricPaths.some(path => name.includes(path));
    
    return isNumeric && (hasMetricIndicator || isInMetricPath);
  }
  
  /**
   * Create sliding windows from time series data for ML processing
   */
  protected createSlidingWindows(timeSeriesData: TimeSeriesPoint[], windowSize: number): number[][] {
    const windows: number[][] = [];
    
    for (let i = 0; i <= timeSeriesData.length - windowSize; i++) {
      const window = timeSeriesData.slice(i, i + windowSize).map((point: TimeSeriesPoint) => point.value);
      windows.push(window);
    }
    
    return windows;
  }
  
  /**
   * Parse interval string to milliseconds
   */
  protected parseInterval(interval: string): number {
    const match = interval.match(/^(\d+)([smhd])$/);
    if (!match) return 60000; // Default to 1 minute
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60000;
      case 'h': return value * 3600000;
      case 'd': return value * 86400000;
      default: return 60000;
    }
  }
}
