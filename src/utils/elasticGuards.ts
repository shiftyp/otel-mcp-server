import { ElasticsearchAdapter } from '../adapters/elasticsearch/index.js';
import { logger } from './logger.js';

/**
 * Error class for Elasticsearch data availability issues
 */
export class ElasticsearchDataError extends Error {
  constructor(message: string, public dataType: 'logs' | 'metrics' | 'traces', public details?: any) {
    super(message);
    this.name = 'ElasticsearchDataError';
  }
}

/**
 * Utility class to check for data availability in Elasticsearch
 */
export class ElasticGuards {
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
          'No log data found in Elasticsearch. Please ensure logs are being ingested properly.',
          'logs'
        );
      }
      
      // Try a simple query to check if logs are accessible
      const testQuery = {
        size: 1,
        query: { match_all: {} }
      };
      
      const response = await esAdapter.queryLogs(testQuery);
      
      if (!response.hits || response.hits.total?.value === 0) {
        throw new ElasticsearchDataError(
          'Log indices exist but no log data was found. Please check your log ingestion pipeline.',
          'logs',
          { indicesFound: logIndices }
        );
      }
      
      logger.debug('[ElasticGuards] Log data is available', { 
        indicesCount: logIndices.length,
        sampleCount: response.hits.total?.value
      });
    } catch (error) {
      if (error instanceof ElasticsearchDataError) {
        throw error;
      }
      
      // Handle other Elasticsearch errors
      logger.error('[ElasticGuards] Error checking logs availability', { error });
      throw new ElasticsearchDataError(
        `Error accessing log data: ${error instanceof Error ? error.message : String(error)}`,
        'logs',
        { originalError: error }
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
      // Try to get indices that match metric patterns
      const indices = await esAdapter.getIndices();
      const metricIndices = indices.filter(index => 
        index.startsWith('.ds-metrics-') || 
        index.includes('metrics') || 
        index.includes('metric-')
      );
      
      if (metricIndices.length === 0) {
        throw new ElasticsearchDataError(
          'No metric data found in Elasticsearch. Please ensure metrics are being ingested properly.',
          'metrics'
        );
      }
      
      // Try a simple query to check if metrics are accessible
      const testQuery = {
        size: 1,
        query: { match_all: {} }
      };
      
      const response = await esAdapter.queryMetrics(testQuery);
      
      if (!response.hits || response.hits.total?.value === 0) {
        throw new ElasticsearchDataError(
          'Metric indices exist but no metric data was found. Please check your metric ingestion pipeline.',
          'metrics',
          { indicesFound: metricIndices }
        );
      }
      
      logger.debug('[ElasticGuards] Metric data is available', { 
        indicesCount: metricIndices.length,
        sampleCount: response.hits.total?.value
      });
    } catch (error) {
      if (error instanceof ElasticsearchDataError) {
        throw error;
      }
      
      // Handle other Elasticsearch errors
      logger.error('[ElasticGuards] Error checking metrics availability', { error });
      throw new ElasticsearchDataError(
        `Error accessing metric data: ${error instanceof Error ? error.message : String(error)}`,
        'metrics',
        { originalError: error }
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
      // Try to get indices that match trace patterns
      const indices = await esAdapter.getIndices();
      const traceIndices = indices.filter(index => 
        index.startsWith('.ds-traces-') || 
        index.includes('traces') || 
        index.includes('trace-') ||
        index.includes('span')
      );
      
      if (traceIndices.length === 0) {
        throw new ElasticsearchDataError(
          'No trace data found in Elasticsearch. Please ensure traces are being ingested properly.',
          'traces'
        );
      }
      
      // Try a simple query to check if traces are accessible
      const testQuery = {
        size: 1,
        query: { match_all: {} }
      };
      
      const response = await esAdapter.queryTraces(testQuery);
      
      if (!response.hits || response.hits.total?.value === 0) {
        throw new ElasticsearchDataError(
          'Trace indices exist but no trace data was found. Please check your trace ingestion pipeline.',
          'traces',
          { indicesFound: traceIndices }
        );
      }
      
      logger.debug('[ElasticGuards] Trace data is available', { 
        indicesCount: traceIndices.length,
        sampleCount: response.hits.total?.value
      });
    } catch (error) {
      if (error instanceof ElasticsearchDataError) {
        throw error;
      }
      
      // Handle other Elasticsearch errors
      logger.error('[ElasticGuards] Error checking traces availability', { error });
      throw new ElasticsearchDataError(
        `Error accessing trace data: ${error instanceof Error ? error.message : String(error)}`,
        'traces',
        { originalError: error }
      );
    }
  }
  
  /**
   * Format an error response for MCP tools
   * @param error The error to format
   * @param params Optional parameters that were passed to the tool
   * @returns Formatted error response for MCP
   */
  static formatErrorResponse(error: any, params?: Record<string, any>): { content: Array<{type: string, text: string}> } {
    if (error instanceof ElasticsearchDataError) {
      const errorObj = {
        error: true,
        type: 'ElasticsearchDataError',
        message: error.message,
        dataType: error.dataType,
        details: error.details || {},
        params: params || {}
      };
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(errorObj)
        }]
      };
    }
    
    // Handle generic errors
    const errorObj = {
      error: true,
      type: error instanceof Error ? error.constructor.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
      params: params || {}
    };
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(errorObj)
      }]
    };
  }
}
