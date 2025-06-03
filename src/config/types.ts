/**
 * Configuration types for the OTEL MCP Server
 */

export interface ConnectionConfig {
  baseURL?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

export interface FeatureConfig {
  enableMLTools: boolean;
  enableAdvancedAnalysis: boolean;
  enableCaching: boolean;
  enableSampling: boolean;
}

export interface PerformanceConfig {
  maxQuerySize: number;
  defaultPageSize: number;
  maxConcurrentRequests: number;
  cacheSize: number;
  cacheTTL: number;
}

export interface TelemetryIndicesConfig {
  traces: string;
  metrics: string;
  logs: string;
}

export interface TelemetryFieldsConfig {
  service: string;
  timestamp: string;
  traceId: string;
  spanId: string;
  duration: string;
  status: string;
  [key: string]: string; // Allow custom field mappings
}

export interface TelemetryConfig {
  indices: TelemetryIndicesConfig;
  fields: TelemetryFieldsConfig;
}

export interface MLAnomalyConfig {
  defaultSensitivity: number;
  defaultWindowSize: number;
  minDataPoints: number;
}

export interface MLForecastConfig {
  defaultHorizon: number;
  defaultConfidence: number;
}

export interface MLClusteringConfig {
  defaultNumClusters: number;
  minClusterSize: number;
}

export interface MLEmbeddingConfig {
  provider: 'openai' | 'huggingface' | 'custom';
  model: string;
  apiKey?: string;
  endpoint?: string;
  batchSize: number;
  maxRetries: number;
}

export interface MLConfig {
  anomalyDetection: MLAnomalyConfig;
  forecasting: MLForecastConfig;
  clustering: MLClusteringConfig;
  embedding: MLEmbeddingConfig;
}

export interface Config {
  backend: 'auto' | 'opensearch';
  connection: ConnectionConfig;
  features: FeatureConfig;
  performance: PerformanceConfig;
  telemetry: TelemetryConfig;
  ml: MLConfig;
}

export interface ConfigOverrides {
  backend?: 'auto' | 'opensearch';
  connection?: Partial<ConnectionConfig>;
  features?: Partial<FeatureConfig>;
  performance?: Partial<PerformanceConfig>;
  telemetry?: {
    indices?: Partial<TelemetryIndicesConfig>;
    fields?: Partial<TelemetryFieldsConfig>;
  };
  ml?: {
    anomalyDetection?: Partial<MLAnomalyConfig>;
    forecasting?: Partial<MLForecastConfig>;
    clustering?: Partial<MLClusteringConfig>;
    embedding?: Partial<MLEmbeddingConfig>;
  };
}