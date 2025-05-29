import { OpenSearchCore } from '../core/core.js';
import { logger } from '../../../utils/logger.js';
import { LogNLPAnalysis } from './nlpAnalysis.js';

// Types for k-NN operations
interface LogVector {
  id: string;
  timestamp: string;
  message: string;
  vector: number[];
  service?: string;
  level?: string;
}

/**
 * OpenSearch Logs Adapter
 * Provides functionality for working with OpenTelemetry logs data in OpenSearch
 * Takes advantage of OpenSearch-specific ML capabilities for anomaly detection
 */
export class LogsAdapter extends OpenSearchCore {
  constructor(options: any) {
    super(options);
  }

  /**
   * Make a request to OpenSearch
   */
  public async request(method: string, url: string, body: any) {
    return this.callRequest(method, url, body);
  }

  /**
   * Search for logs based on a query
   */
  public async searchLogs(query: any): Promise<any> {
    logger.info('[OpenSearch LogsAdapter] Searching logs', { query });
    
    try {
      // Use the index pattern for logs
      const indexPattern = 'logs-*';
      
      // If the query has a search property, convert it to a query_string query
      if (query.search && typeof query.search === 'string') {
        query.query = {
          query_string: {
            query: query.search,
            default_field: "body",
            fields: ["body", "Body", "message", "Message", "log.message"]
          }
        };
        delete query.search;
      }
      
      // Add default sort if not specified
      if (!query.sort) {
        query.sort = [{ '@timestamp': { order: 'desc' } }];
      }
      
      // Add default size if not specified
      if (!query.size) {
        query.size = 100;
      }
      
      const response = await this.request('POST', `/${indexPattern}/_search`, query);
      return response;
    } catch (error: any) {
      logger.error('[OpenSearch LogsAdapter] Error searching logs', { error });
      return {
        hits: {
          total: { value: 0 },
          hits: []
        },
        error: error.message || error
      };
    }
  }
  
  /**
   * Get log fields with optional search filter
   */
  public async getLogFields(search?: string): Promise<any[]> {
    logger.info('[OpenSearch LogsAdapter] Getting log fields', { search });
    
    try {
      // Use the index pattern for logs
      const indexPattern = 'logs-*';
      
      // Get field mappings from OpenSearch
      const response = await this.request('GET', `/${indexPattern}/_mapping`, {});
      
      // Extract fields from the mapping response
      const fields: any[] = [];
      
      // Process each index in the response
      for (const indexName in response) {
        if (Object.prototype.hasOwnProperty.call(response, indexName)) {
          const index = response[indexName];
          const properties = index.mappings?.properties || {};
          
          // Process each field in the index
          this.extractFields(properties, '', fields);
        }
      }
      
      // Filter fields by search term if provided
      if (search) {
        const searchLower = search.toLowerCase();
        return fields.filter(field => field.name.toLowerCase().includes(searchLower));
      }
      
      return fields;
    } catch (error) {
      logger.error('[OpenSearch LogsAdapter] Error getting log fields', { error });
      return [];
    }
  }
  
