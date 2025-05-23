/**
 * Options for metric anomaly detection
 */
export interface MetricAnomalyOptions {
  absoluteThreshold?: number;     // Absolute value threshold
  zScoreThreshold?: number;       // Z-score threshold (default: 3)
  percentileThreshold?: number;   // Percentile threshold (default: 95)
  iqrMultiplier?: number;         // IQR multiplier for outlier detection (default: 1.5)
  changeThreshold?: number;       // Rate of change threshold as percentage (default: 50)
  interval?: string;              // Time interval for buckets (default: '1m')
  maxResults?: number;            // Maximum number of results to return (default: 100)
}

/**
 * Options for span anomaly detection
 */
export interface SpanAnomalyOptions {
  absoluteThreshold?: number;   // Absolute duration threshold in nanoseconds
  zScoreThreshold?: number;     // Z-score threshold (default: 3)
  percentileThreshold?: number; // Percentile threshold (default: 95)
  iqrMultiplier?: number;       // IQR multiplier for outlier detection (default: 1.5)
  maxResults?: number;          // Maximum number of results to return (default: 100)
  groupByOperation?: boolean;   // Whether to analyze each operation separately (default: true)
}

/**
 * Represents an anomaly detected in metrics data
 */
export interface MetricAnomaly {
  timestamp: string;
  value: number;
  expectedValue?: number;
  deviation?: number;
  zScore?: number;
  percentile?: number;
  changeRate?: number;
  detectionMethod: string;
  metricField: string;
  service?: string;
  threshold?: number;
}

/**
 * Represents an anomaly detected in span duration data
 */
export interface SpanAnomaly {
  spanId: string;
  traceId: string;
  name: string;
  service: string;
  duration: number;
  expectedDuration?: number;
  deviation?: number;
  zScore?: number;
  percentile?: number;
  detectionMethod: string;
  timestamp: string;
  threshold?: number;
}
