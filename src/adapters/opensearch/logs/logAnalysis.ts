import { logger } from '../../../utils/logger.js';
import { LogsAdapterCore } from './logCore.js';
import { LogNLPAnalysis } from './nlpAnalysis.js';

/**
 * OpenSearch Logs Analysis Adapter
 * Provides functionality for analyzing OpenTelemetry logs data using OpenSearch ML capabilities
 */
export class LogsAnalysisAdapter extends LogsAdapterCore {
  constructor(options: any) {
    super(options);
  }

  /**
   * Perform time series analysis on log data using OpenSearch's PPL (Piped Processing Language)
   * This is a unique feature of OpenSearch not available in Elasticsearch
   */
  public async timeSeriesAnalysis(
    startTime: string,
    endTime: string,
    options: {
      service?: string,
      interval?: string,
      metricField?: string,
      queryString?: string,
      analysisType?: 'basic' | 'trend' | 'seasonality' | 'outliers' | 'full'
    } = {}
  ): Promise<any> {
    logger.info('[OpenSearch LogsAnalysisAdapter] Performing time series analysis', { startTime, endTime, options });
    
    try {
      const indexPattern = 'logs-*';
      const interval = options.interval || '5m';
      const metricField = options.metricField || 'count()';
      const analysisType = options.analysisType || 'basic';
      
      // Build the query filters
      let filterClause = `where @timestamp >= '${startTime}' and @timestamp <= '${endTime}'`;
      
      // Add service filter if specified
      if (options.service) {
        filterClause += ` and resource.attributes.service.name = '${options.service}'`;
      }
      
      // Add additional query string if specified
      if (options.queryString) {
        filterClause += ` and ${options.queryString}`;
      }
      
      // Use OpenSearch's PPL (Piped Processing Language) for time series analysis
      const pplEndpoint = '/_plugins/_ppl';
      
      // Basic time series query
      const pplQuery = `
        source = ${indexPattern}
        | ${filterClause}
        | stats ${metricField} by span(@timestamp, ${interval})
      `;
      
      const pplResponse = await this.request('POST', pplEndpoint, { query: pplQuery });
      
      if (!pplResponse.datarows || pplResponse.datarows.length === 0) {
        return { timeSeriesData: [], message: 'No log data found for time series analysis' };
      }
      
      // Process the results
      const timeSeriesData = pplResponse.datarows.map((row: any) => ({
        timestamp: row[0],
        value: row[1]
      }));
      
      // Results object
      const results: any = {
        timeSeriesData,
        metadata: {
          startTime,
          endTime,
          interval,
          metricField,
          service: options.service,
          queryString: options.queryString
        }
      };
      
      // For trend analysis, use linear regression
      if (['trend', 'full'].includes(analysisType)) {
        const mlEndpoint = '/_plugins/_ml';
        const regressionRequest = {
          algorithm: 'linear_regression',
          parameters: {},
          input_data: {
            // X values are timestamps converted to numeric (milliseconds since epoch)
            feature_values: timeSeriesData.map((point: any, index: number) => [index]),
            // Y values are the metric values
            target_values: timeSeriesData.map((point: any) => point.value)
          }
        };
        
        const regressionResponse = await this.request('POST', `${mlEndpoint}/train_predict`, regressionRequest);
        
        if (regressionResponse.prediction_result && regressionResponse.prediction_result.predicted_values) {
          results.trendAnalysis = {
            predictedValues: regressionResponse.prediction_result.predicted_values,
            model: regressionResponse.model_config
          };
        }
      }
      
      // For outlier detection, use DBSCAN
      if (['outliers', 'full'].includes(analysisType)) {
        const mlEndpoint = '/_plugins/_ml';
        const dbscanRequest = {
          algorithm: 'dbscan',
          parameters: {
            eps: 0.5,
            min_points: 3
          },
          input_data: {
            // Convert to 2D points (time index, value)
            feature_vectors: timeSeriesData.map((point: any, index: number) => [index, point.value])
          }
        };
        
        const dbscanResponse = await this.request('POST', `${mlEndpoint}/execute_cluster`, dbscanRequest);
        
        if (dbscanResponse.cluster_result && dbscanResponse.cluster_result.cluster_indices) {
          // Identify outliers (cluster -1)
          const outliers = [];
          
          for (let i = 0; i < dbscanResponse.cluster_result.cluster_indices.length; i++) {
            if (dbscanResponse.cluster_result.cluster_indices[i] === -1) {
              outliers.push({
                index: i,
                timestamp: timeSeriesData[i].timestamp,
                value: timeSeriesData[i].value
              });
            }
          }
          
          results.outlierAnalysis = {
            outliers,
            clusterCount: new Set(dbscanResponse.cluster_result.cluster_indices.filter((c: number) => c !== -1)).size
          };
        }
      }
      
      return results;
    } catch (error: any) {
      logger.error('[OpenSearch LogsAnalysisAdapter] Error performing time series analysis', { error });
      return { 
        timeSeriesData: [], 
        error: error.message || error,
        message: 'Failed to perform time series analysis on logs'
      };
    }
  }
  
  /**
   * Analyze sentiment of log messages using OpenSearch's NLP capabilities
   * @param logs Array of log messages to analyze
   */
  public async analyzeSentiment(logs: Array<{
    id: string;
    timestamp: string;
    message: string;
    service?: string;
    level?: string;
  }>): Promise<any> {
    logger.info('[OpenSearch LogsAnalysisAdapter] Analyzing log sentiment', { logCount: logs.length });
    return LogNLPAnalysis.analyzeSentiment(this, logs);
  }

  /**
   * Extract named entities from log messages using OpenSearch's NLP capabilities
   * @param logs Array of log messages to analyze
   */
  public async extractEntities(logs: Array<{
    id: string;
    timestamp: string;
    message: string;
    service?: string;
    level?: string;
  }>): Promise<any> {
    logger.info('[OpenSearch LogsAnalysisAdapter] Extracting entities from logs', { logCount: logs.length });
    return LogNLPAnalysis.extractEntities(this, logs);
  }

  /**
   * Classify log messages into categories using OpenSearch's NLP capabilities
   * @param logs Array of log messages to classify
   * @param categories Optional array of categories to classify into
   */
  public async classifyLogs(logs: Array<{
    id: string;
    timestamp: string;
    message: string;
    service?: string;
    level?: string;
  }>, categories?: string[]): Promise<any> {
    logger.info('[OpenSearch LogsAnalysisAdapter] Classifying logs', { logCount: logs.length, categories });
    return LogNLPAnalysis.classifyLogs(this, logs, categories);
  }
}
