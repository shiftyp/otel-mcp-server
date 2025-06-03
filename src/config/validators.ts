import { Config, ConfigOverrides } from './types.js';
import { logger } from '../utils/logger.js';

/**
 * Validation errors collection
 */
export class ValidationErrors {
  private errors: string[] = [];
  
  add(error: string): void {
    this.errors.push(error);
  }
  
  hasErrors(): boolean {
    return this.errors.length > 0;
  }
  
  getErrors(): string[] {
    return [...this.errors];
  }
  
  toString(): string {
    return this.errors.join('; ');
  }
}

/**
 * Validate connection configuration
 */
function validateConnection(config: Config, errors: ValidationErrors): void {
  if (!config.connection.baseURL && !process.env.ELASTICSEARCH_URL && !process.env.OPENSEARCH_URL) {
    errors.add('Connection baseURL is required');
  }
  
  if (config.connection.timeout && config.connection.timeout < 1000) {
    errors.add('Connection timeout must be at least 1000ms');
  }
  
  if (config.connection.maxRetries && config.connection.maxRetries < 0) {
    errors.add('Connection maxRetries cannot be negative');
  }
  
  if (config.connection.retryDelay && config.connection.retryDelay < 100) {
    errors.add('Connection retryDelay must be at least 100ms');
  }
}

/**
 * Validate performance configuration
 */
function validatePerformance(config: Config, errors: ValidationErrors): void {
  if (config.performance.maxQuerySize < 1) {
    errors.add('Performance maxQuerySize must be at least 1');
  }
  
  if (config.performance.maxQuerySize > 100000) {
    errors.add('Performance maxQuerySize cannot exceed 100000');
  }
  
  if (config.performance.defaultPageSize < 1) {
    errors.add('Performance defaultPageSize must be at least 1');
  }
  
  if (config.performance.defaultPageSize > config.performance.maxQuerySize) {
    errors.add('Performance defaultPageSize cannot exceed maxQuerySize');
  }
  
  if (config.performance.maxConcurrentRequests < 1) {
    errors.add('Performance maxConcurrentRequests must be at least 1');
  }
  
  if (config.performance.cacheSize < 0) {
    errors.add('Performance cacheSize cannot be negative');
  }
  
  if (config.performance.cacheTTL < 0) {
    errors.add('Performance cacheTTL cannot be negative');
  }
}

/**
 * Validate ML configuration
 */
function validateML(config: Config, errors: ValidationErrors): void {
  // Anomaly detection
  if (config.ml.anomalyDetection.defaultSensitivity < 0 || config.ml.anomalyDetection.defaultSensitivity > 1) {
    errors.add('ML anomalyDetection defaultSensitivity must be between 0 and 1');
  }
  
  if (config.ml.anomalyDetection.defaultWindowSize < 1) {
    errors.add('ML anomalyDetection defaultWindowSize must be at least 1');
  }
  
  if (config.ml.anomalyDetection.minDataPoints < 1) {
    errors.add('ML anomalyDetection minDataPoints must be at least 1');
  }
  
  // Forecasting
  if (config.ml.forecasting.defaultHorizon < 1) {
    errors.add('ML forecasting defaultHorizon must be at least 1');
  }
  
  if (config.ml.forecasting.defaultConfidence < 0 || config.ml.forecasting.defaultConfidence > 1) {
    errors.add('ML forecasting defaultConfidence must be between 0 and 1');
  }
  
  // Clustering
  if (config.ml.clustering.defaultNumClusters < 2) {
    errors.add('ML clustering defaultNumClusters must be at least 2');
  }
  
  if (config.ml.clustering.minClusterSize < 1) {
    errors.add('ML clustering minClusterSize must be at least 1');
  }
  
  // Embedding
  if (config.ml.embedding.batchSize < 1) {
    errors.add('ML embedding batchSize must be at least 1');
  }
  
  if (config.ml.embedding.maxRetries < 0) {
    errors.add('ML embedding maxRetries cannot be negative');
  }
  
  if (config.ml.embedding.provider === 'openai' && !config.ml.embedding.apiKey && !process.env.OPENAI_API_KEY) {
    errors.add('ML embedding requires apiKey for OpenAI provider');
  }
}

/**
 * Validate telemetry configuration
 */
function validateTelemetry(config: Config, errors: ValidationErrors): void {
  if (!config.telemetry.indices.traces) {
    errors.add('Telemetry indices.traces is required');
  }
  
  if (!config.telemetry.indices.metrics) {
    errors.add('Telemetry indices.metrics is required');
  }
  
  if (!config.telemetry.indices.logs) {
    errors.add('Telemetry indices.logs is required');
  }
  
  const requiredFields = ['service', 'timestamp', 'traceId', 'spanId'];
  for (const field of requiredFields) {
    if (!config.telemetry.fields[field]) {
      errors.add(`Telemetry fields.${field} is required`);
    }
  }
}

/**
 * Validate a complete configuration
 */
export function validateConfig(config: Config): ValidationErrors {
  const errors = new ValidationErrors();
  
  // Validate backend
  if (!['auto', 'elasticsearch', 'opensearch'].includes(config.backend)) {
    errors.add('Invalid backend type');
  }
  
  // Validate sub-configurations
  validateConnection(config, errors);
  validatePerformance(config, errors);
  validateML(config, errors);
  validateTelemetry(config, errors);
  
  if (errors.hasErrors()) {
    logger.error('Configuration validation failed', { errors: errors.getErrors() });
  }
  
  return errors;
}

/**
 * Validate configuration overrides
 */
export function validateOverrides(overrides: ConfigOverrides): ValidationErrors {
  const errors = new ValidationErrors();
  
  if (overrides.backend && !['auto', 'elasticsearch', 'opensearch'].includes(overrides.backend)) {
    errors.add('Invalid backend type in overrides');
  }
  
  if (overrides.connection?.timeout && overrides.connection.timeout < 1000) {
    errors.add('Connection timeout override must be at least 1000ms');
  }
  
  if (overrides.performance?.maxQuerySize && overrides.performance.maxQuerySize < 1) {
    errors.add('Performance maxQuerySize override must be at least 1');
  }
  
  if (overrides.ml?.anomalyDetection?.defaultSensitivity !== undefined) {
    const sensitivity = overrides.ml.anomalyDetection.defaultSensitivity;
    if (sensitivity < 0 || sensitivity > 1) {
      errors.add('ML anomalyDetection defaultSensitivity override must be between 0 and 1');
    }
  }
  
  return errors;
}