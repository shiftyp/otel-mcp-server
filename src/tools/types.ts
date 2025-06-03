/**
 * Tool return type interfaces
 * 
 * This file contains the return type interfaces for all tools in the system.
 * Each tool's executeImpl method returns data that conforms to these interfaces.
 */

// ============================================================================
// Query Tool Return Types
// ============================================================================

/**
 * Common structure for query tool responses (logs, metrics, traces)
 */
export interface QueryToolResponse {
  /** Total number of matching documents */
  total: number;
  /** Query execution time in milliseconds */
  took: number;
  /** Array of matching documents */
  hits: Array<Record<string, unknown>>;
  /** Aggregation results if requested */
  aggregations?: Record<string, unknown>;
}

// ============================================================================
// Discovery Tool Return Types
// ============================================================================

/**
 * Return type for servicesGet tool
 */
export interface ServicesGetResponse {
  /** List of service names (when includeMetadata is false) */
  services: string[] | ServiceInfo[];
  /** Total number of services */
  count: number;
  /** Services grouped by language (when includeMetadata is true) */
  byLanguage?: Record<string, ServiceInfo[]>;
  /** Services grouped by type (when includeMetadata is true) */
  byType?: Record<string, ServiceInfo[]>;
  /** List of unique languages */
  languages?: string[];
  /** List of unique types */
  types?: string[];
}

/**
 * Service information structure
 */
export interface ServiceInfo {
  /** Service name */
  name: string;
  /** Programming language */
  language?: string;
  /** Service type (e.g., web, database, cache) */
  type?: string;
  /** Additional metadata */
  [key: string]: unknown;
}

/**
 * Return type for logFieldsGet tool
 */
export interface LogFieldsGetResponse {
  /** Total number of fields */
  totalFields: number;
  /** Fields grouped by their data type */
  fieldsByType: Record<string, string[]>;
  /** Fields that can be used in aggregations */
  aggregatableFields: string[];
  /** Fields that can be searched */
  searchableFields: string[];
  /** Fields related to log levels */
  logLevelFields: string[];
  /** Fields containing message content */
  messageFields: string[];
  /** Top co-occurring field pairs */
  topCoOccurringFields: Array<[string, string[]]>;
  /** Detailed field information (first 100 fields) */
  fieldDetails: FieldInfo[];
}

/**
 * Return type for traceFieldsGet tool
 */
export interface TraceFieldsGetResponse {
  /** Total number of fields */
  totalFields: number;
  /** Fields grouped by their data type */
  fieldsByType: Record<string, string[]>;
  /** Fields that can be used in aggregations */
  aggregatableFields: string[];
  /** Fields that can be searched */
  searchableFields: string[];
  /** Common fields from sample trace */
  commonFields: string[];
  /** Detailed field information (first 100 fields) */
  fieldDetails: FieldInfo[];
}

/**
 * Field information structure
 */
export interface FieldInfo {
  /** Field name */
  name: string;
  /** Field data type */
  type: string;
  /** Whether field can be aggregated */
  aggregatable: boolean;
  /** Whether field can be searched */
  searchable: boolean;
}

// ============================================================================
// Analysis Tool Return Types
// ============================================================================

/**
 * Return type for detectLogAnomalies tool
 */
export interface LogAnomaliesDetectResponse {
  /** Method used for anomaly detection */
  method: 'ml-based' | 'statistical';
  /** ML-based anomaly results */
  anomalies?: AnomalyResult[];
  /** Statistical rare pattern results */
  rarePatterns?: PatternResult[];
  /** Volume spike information */
  volumeSpikes?: VolumeSpike[];
  /** Summary statistics */
  summary: {
    totalAnomalies?: number;
    fields?: string[];
    totalPatterns?: number;
    rarePatterns?: number;
    totalLogs?: number;
    averageVolumePer5Min?: number;
    spikesDetected?: number;
  };
}

/**
 * Anomaly detection result
 */
