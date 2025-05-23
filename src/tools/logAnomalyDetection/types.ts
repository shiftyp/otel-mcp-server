/**
 * Options for log anomaly detection
 */
export interface LogAnomalyOptions {
  methods?: ('frequency' | 'pattern' | 'statistical' | 'clustering')[];
  lookbackWindow?: string;    // e.g., "7d" for 7-day baseline
  interval?: string;          // e.g., "1h" for hourly buckets
  spikeThreshold?: number;    // e.g., 3x normal frequency
  patternKeywords?: string[]; // Custom error patterns
  includeDefaultPatterns?: boolean;
  zScoreThreshold?: number;   // For statistical detection
  percentileThreshold?: number;
  cardinalityThreshold?: number;
  maxResults?: number;
}

/**
 * Represents an anomaly detected in log data
 */
export interface LogAnomaly {
  timestamp: string;
  message: string;
  level?: string;
  service?: string;
  detectionMethod: string;
  score: number;
  reason: string;
  context?: Record<string, any>;
}

/**
 * Represents a frequency-based anomaly in logs
 */
export interface FrequencyAnomaly {
  timestamp: string;
  count: number;
  expectedCount: number;
  deviation: number;
  service?: string;
  level?: string;
  pattern?: string;
  score: number;
}

/**
 * Represents a pattern-based anomaly in logs
 */
export interface PatternAnomaly {
  timestamp: string;
  pattern: string;
  count: number;
  service?: string;
  level?: string;
  examples: string[];
  score: number;
}

/**
 * Represents a statistical anomaly in logs
 */
export interface StatisticalAnomaly {
  timestamp: string;
  field: string;
  value: any;
  expectedValue: any;
  deviation: number;
  zScore?: number;
  percentile?: number;
  service?: string;
  score: number;
}

/**
 * Represents a clustering-based anomaly in logs
 */
export interface ClusteringAnomaly {
  timestamp: string;
  cluster: string;
  size: number;
  expectedSize: number;
  deviation: number;
  service?: string;
  examples: string[];
  score: number;
}
