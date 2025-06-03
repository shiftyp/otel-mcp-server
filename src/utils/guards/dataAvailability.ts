import { BaseSearchAdapter } from '../../adapters/base/searchAdapter.js';
import { ElasticsearchDataError, DataType } from './errors.js';
import { logger } from '../logger.js';

/**
 * Functions for checking data availability in the search backend
 */
export class DataAvailabilityGuards {
  /**
   * Check if logs are available in the search backend
   * @param searchAdapter Search adapter instance
   * @throws ElasticsearchDataError if logs are not available
   */
  static async checkLogsAvailability(searchAdapter: BaseSearchAdapter): Promise<void> {
    try {
      // Try to get indices that match log patterns
      const indices = await searchAdapter.getIndices();
      const logIndices = indices.filter(index => 
        index.startsWith('logs-') || 
        index.includes('logs') || 
        index.includes('log-')
      );
      
      if (logIndices.length === 0) {
        throw new ElasticsearchDataError(
          'No log indices found. Please ensure the OpenTelemetry logs are being sent to the search backend.',
          'logs',
          { indices }
        );
      }
      
      // Try to get a sample of logs to confirm data exists
      const sampleLogs = await searchAdapter.queryLogs({
        size: 1,
        query: {
          match_all: {}
        }
      });
      
      if (!sampleLogs || typeof sampleLogs !== 'object' || !('hits' in sampleLogs) || !(sampleLogs as any).hits || (sampleLogs as any).hits.total.value === 0) {
        throw new ElasticsearchDataError(
          'Log indices exist but no log data was found. Please ensure the OpenTelemetry logs are being sent to the search backend.',
          'logs',
          { indices: logIndices }
        );
      }
      
      logger.debug('Log data is available in the search backend');
    } catch (error) {
      if (error instanceof ElasticsearchDataError) {
        throw error;
      }
      
      // Handle other errors
      logger.error('Error checking logs availability', { error });
      throw new ElasticsearchDataError(
        'Error checking logs availability in the search backend',
        'logs',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Check if metrics are available in the search backend
   * @param searchAdapter Search adapter instance
   * @throws ElasticsearchDataError if metrics are not available
   */
  static async checkMetricsAvailability(searchAdapter: BaseSearchAdapter): Promise<void> {
    try {
      // Try to get indices that match metrics patterns
      const indices = await searchAdapter.getIndices();
      const metricsIndices = indices.filter(index => 
        index.startsWith('metrics-') || 
        index.includes('metrics') || 
        index.includes('metric-')
      );
      
      if (metricsIndices.length === 0) {
        throw new ElasticsearchDataError(
          'No metrics indices found. Please ensure the OpenTelemetry metrics are being sent to the search backend.',
          'metrics',
          { indices }
        );
      }
      
      // Try to get a sample of metrics to confirm data exists
      const sampleMetrics = await searchAdapter.queryMetrics({
        size: 1,
        query: {
          match_all: {}
        }
      });
      
      if (!sampleMetrics || typeof sampleMetrics !== 'object' || !('hits' in sampleMetrics) || !(sampleMetrics as any).hits || (sampleMetrics as any).hits.total.value === 0) {
        throw new ElasticsearchDataError(
          'Metrics indices exist but no metrics data was found. Please ensure the OpenTelemetry metrics are being sent to the search backend.',
          'metrics',
          { indices: metricsIndices }
        );
      }
      
      logger.debug('Metrics data is available in the search backend');
    } catch (error) {
      if (error instanceof ElasticsearchDataError) {
        throw error;
      }
      
      // Handle other errors
      logger.error('Error checking metrics availability', { error });
      throw new ElasticsearchDataError(
        'Error checking metrics availability in the search backend',
        'metrics',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Check if traces are available in the search backend
   * @param searchAdapter Search adapter instance
   * @throws ElasticsearchDataError if traces are not available
   */
  static async checkTracesAvailability(searchAdapter: BaseSearchAdapter): Promise<void> {
    try {
      // Try to get indices that match trace patterns
      const indices = await searchAdapter.getIndices();
      const traceIndices = indices.filter(index => 
        index.startsWith('traces-') || 
        index.includes('traces') || 
        index.includes('trace-') ||
        index.includes('apm-')
      );
      
      if (traceIndices.length === 0) {
        throw new ElasticsearchDataError(
          'No trace indices found. Please ensure the OpenTelemetry traces are being sent to the search backend.',
          'traces',
          { indices }
        );
      }
      
      // Try to get a sample of traces to confirm data exists
      const sampleTraces = await searchAdapter.queryTraces({
        size: 1,
        query: {
          match_all: {}
        }
      });
      
      if (!sampleTraces || typeof sampleTraces !== 'object' || !('hits' in sampleTraces) || !(sampleTraces as any).hits || (sampleTraces as any).hits.total.value === 0) {
        throw new ElasticsearchDataError(
          'Trace indices exist but no trace data was found. Please ensure the OpenTelemetry traces are being sent to the search backend.',
          'traces',
          { indices: traceIndices }
        );
      }
      
      logger.debug('Trace data is available in the search backend');
    } catch (error) {
      if (error instanceof ElasticsearchDataError) {
        throw error;
      }
      
      // Handle other errors
      logger.error('Error checking traces availability', { error });
      throw new ElasticsearchDataError(
        'Error checking traces availability in the search backend',
        'traces',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Check data availability for all telemetry types
   * @param searchAdapter Search adapter instance
   * @returns Object with availability status for each data type
   */
  static async checkAllDataAvailability(searchAdapter: BaseSearchAdapter): Promise<{
    logs: boolean;
    metrics: boolean;
    traces: boolean;
  }> {
    const availability = {
      logs: false,
      metrics: false,
      traces: false
    };

    // Check logs
    try {
      await this.checkLogsAvailability(searchAdapter);
      availability.logs = true;
    } catch (error) {
      logger.debug('Logs not available', { error });
    }

    // Check metrics
    try {
      await this.checkMetricsAvailability(searchAdapter);
      availability.metrics = true;
    } catch (error) {
      logger.debug('Metrics not available', { error });
    }

    // Check traces
    try {
      await this.checkTracesAvailability(searchAdapter);
      availability.traces = true;
    } catch (error) {
      logger.debug('Traces not available', { error });
    }

    return availability;
  }
}