  /**
   * Recursively extract fields from mapping properties
   */
  private extractFields(properties: any, prefix: string, fields: any[]): void {
    for (const fieldName in properties) {
      if (Object.prototype.hasOwnProperty.call(properties, fieldName)) {
        const field = properties[fieldName];
        const fullName = prefix ? `${prefix}.${fieldName}` : fieldName;
        
        // Add the field to the list
        fields.push({
          name: fullName,
          type: field.type || 'object',
          description: field.description || ''
        });
        
        // Recursively process nested properties
        if (field.properties) {
          this.extractFields(field.properties, fullName, fields);
        }
      }
    }
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
    logger.info('[OpenSearch LogsAdapter] Detecting log anomalies', { startTime, endTime, options });
    
    try {
      const indexPattern = 'logs-*';
      const maxResults = options.maxResults || 20;
      const minCount = options.minCount || 2;
      
      // Build the query filters
      const filters = [
        {
          range: {
            "@timestamp": {
              gte: startTime,
              lte: endTime
            }
          }
        }
      ] as any[];
      
      // Add service filter if specified
      if (options.service) {
        filters.push({
          term: {
            "resource.attributes.service.name": options.service
          }
        });
      }
      
      // Add log level filter if specified
      if (options.level) {
        filters.push({
          term: {
            "severity_text": options.level
          }
        });
      }
      
      // Add additional query string if specified
      if (options.queryString) {
        filters.push({
          query_string: {
            query: options.queryString
          }
        });
      }
      
      // First, get the log messages and their counts
      const countQuery = {
        query: {
          bool: {
            filter: filters
          }
        },
        size: 0,
        aggs: {
          message_counts: {
            terms: {
              field: "body.keyword",
              size: 10000,
              min_doc_count: minCount
            }
          }
        }
      };
      
      const countResponse = await this.request('POST', `/${indexPattern}/_search`, countQuery);
      
      if (!countResponse.aggregations?.message_counts?.buckets) {
        return { anomalies: [], message: "No log messages found" };
      }
      
      const messageBuckets = countResponse.aggregations.message_counts.buckets;
      
      // Now use OpenSearch's Random Cut Forest algorithm for anomaly detection
      // This is different from Elasticsearch's approach
      const rcfQuery = {
        query: {
          bool: {
            filter: filters
          }
        },
        size: 0,
        aggs: {
          timeseries: {
            date_histogram: {
              field: "@timestamp",
              fixed_interval: "1m"
            },
            aggs: {
              message_count: {
                value_count: {
                  field: "body.keyword"
                }
              },
              rcf: {
                random_cut_forest: {
                  field: "message_count",
                  shingle_size: 8,
                  sample_size: 256,
                  output_after: 32,
                  time_decay: 0.1,
                  anomaly_score_threshold: 2.0
                }
              }
            }
          }
        }
      };
      
      // Use OpenSearch's anomaly detection plugin API
      const anomalyDetectionEndpoint = "/_plugins/_anomaly_detection/detectors";
      
      // Create a temporary detector for this analysis
      const detectorConfig = {
        name: `log_anomaly_detector_${Date.now()}`,
        description: "Temporary detector for log anomaly detection",
        time_field: "@timestamp",
        indices: [indexPattern],
        feature_attributes: [
          {
            feature_name: "log_count",
            feature_enabled: true,
            aggregation_query: {
              value_count: {
                field: "body.keyword"
              }
            }
          }
        ],
        filter_query: {
          bool: {
            filter: filters
          }
        },
        detection_interval: {
          period: {
            interval: 1,
            unit: "MINUTES"
          }
        },
        window_delay: {
          period: {
            interval: 1,
            unit: "MINUTES"
          }
        }
      };
      
      // Create the detector
      const createDetectorResponse = await this.request('POST', anomalyDetectionEndpoint, detectorConfig);
      const detectorId = createDetectorResponse.detector_id;
      
      // Start the detector
      await this.request('POST', `${anomalyDetectionEndpoint}/${detectorId}/_start`, {});
      
      // Wait for the detector to initialize
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Get the results
      const resultsResponse = await this.request('GET', `${anomalyDetectionEndpoint}/${detectorId}/results?size=${maxResults}`, {});
      
      // Clean up - stop and delete the detector
      await this.request('POST', `${anomalyDetectionEndpoint}/${detectorId}/_stop`, {});
      await this.request('DELETE', `${anomalyDetectionEndpoint}/${detectorId}`, {});
      
      // Process the results
      const anomalies = [];
      
      if (resultsResponse.anomaly_result && resultsResponse.anomaly_result.anomalies) {
        for (const anomaly of resultsResponse.anomaly_result.anomalies) {
          // Find the corresponding log message
          const matchingBucket = messageBuckets.find((bucket: any) => {
            const timestamp = new Date(anomaly.start_time).getTime();
            const bucketTime = new Date(bucket.key_as_string).getTime();
            return Math.abs(timestamp - bucketTime) < 60000; // Within 1 minute
          });
          
          if (matchingBucket) {
            anomalies.push({
              timestamp: anomaly.start_time,
              message: matchingBucket.key,
              count: matchingBucket.doc_count,
              anomaly_grade: anomaly.anomaly_grade,
              confidence: anomaly.confidence
            });
          }
        }
      }
      
      // Sort anomalies by anomaly grade
      anomalies.sort((a, b) => b.anomaly_grade - a.anomaly_grade);
      
      return {
        anomalies: anomalies.slice(0, maxResults),
        message: anomalies.length > 0 
          ? `Found ${anomalies.length} anomalous log patterns` 
          : "No anomalies detected"
      };
    } catch (error: any) {
      logger.error('[OpenSearch LogsAdapter] Error detecting log anomalies', { error });
      return { 
        anomalies: [], 
        error: error.message || error,
        message: "Failed to detect log anomalies"
      };
    }
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
    logger.info('[OpenSearch LogsAdapter] Finding similar logs', { logMessage, options });
    
    try {
      const indexPattern = 'logs-*';
      const k = options.k || 10;
      const minSimilarity = options.minSimilarity || 0.7;
      
      // First, convert the input log message to a vector using OpenSearch's text embedding
      const textEmbeddingEndpoint = '/_plugins/_ml/text_embedding';
      const embeddingRequest = {
        text: logMessage,
        model_id: 'huggingface/sentence-transformers/all-MiniLM-L6-v2' // Standard model for text embeddings
      };
      
      const embeddingResponse = await this.request('POST', textEmbeddingEndpoint, embeddingRequest);
      
      if (!embeddingResponse.embedding_vector) {
        return { 
          error: 'Failed to generate embedding vector for log message',
          message: 'Failed to find similar logs'
        };
      }
      
      const queryVector = embeddingResponse.embedding_vector;
      
      // Build the query filters
      const filters: any[] = [];
      
      // Add time range filter if specified
      if (options.startTime && options.endTime) {
        filters.push({
          range: {
            '@timestamp': {
              gte: options.startTime,
              lte: options.endTime
            }
          }
        });
      }
      
      // Add service filter if specified
      if (options.service) {
        filters.push({
          term: {
            'resource.attributes.service.name': options.service
          }
        });
      }
      
      // Add log level filter if specified
      if (options.level) {
        filters.push({
          term: {
            'severity_text': options.level
          }
        });
      }
      
      // Use k-NN query to find similar logs
      const knnQuery = {
        query: {
          bool: {
            must: {
              knn: {
                'message_vector': {
                  vector: queryVector,
                  k: k
                }
              }
            },
            filter: filters
          }
        },
        size: k,
        _source: options.includeVectors ? true : {
          excludes: ['message_vector']
        }
      };
      
      const knnResponse = await this.request('POST', `/${indexPattern}/_search`, knnQuery);
      
      // Process the results
      const similarLogs: any[] = [];
      
      if (knnResponse.hits && knnResponse.hits.hits) {
        for (const hit of knnResponse.hits.hits) {
          const score = hit._score;
          // Convert score to similarity (0-1 range)
          const similarity = Math.max(0, Math.min(1, score));
          
          if (similarity >= minSimilarity) {
            similarLogs.push({
              id: hit._id,
              timestamp: hit._source['@timestamp'],
              message: hit._source.body || hit._source.message || hit._source.log?.message,
              service: hit._source.resource?.attributes?.service?.name,
              level: hit._source.severity_text,
              similarity: similarity,
              vector: options.includeVectors ? hit._source.message_vector : undefined
            });
          }
        }
      }
      
      return {
        query: logMessage,
        queryVector: options.includeVectors ? queryVector : undefined,
        similarLogs,
        count: similarLogs.length,
        message: similarLogs.length > 0 
          ? `Found ${similarLogs.length} similar logs` 
          : 'No similar logs found'
      };
    } catch (error) {
      logger.error('[OpenSearch LogsAdapter] Error finding similar logs', { error });
      return { 
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to find similar logs'
      };
    }
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
    logger.info('[OpenSearch LogsAdapter] Clustering log messages', { options });
    
    try {
      const indexPattern = 'logs-*';
      const maxSamples = options.maxSamples || 1000;
      const clusterCount = options.clusterCount || 5;
      const minClusterSize = options.minClusterSize || 3;
      
      // Build the query filters
      const filters: any[] = [
        {
          range: {
            '@timestamp': {
              gte: options.startTime,
              lte: options.endTime
            }
          }
        }
      ];
      
      // Add service filter if specified
      if (options.service) {
        filters.push({
          term: {
            'resource.attributes.service.name': options.service
          }
        });
      }
      
      // Add log level filter if specified
      if (options.level) {
        filters.push({
          term: {
            'severity_text': options.level
          }
        });
      }
      
      // First, get log messages for the specified time range
      const logsQuery = {
        query: {
          bool: {
            filter: filters
          }
        },
        size: maxSamples,
        _source: {
          includes: ['@timestamp', 'body', 'message', 'log.message', 'resource.attributes.service.name', 'severity_text']
        },
        sort: [
          { '@timestamp': { order: 'desc' } }
        ]
      };
      
      const logsResponse = await this.request('POST', `/${indexPattern}/_search`, logsQuery);
      
      if (!logsResponse.hits || !logsResponse.hits.hits || logsResponse.hits.hits.length === 0) {
        return { 
          clusters: [], 
          message: 'No log messages found for the specified criteria'
        };
      }
      
      const logMessages: any[] = [];
      
      // Extract log messages and prepare for embedding
      for (const hit of logsResponse.hits.hits) {
        const message = hit._source.body || hit._source.message || hit._source.log?.message;
        if (message) {
          logMessages.push({
            id: hit._id,
            timestamp: hit._source['@timestamp'],
            message: message,
            service: hit._source.resource?.attributes?.service?.name,
            level: hit._source.severity_text
          });
        }
      }
      
      if (logMessages.length === 0) {
        return { 
          clusters: [], 
          message: 'No valid log messages found for the specified criteria'
        };
      }
      
      // Generate embeddings for all log messages in batch
      const textEmbeddingEndpoint = '/_plugins/_ml/text_embedding';
      const embeddingRequests = logMessages.map(log => ({
        text: log.message,
        model_id: 'huggingface/sentence-transformers/all-MiniLM-L6-v2'
      }));
      
      // Process in batches to avoid overwhelming the API
      const batchSize = 50;
      const logVectors: LogVector[] = [];
      
      for (let i = 0; i < logMessages.length; i += batchSize) {
        const batch = embeddingRequests.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(req => this.request('POST', textEmbeddingEndpoint, req))
        );
        
        for (let j = 0; j < batchResults.length; j++) {
          const result = batchResults[j];
          const logIndex = i + j;
          
          if (result.embedding_vector && logIndex < logMessages.length) {
            logVectors.push({
              ...logMessages[logIndex],
              vector: result.embedding_vector
            });
          }
        }
      }
      
      if (logVectors.length === 0) {
        return { 
          clusters: [], 
          message: 'Failed to generate embeddings for log messages'
        };
      }
      
      // Use k-means clustering to identify patterns
      const kmeansEndpoint = '/_plugins/_ml/kmeans';
      const kmeansRequest = {
        centroids: clusterCount,
        iterations: 25,
        distance_type: 'COSINE',
        data: logVectors.map(log => log.vector)
      };
      
      const kmeansResponse = await this.request('POST', kmeansEndpoint, kmeansRequest);
      
      // Process the clustering results
      const clusters: Record<number, any[]> = {};
      
      if (kmeansResponse.centroids && kmeansResponse.assignments) {
        // Initialize clusters
        for (let i = 0; i < clusterCount; i++) {
          clusters[i] = [];
        }
        
        // Assign logs to clusters
        for (let i = 0; i < kmeansResponse.assignments.length; i++) {
          const clusterIndex = kmeansResponse.assignments[i];
          const centroid = kmeansResponse.centroids[clusterIndex];
          
          // Calculate cosine similarity to centroid
          const similarity = this.cosineSimilarity(logVectors[i].vector, centroid);
          
          clusters[clusterIndex].push({
            ...logVectors[i],
            similarity,
            clusterIndex
          });
        }
      }
      
      // Filter out small clusters and sort logs within clusters by similarity
      const filteredClusters: any[] = [];
      
      for (const [clusterIndex, members] of Object.entries(clusters)) {
        if (members.length >= minClusterSize) {
          // Sort by similarity (descending)
          members.sort((a, b) => b.similarity - a.similarity);
          
          // Extract common terms from the top messages in the cluster
          const topMessages = members.slice(0, Math.min(5, members.length)).map(m => m.message);
          const commonTerms = this.extractCommonTerms(topMessages);
          
          filteredClusters.push({
            clusterIndex: parseInt(clusterIndex),
            size: members.length,
            commonTerms,
            pattern: commonTerms.join(' '),
            members: members.map(m => ({
              id: m.id,
              timestamp: m.timestamp,
              message: m.message,
              service: m.service,
              level: m.level,
              similarity: m.similarity
            }))
          });
        }
      }
      
      // Sort clusters by size (descending)
      filteredClusters.sort((a, b) => b.size - a.size);
      
      return {
        clusters: filteredClusters,
        clusterCount: filteredClusters.length,
        totalLogs: logMessages.length,
        processedLogs: logVectors.length,
        message: filteredClusters.length > 0 
          ? `Found ${filteredClusters.length} log message clusters` 
          : 'No significant log clusters found'
      };
    } catch (error) {
      logger.error('[OpenSearch LogsAdapter] Error clustering log messages', { error });
      return { 
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to cluster log messages'
      };
    }
  }
  
  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);
    
    if (normA === 0 || normB === 0) {
      return 0; // No similarity for zero vectors
    }
    
    return dotProduct / (normA * normB);
  }
  
  /**
   * Extract common terms from a set of messages
   */
  private extractCommonTerms(messages: string[]): string[] {
    if (messages.length === 0) return [];
    
    // Tokenize messages and count term frequencies
    const termFrequency: Record<string, number> = {};
    const documentFrequency: Record<string, number> = {};
    const stopWords = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'about', 'of', 'from']);
    
    for (const message of messages) {
      // Tokenize and clean
      const terms = message.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(term => term.length > 2 && !stopWords.has(term));
      
      // Track unique terms in this document
      const uniqueTerms = new Set<string>();
      
      for (const term of terms) {
        // Update term frequency
        termFrequency[term] = (termFrequency[term] || 0) + 1;
        
        // Update document frequency (only once per document)
        if (!uniqueTerms.has(term)) {
          uniqueTerms.add(term);
          documentFrequency[term] = (documentFrequency[term] || 0) + 1;
        }
      }
    }
    
    // Calculate TF-IDF scores
    const docCount = messages.length;
    const termScores: Array<{term: string, score: number}> = [];
    
    for (const [term, tf] of Object.entries(termFrequency)) {
      const df = documentFrequency[term] || 0;
      if (df > 0) {
        // Only include terms that appear in at least half the messages
        if (df >= docCount * 0.5) {
          const idf = Math.log(docCount / df);
          const tfidf = tf * idf;
          termScores.push({ term, score: tfidf });
        }
      }
    }
    
    // Sort by score (descending) and take top terms
    termScores.sort((a, b) => b.score - a.score);
    return termScores.slice(0, 5).map(item => item.term);
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
    logger.info('[OpenSearch LogsAdapter] Analyzing log sentiment', { logCount: logs.length });
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
    logger.info('[OpenSearch LogsAdapter] Extracting entities from logs', { logCount: logs.length });
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
    logger.info('[OpenSearch LogsAdapter] Classifying logs', { logCount: logs.length, categories });
    return LogNLPAnalysis.classifyLogs(this, logs, categories);
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
    logger.info('[OpenSearch LogsAdapter] Performing time series analysis', { startTime, endTime, options });
    
    try {
      const indexPattern = 'logs-*';
      const interval = options.interval || '5m';
      const analysisType = options.analysisType || 'basic';
      
      // Build the PPL query - a unique feature of OpenSearch
      let pplQuery = `source = ${indexPattern} | where @timestamp >= '${startTime}' and @timestamp <= '${endTime}'`;
      
      // Add service filter if specified
      if (options.service) {
        pplQuery += ` | where resource.attributes.service.name = '${options.service}'`;
      }
      
      // Add additional query string if specified
      if (options.queryString) {
        pplQuery += ` | where ${options.queryString}`;
      }
      
      // Add time series aggregation
      pplQuery += ` | stats count() by span(@timestamp, ${interval})`;
      
      // For trend analysis, add regression
      if (['trend', 'full'].includes(analysisType)) {
        pplQuery += ` | eval trend = linear_regression(count)`;
      }
      
      // For outlier detection, add MAD (Median Absolute Deviation)
      if (['outliers', 'full'].includes(analysisType)) {
        pplQuery += ` | eval median = median(count), mad = mad(count), is_outlier = if(abs(count - median) > 3 * mad, true, false)`;
      }
      
      // Execute the PPL query using OpenSearch's PPL plugin
      const pplEndpoint = "/_plugins/_ppl";
      const pplResponse = await this.request('POST', pplEndpoint, {
        query: pplQuery
      });
      
      // Process the results
      const timeSeriesData = [];
      
      if (pplResponse.datarows) {
        for (const row of pplResponse.datarows) {
          const timestamp = row[0];
          const count = row[1];
          
          const dataPoint: any = {
            timestamp,
            count
          };
          
          // Add trend data if available
          if (['trend', 'full'].includes(analysisType) && row.length > 2) {
            dataPoint.trend = row[2];
          }
          
          // Add outlier data if available
          if (['outliers', 'full'].includes(analysisType) && row.length > 5) {
            dataPoint.median = row[3];
            dataPoint.mad = row[4];
            dataPoint.is_outlier = row[5];
          }
          
          timeSeriesData.push(dataPoint);
        }
      }
      
      // For seasonality analysis, use OpenSearch's ML toolkit
      let seasonalityData = null;
      if (['seasonality', 'full'].includes(analysisType)) {
        const seasonalityEndpoint = "/_plugins/_ml/seasonality";
        const seasonalityResponse = await this.request('POST', seasonalityEndpoint, {
          data: timeSeriesData.map(point => point.count),
          period: 24 // Assuming hourly data with daily seasonality
        });
        
        seasonalityData = seasonalityResponse;
      }
      
      return {
        timeSeriesData,
        seasonalityData,
        metadata: {
          startTime,
          endTime,
          interval,
          analysisType,
          service: options.service,
          queryString: options.queryString
        }
      };
    } catch (error: any) {
      logger.error('[OpenSearch LogsAdapter] Error performing time series analysis', { error });
      return { 
        timeSeriesData: [], 
        error: error.message || error,
        message: "Failed to perform time series analysis"
      };
    }
  }
}
