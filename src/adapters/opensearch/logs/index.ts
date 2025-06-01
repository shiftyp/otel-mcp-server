import { LogsAdapterCore } from './logCore.js';
import { LogsSearchAdapter } from './logSearch.js';
import { LogsAnomalyDetectionAdapter } from './logAnomalyDetection.js';
import { LogsVectorSearchAdapter } from './logVectorSearch.js';
import { LogsAnalysisAdapter } from './logAnalysis.js';

/**
 * OpenSearch Logs Adapter
 * Provides functionality for working with OpenTelemetry logs data in OpenSearch
 * Takes advantage of OpenSearch-specific ML capabilities for anomaly detection and analysis
 */
export class LogsAdapter {
  private coreAdapter: LogsAdapterCore;
  private searchAdapter: LogsSearchAdapter;
  private anomalyDetectionAdapter: LogsAnomalyDetectionAdapter;
  private vectorSearchAdapter: LogsVectorSearchAdapter;
  private analysisAdapter: LogsAnalysisAdapter;

  constructor(options: any) {
    this.coreAdapter = new LogsAdapterCore(options);
    this.searchAdapter = new LogsSearchAdapter(options);
    this.anomalyDetectionAdapter = new LogsAnomalyDetectionAdapter(options);
    this.vectorSearchAdapter = new LogsVectorSearchAdapter(options);
    this.analysisAdapter = new LogsAnalysisAdapter(options);
  }

  /**
   * Make a request to OpenSearch
   */
  public async request(method: string, url: string, body: any) {
    return this.coreAdapter.request(method, url, body);
  }

  /**
   * Search for logs based on a query
   */
  public async searchLogs(query: any): Promise<any> {
    return this.searchAdapter.searchLogs(query);
  }
  
  /**
   * Query logs with a custom query
   * @param query The query object
   */
  public async queryLogs(query: any): Promise<any> {
    // Prepare the query
    const searchQuery = { ...query };
    
    // If search parameter is provided, convert it to a query_string query
    if (searchQuery.search && typeof searchQuery.search === 'string') {
      searchQuery.query = {
        query_string: {
          query: searchQuery.search,
          default_field: '*',
          default_operator: 'AND'
        }
      };
      delete searchQuery.search;
    }
    
    // Execute the query against the logs index
    return this.coreAdapter.request('POST', '/logs-*/_search', searchQuery);
  }
  
  /**
   * Find logs matching a query string with additional filters
   * @param params Search parameters including query, time range, service, etc.
   */
  public async findLogs(params: {
    query: string;
    startTime?: string;
    endTime?: string;
    service?: string;
    size?: number;
    includeTraces?: boolean;
    fields?: string[];
    sort?: 'asc' | 'desc';
  }): Promise<any> {
    // Build the query
    const query: any = {
      bool: {
        must: [
          {
            query_string: {
              query: params.query,
              default_field: '*',
              default_operator: 'AND'
            }
          }
        ]
      }
    };
    
    // Add time range filter if provided
    if (params.startTime || params.endTime) {
      const rangeFilter: any = {
        range: {
          '@timestamp': {}
        }
      };
      
      if (params.startTime) {
        rangeFilter.range['@timestamp'].gte = params.startTime;
      }
      
      if (params.endTime) {
        rangeFilter.range['@timestamp'].lte = params.endTime;
      }
      
      query.bool.must.push(rangeFilter);
    }
    
    // Add service filter if provided
    if (params.service) {
      query.bool.must.push({
        term: {
          'service.name': params.service
        }
      });
    }
    
    // Build the search request
    const searchRequest: any = {
      query,
      size: params.size || 100,
      sort: [
        { '@timestamp': { order: params.sort || 'desc' } }
      ]
    };
    
    // Add fields to include if specified
    if (params.fields && params.fields.length > 0) {
      searchRequest._source = params.fields;
    }
    
    // Execute the search
    return this.coreAdapter.request('POST', '/logs-*/_search', searchRequest);
  }
  
  /**
   * Get log fields with optional search filter and service filter
   * @param search Optional search pattern to filter fields
   * @param serviceFilter Optional service or services to filter fields
   * @param useSourceDocument Whether to include source document fields
   */
  public async getLogFields(search?: string, serviceFilter?: string | string[], useSourceDocument: boolean = true): Promise<any[]> {
    return this.searchAdapter.getLogFields(search, serviceFilter, useSourceDocument);
  }
  
  /**
   * Detect log anomalies using OpenSearch's Random Cut Forest algorithm
   * This leverages OpenSearch's ML capabilities for anomaly detection
   */
  public async detectLogAnomalies(
    startTime: string, 
    endTime: string, 
    options: {
      service?: string,
      level?: string,
      queryString?: string,
      maxResults?: number,
      minCount?: number
    } = {}
  ): Promise<any> {
    return this.anomalyDetectionAdapter.detectLogAnomalies(startTime, endTime, options);
  }
  
  /**
   * Find similar log messages using OpenSearch's k-NN capabilities
   * This leverages vector search for semantic similarity
   */
  public async findSimilarLogs(
    logMessage: string,
    options: {
      startTime?: string,
      endTime?: string,
      service?: string,
      level?: string,
      k?: number,
      minSimilarity?: number,
      includeVectors?: boolean
    } = {}
  ): Promise<any> {
    return this.vectorSearchAdapter.findSimilarLogs(logMessage, options);
  }
  
  /**
   * Cluster log messages using k-NN to identify patterns
   * This leverages OpenSearch's vector search and clustering capabilities
   */
  public async clusterLogMessages(
    options: {
      startTime: string,
      endTime: string,
      service?: string,
      level?: string,
      maxSamples?: number,
      clusterCount?: number,
      minClusterSize?: number
    }
  ): Promise<any> {
    return this.vectorSearchAdapter.clusterLogMessages(options);
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
    return this.analysisAdapter.timeSeriesAnalysis(startTime, endTime, options);
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
    return this.analysisAdapter.analyzeSentiment(logs);
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
    return this.analysisAdapter.extractEntities(logs);
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
    return this.analysisAdapter.classifyLogs(logs, categories);
  }
}
