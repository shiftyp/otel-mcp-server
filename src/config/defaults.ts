import { Config } from './types.js';

/**
 * Default configuration values
 */
export const defaultConfig: Config = {
  backend: 'auto',
  connection: {
    timeout: 30000,
    maxRetries: 3,
    retryDelay: 1000
  },
  features: {
    enableMLTools: true,
    enableAdvancedAnalysis: true,
    enableCaching: true,
    enableSampling: true
  },
  performance: {
    maxQuerySize: 10000,
    defaultPageSize: 100,
    maxConcurrentRequests: 5,
    cacheSize: 100,
    cacheTTL: 300000 // 5 minutes
  },
  telemetry: {
    indices: {
      traces: 'traces-*',
      metrics: 'metrics-*',
      logs: 'logs-*'
    },
    fields: {
      service: 'service.name',
      timestamp: '@timestamp',
      traceId: 'trace.id',
      spanId: 'span.id',
      duration: 'duration',
      status: 'status.code'
    }
  },
  ml: {
    anomalyDetection: {
      defaultSensitivity: 0.8,
      defaultWindowSize: 60,
      minDataPoints: 100
    },
    forecasting: {
      defaultHorizon: 24,
      defaultConfidence: 0.95
    },
    clustering: {
      defaultNumClusters: 5,
      minClusterSize: 10
    },
    embedding: {
      provider: 'openai',
      model: 'text-embedding-3-small',
      batchSize: 100,
      maxRetries: 3
    }
  }
};