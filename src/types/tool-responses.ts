/**
 * Tool Response Types
 */

import { ServiceMetadata, FieldInfo, AnomalyResult, Trace, LogEntry, Metric } from './telemetry.js';
import { SearchResponse } from './elasticsearch.js';

// Base tool response
export interface ToolResponse<T = unknown> {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  data?: T;
  isError?: boolean;
}

// Query tool responses
export interface QueryToolResponse<T = unknown> {
  results: SearchResponse<T>;
  query: Record<string, unknown>;
  index: string;
  timeTaken: number;
}

// Discovery tool responses
export interface ServicesDiscoveryResponse {
  services: ServiceMetadata[];
  totalCount: number;
  byLanguage?: Record<string, number>;
  byEnvironment?: Record<string, number>;
}

export interface FieldsDiscoveryResponse {
  fields: FieldInfo[];
  totalCount: number;
  byType: Record<string, number>;
  commonPatterns?: string[];
}

// Analysis tool responses
export interface AnomalyDetectionResponse {
  anomalies: AnomalyResult[];
  summary: {
    totalAnomalies: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
    timeRange: { from: string; to: string };
  };
  insights?: string[];
  recommendations?: string[];
}

export interface SystemHealthResponse {
  summary: {
    healthScore: number;
    healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'critical';
    timeRange: { from: string; to: string };
    servicesAnalyzed: number;
  };
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
      errorRate: number;
    }>;
  };
  logs: {
    totalLogs: number;
    errorLogs: number;
    errorRate: number;
    logsByLevel: Record<string, number>;
  };
  metrics: {
    cpu: { average: number; max: number };
    memory: { average: number; max: number };
  };
  bottlenecks: Array<{
    type: string;
    description: string;
    impact: string;
    recommendation: string;
  }>;
  recommendations: string[];
}

export interface IncidentAnalysisResponse {
  incident: {
    time: string;
    timeRange: { from: string; to: string };
    service?: string;
    traceId?: string;
    severity: {
      level: string;
      score: number;
      factors: Array<{
        factor: string;
        value: unknown;
        impact: string;
      }>;
      recommendation: string;
    };
  };
  traces: {
    errorTraces: unknown[];
    latencyTrend: unknown[];
    totalTraces: number;
    errorCount: number;
  };
  logs: {
    logVolumeTrend: unknown[];
    topErrorMessages: Array<{ key: string; doc_count: number }>;
    incidentLogs: LogEntry[];
    totalLogs: number;
  };
  metrics: Record<string, unknown>;
  correlations: Array<{
    type: string;
    time: string;
    significance: string;
    [key: string]: unknown;
  }>;
  rootCauseHypotheses: Array<{
    hypothesis: string;
    confidence: string;
    evidence: string[];
    suggestedAction: string;
    patternType?: string;
    matchScore?: number;
  }>;
  timeline: Array<{
    time: string;
    type: string;
    description: string;
    severity: string;
  }>;
  recommendations: string[];
}

// ML tool responses
export interface ClusteringResponse {
  clusters: Array<{
    clusterId: string;
    size: number;
    percentage: number;
    characteristics: Record<string, unknown>;
    exemplars: string[];
    anomalyScore?: number;
  }>;
  summary: {
    totalTraces: number;
    numClusters: number;
    features: string[];
    silhouetteScore?: number;
  };
  insights: string[];
}

export interface ForecastResponse {
  forecast: Array<{
    timestamp: string;
    predicted: number;
    upperBound: number;
    lowerBound: number;
  }>;
  summary: {
    metric: string;
    historicalPeriod: string;
    forecastPeriod: string;
    confidence: number;
    trend: 'increasing' | 'decreasing' | 'stable';
    accuracy?: {
      mape?: number;
      rmse?: number;
    };
  };
  insights: string[];
  warnings?: string[];
}

export interface SemanticSearchResponse {
  results: Array<{
    log: LogEntry;
    score: number;
    highlight?: string;
    explanation?: string;
  }>;
  summary: {
    query: string;
    totalMatches: number;
    timeRange: { from: string; to: string };
    searchMethod: 'semantic' | 'hybrid' | 'keyword';
  };
  relatedQueries?: string[];
}

// Service analysis responses
export interface DependencyHealthResponse {
  service: string;
  analysis: {
    timeRange: { from: string; to: string };
    dependencyDepth: number;
    totalDependencies: number;
    directDependencies: number;
    transitiveDependencies: number;
  };
  healthScore: {
    overall: number;
    grade: string;
    breakdown: Array<{
      category: string;
      impact: number;
      reason: string;
    }>;
    trend: string;
  };
  dependencies: Array<{
    service: string;
    type: 'direct' | 'transitive';
    health: {
      status: string;
      score: number;
      errorRate: number;
      latency: number;
      availability: number;
    };
    risk: {
      level: string;
      score: number;
      factors: string[];
    };
  }>;
  criticalDependencies: {
    count: number;
    services: Array<{
      service: string;
      criticality: string;
      reason: string;
      impact: string;
    }>;
  };
  recommendations: Array<{
    priority: string;
    category: string;
    action: string;
    impact: string;
    implementation: string[];
  }>;
  summary: string;
}