export interface AnomalyResult {
  /** Field where anomaly was detected */
  field: string;
  /** Anomaly score */
  score: number;
  /** Timestamp of anomaly */
  timestamp?: string;
  /** Additional context */
  [key: string]: unknown;
}

/**
 * Pattern analysis result
 */
export interface PatternResult {
  /** Pattern string */
  pattern: string;
  /** Number of occurrences */
  count: number;
  /** Frequency as percentage */
  frequency: number;
  /** Example messages */
  examples?: string[];
}

/**
 * Volume spike information
 */
export interface VolumeSpike {
  /** Timestamp of spike */
  timestamp: string;
  /** Document count during spike */
  count: number;
  /** Log levels during spike */
  levels: Array<{ key: string; doc_count: number }>;
  /** Spike ratio compared to average */
  spikeRatio: number;
}

/**
 * Return type for searchLogsSemantic tool
 */
export interface SemanticLogSearchResponse {
  /** Original search query */
  query: string;
  /** Analyzed query intent */
  queryIntent: QueryIntent;
  /** Time range used for search */
  timeRange: {
    from: string;
    to: string;
  };
  /** Service filter if applied */
  service?: string;
  /** Search results */
  results: Array<{
    _score: number;
    _source: Record<string, any>;
  }>;
  /** Total number of hits */
  totalHits: number;
  /** Maximum relevance score */
  maxScore: number;
  /** Analysis of results */
  analysis: {
    relevance: 'excellent' | 'good' | 'moderate' | 'poor' | 'no_results';
    scoreStats?: {
      avg: number;
      max: number;
      min: number;
    };
    serviceDistribution: Record<string, number>;
    themes: string[];
  };
  /** Intent-based insights */
  insights: SemanticInsights;
  /** Query improvement suggestions */
  suggestions: string[];
  /** Related search suggestions */
  relatedSearches: string[];
}

/**
 * Query intent analysis
 */
export interface QueryIntent {
  /** Type of query intent */
  type: 'error_investigation' | 'performance_investigation' | 'root_cause_analysis' | 'status_check' | 'general';
  /** Extracted keywords */
  keywords: Array<{
    type: string;
    value: string;
    [key: string]: unknown;
  }>;
  /** Additional context */
  context: Record<string, any>;
  /** Confidence score */
  confidence: number;
}

/**
 * Semantic search insights
 */
export interface SemanticInsights {
  /** Summary of findings */
  summary: string;
  /** Detailed findings */
  findings: Array<{
    type: string;
    description: string;
    severity?: string;
    examples?: string[];
    [key: string]: unknown;
  }>;
  /** Recommendations based on findings */
  recommendations: string[];
  /** Suggested next steps */
  nextSteps: string[];
}

/**
 * Return type for getSystemHealthSummary tool
 */
export interface SystemHealthSummaryResponse {
  /** Overall summary */
  summary: {
    healthScore: number;
    healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'critical';
    timeRange: {
      from: string;
      to: string;
    };
    servicesAnalyzed: number;
  };
  /** Trace analysis results */
  traces: {
    totalTraces: number;
    errorRate: number;
    latency: {
      p50: number;
      p95: number;
      p99: number;
    };
    topOperations: Array<{
      operation: string;
      count: number;
      avgDuration: number;
    }>;
  };
  /** Log analysis results */
  logs: {
    totalLogs: number;
    errorLogs: number;
    errorRate: number;
    logsByLevel: Record<string, number>;
  };
  /** Metric analysis results */
  metrics: {
    cpu: {
      average: number;
      max: number;
    };
    memory: {
      average: number;
      max: number;
    };
  };
  /** Identified bottlenecks */
  bottlenecks: Array<{
    type: 'high_latency' | 'high_error_rate' | 'high_volume';
    operation?: string;
    source?: string;
    target?: string;
    avgDuration?: number;
    errorRate?: number;
    callCount?: number;
    impact: 'high' | 'medium' | 'low';
    recommendation: string;
  }>;
  /** Health recommendations */
  recommendations: string[];
}

