/**
 * Configuration module exports
 */

export { ConfigLoader } from './loader.js';
export { defaultConfig } from './defaults.js';
export { validateConfig, validateOverrides, ValidationErrors } from './validators.js';
export type {
  Config,
  ConfigOverrides,
  ConnectionConfig,
  FeatureConfig,
  PerformanceConfig,
  TelemetryConfig,
  TelemetryIndicesConfig,
  TelemetryFieldsConfig,
  MLConfig,
  MLAnomalyConfig,
  MLForecastConfig,
  MLClusteringConfig,
  MLEmbeddingConfig
} from './types.js';