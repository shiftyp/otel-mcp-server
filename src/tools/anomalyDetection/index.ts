import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { logger } from '../../utils/logger.js';
import { MetricAnomalyDetector } from './metricAnomalyDetector.js';
import { SpanAnomalyDetector } from './spanAnomalyDetector.js';
import { MetricType } from '../otelMetrics.js';

/**
 * Tool for basic anomaly detection over OTEL metrics and traces.
 * Combines multiple detection strategies for comprehensive anomaly detection.
 */
export class AnomalyDetectionTool {
  private metricDetector: MetricAnomalyDetector;
  private spanDetector: SpanAnomalyDetector;

  constructor(private esAdapter: ElasticsearchAdapter) {
    this.metricDetector = new MetricAnomalyDetector(esAdapter);
    this.spanDetector = new SpanAnomalyDetector(esAdapter);
  }

  /**
   * Detect anomalies in a metric for a service and time window using a flexible hybrid approach.
   * Delegates to the MetricAnomalyDetector
   * 
   * @param startTime ISO8601 start time
   * @param endTime ISO8601 end time
   * @param metricField Required specific metric field to analyze
   * @param metricType Required metric type to use for detection
   * @param serviceOrServices Optional service name or array of services
   * @param options Optional configuration parameters
   * @returns Detected anomalies and statistics
   */
  async detectMetricAnomalies(
    startTime: string, 
    endTime: string, 
    metricField: string,
    metricType: MetricType,
    serviceOrServices?: string | string[], 
    options: {
      absoluteThreshold?: number;     // Absolute value threshold
      zScoreThreshold?: number;       // Z-score threshold (default: 3)
      percentileThreshold?: number;   // Percentile threshold (default: 95)
      iqrMultiplier?: number;         // IQR multiplier for outlier detection (default: 1.5)
      changeThreshold?: number;       // Rate of change threshold as percentage (default: 50)
      interval?: string;              // Time interval for buckets (default: '1m')
      maxResults?: number;            // Maximum number of results to return (default: 100)
    } = {}
  ) {
    logger.info('[Anomaly Detection] Detecting metric anomalies', { 
      startTime, 
      endTime, 
      metricField, 
      metricType,
      serviceOrServices 
    });
    
    return this.metricDetector.detectAnomalies(
      startTime, 
      endTime, 
      metricField, 
      metricType,
      serviceOrServices, 
      options
    );
  }

  /**
   * Detect anomalies in span durations
   * Delegates to the SpanAnomalyDetector
   */
  async detectSpanDurationAnomalies(
    startTime: string, 
    endTime: string, 
    serviceOrServices?: string | string[], 
    operation?: string, 
    options: {
      absoluteThreshold?: number;   // Absolute duration threshold in nanoseconds
      zScoreThreshold?: number;     // Z-score threshold (default: 3)
      percentileThreshold?: number; // Percentile threshold (default: 95)
      iqrMultiplier?: number;       // IQR multiplier for outlier detection (default: 1.5)
      maxResults?: number;          // Maximum number of results to return (default: 100)
      groupByOperation?: boolean;   // Whether to analyze each operation separately (default: true)
    } = {}
  ) {
    logger.info('[Anomaly Detection] Detecting span duration anomalies', { 
      startTime, 
      endTime, 
      serviceOrServices, 
      operation 
    });
    
    return this.spanDetector.detectAnomalies(
      startTime, 
      endTime, 
      serviceOrServices, 
      operation, 
      options
    );
  }
}

// Re-export the types for external use
export * from './metricAnomalyDetector.js';
export * from './spanAnomalyDetector.js';
export * from './types.js';