/**
 * Return type for detectMetricAnomalies tool
 */
export interface MetricAnomaliesDetectResponse {
  /** Method used for detection */
  method: 'ml-based' | 'statistical';
  /** Detected anomalies */
  anomalies: Array<{
    metric: string;
    timestamp: string;
    value: number;
    score?: number;
    expectedRange?: {
      min: number;
      max: number;
    };
    severity?: 'low' | 'medium' | 'high';
  }>;
  /** Summary statistics */
  summary: {
    totalAnomalies: number;
    byMetric: Record<string, number>;
    bySeverity?: Record<string, number>;
  };
}

/**
 * Return type for forecastMetrics tool
 */
export interface ForecastMetricsResponse {
  /** Metric being forecasted */
  metric: string;
  /** Forecast period */
  period: {
    from: string;
    to: string;
  };
  /** Forecasted values */
  forecast: Array<{
    timestamp: string;
    value: number;
    confidence: {
      lower: number;
      upper: number;
    };
  }>;
  /** Model information */
  model: {
    type: string;
    accuracy?: number;
    parameters?: Record<string, any>;
  };
}

/**
 * Return type for traceClustering tool
 */
export interface TraceClusteringResponse {
  /** Number of clusters found */
  clusterCount: number;
  /** Cluster details */
  clusters: Array<{
    id: string | number;
    size: number;
    centroid?: Record<string, any>;
    characteristics: {
      avgDuration: number;
      errorRate: number;
      services: string[];
      operations: string[];
    };
    samples: Array<Record<string, any>>;
  }>;
  /** Clustering metadata */
  metadata: {
    algorithm: string;
    parameters: Record<string, any>;
    quality?: number;
  };
}

/**
 * Return type for incidentAnalysis tool
 */
export interface IncidentAnalysisResponse {
  /** Incident timeline */
  timeline: Array<{
    timestamp: string;
    event: string;
    severity: 'info' | 'warning' | 'error' | 'critical';
    service?: string;
    details?: Record<string, any>;
  }>;
  /** Root cause analysis */
  rootCause: {
    identified: boolean;
    confidence: number;
    candidates: Array<{
      service: string;
      component?: string;
      evidence: string[];
      probability: number;
    }>;
  };
  /** Impact assessment */
  impact: {
    affectedServices: string[];
    affectedOperations: string[];
    userImpact: string;
    duration: number;
  };
  /** Recommendations */
  recommendations: {
    immediate: string[];
    preventive: string[];
  };
}

/**
 * Return type for traceAnomalyClassifier tool
 */
export interface TraceAnomalyClassifierResponse {
  /** Classification results */
  classifications: Array<{
    traceId: string;
    anomalyType: string;
    confidence: number;
    characteristics: Record<string, any>;
  }>;
  /** Summary by anomaly type */
  summary: Record<string, {
    count: number;
    avgConfidence: number;
    examples: string[];
  }>;
}

// ============================================================================
// Common Types
// ============================================================================

/**
 * Base response interface that all tool responses can extend
 */
export interface BaseToolResponse {
  /** Optional metadata about the response */
  _metadata?: {
    /** Tool name that generated this response */
    tool: string;
    /** Execution time in milliseconds */
    executionTime?: number;
    /** Adapter type used */
    adapter?: string;
    /** Any warnings during execution */
    warnings?: string[];
  };
}

/**
 * Union type of all possible tool responses
 */
export type ToolResponse = 
  | QueryToolResponse
  | ServicesGetResponse
  | LogFieldsGetResponse
  | TraceFieldsGetResponse
  | LogAnomaliesDetectResponse
  | SemanticLogSearchResponse
  | SystemHealthSummaryResponse
  | MetricAnomaliesDetectResponse
  | ForecastMetricsResponse
  | TraceClusteringResponse
  | IncidentAnalysisResponse
  | TraceAnomalyClassifierResponse;