import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { ElasticsearchDataError, DataType } from './errors.js';
import { logger } from '../logger.js';

/**
 * Functions for checking data availability in Elasticsearch
 */
export class DataAvailabilityGuards {
  /**
   * Check if logs are available in Elasticsearch
   * @param esAdapter Elasticsearch adapter instance
   * @throws ElasticsearchDataError if logs are not available
   */
  static async checkLogsAvailability(esAdapter: ElasticsearchAdapter): Promise<void> {
    try {
      // Try to get indices that match log patterns
      const indices = await esAdapter.getIndices();
      const logIndices = indices.filter(index => 
        index.startsWith('.ds-logs-') || 
        index.includes('logs') || 
        index.includes('log-')
      );
      
      if (logIndices.length === 0) {
        throw new ElasticsearchDataError(
          'No log indices found in Elasticsearch. Please ensure the OpenTelemetry logs are being sent to Elasticsearch.',
          'logs',
          { indices }
        );
      }
      
      // Try to get a sample of logs to confirm data exists
      const sampleLogs = await esAdapter.queryLogs({
        size: 1,
        query: {
          match_all: {}
        }
      });
      
      if (!sampleLogs.hits || sampleLogs.hits.total.value === 0) {
        throw new ElasticsearchDataError(
          'Log indices exist but no log data was found. Please ensure the OpenTelemetry logs are being sent to Elasticsearch.',
          'logs',
          { indices: logIndices }
        );
      }
      
      logger.debug('Log data is available in Elasticsearch');
    } catch (error) {
      if (error instanceof ElasticsearchDataError) {
        throw error;
      }
      
      // Handle other errors
      logger.error('Error checking logs availability', { error });
      throw new ElasticsearchDataError(
        'Error checking logs availability in Elasticsearch',
        'logs',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Check if metrics are available in Elasticsearch
   * @param esAdapter Elasticsearch adapter instance
   * @throws ElasticsearchDataError if metrics are not available
   */
  static async checkMetricsAvailability(esAdapter: ElasticsearchAdapter): Promise<void> {
    try {
      // Try to get indices that match metrics patterns
      const indices = await esAdapter.getIndices();
      const metricsIndices = indices.filter(index => 
        index.startsWith('.ds-metrics-') || 
        index.includes('metrics') || 
        index.includes('metric-')
      );
      
      if (metricsIndices.length === 0) {
        throw new ElasticsearchDataError(
          'No metrics indices found in Elasticsearch. Please ensure the OpenTelemetry metrics are being sent to Elasticsearch.',
          'metrics',
          { indices }
        );
      }
      
      // Try to get a sample of metrics to confirm data exists
      const sampleMetrics = await esAdapter.queryMetrics({
        size: 1,
        query: {
          match_all: {}
        }
      });
      
      if (!sampleMetrics.hits || sampleMetrics.hits.total.value === 0) {
        throw new ElasticsearchDataError(
          'Metrics indices exist but no metrics data was found. Please ensure the OpenTelemetry metrics are being sent to Elasticsearch.',
          'metrics',
          { indices: metricsIndices }
        );
      }
      
      logger.debug('Metrics data is available in Elasticsearch');
    } catch (error) {
      if (error instanceof ElasticsearchDataError) {
        throw error;
      }
      
      // Handle other errors
      logger.error('Error checking metrics availability', { error });
      throw new ElasticsearchDataError(
        'Error checking metrics availability in Elasticsearch',
        'metrics',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Check if traces are available in Elasticsearch
   * @param esAdapter Elasticsearch adapter instance
   * @throws ElasticsearchDataError if traces are not available
   */
  static async checkTracesAvailability(esAdapter: ElasticsearchAdapter): Promise<void> {
    try {
      // Try to get indices that match traces patterns
      const indices = await esAdapter.getIndices();
      const tracesIndices = indices.filter(index => 
        index.startsWith('.ds-traces-') || 
        index.includes('traces') || 
        index.includes('trace-')
      );
      
      if (tracesIndices.length === 0) {
        throw new ElasticsearchDataError(
          'No traces indices found in Elasticsearch. Please ensure the OpenTelemetry traces are being sent to Elasticsearch.',
          'traces',
          { indices }
        );
      }
      
      // Try to get a sample of traces to confirm data exists
      const sampleTraces = await esAdapter.queryTraces({
        size: 1,
        query: {
          match_all: {}
        }
      });
      
      if (!sampleTraces.hits || sampleTraces.hits.total.value === 0) {
        throw new ElasticsearchDataError(
          'Traces indices exist but no traces data was found. Please ensure the OpenTelemetry traces are being sent to Elasticsearch.',
          'traces',
          { indices: tracesIndices }
        );
      }
      
      logger.debug('Traces data is available in Elasticsearch');
    } catch (error) {
      if (error instanceof ElasticsearchDataError) {
        throw error;
      }
      
      // Handle other errors
      logger.error('Error checking traces availability', { error });
      throw new ElasticsearchDataError(
        'Error checking traces availability in Elasticsearch',
        'traces',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }
}
