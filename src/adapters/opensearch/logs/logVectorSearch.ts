import { logger } from '../../../utils/logger.js';
import { LogsAdapterCore } from './logCore.js';

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
 * OpenSearch Logs Vector Search Adapter
 * Provides functionality for vector search and similarity features in OpenTelemetry logs
 * using OpenSearch's k-NN capabilities
 */
export class LogsVectorSearchAdapter extends LogsAdapterCore {
  constructor(options: any) {
    super(options);
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
    logger.info('[OpenSearch LogsVectorSearchAdapter] Finding similar logs', { logMessage, options });
    
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
      
      const embeddingResponse = await this.callRequest('POST', textEmbeddingEndpoint, embeddingRequest);
      
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
      
      const knnResponse = await this.callRequest('POST', `/${indexPattern}/_search`, knnQuery);
      
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
      logger.error('[OpenSearch LogsVectorSearchAdapter] Error finding similar logs', { error });
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
    logger.info('[OpenSearch LogsVectorSearchAdapter] Clustering log messages', { options });
    
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
      
      const logsResponse = await this.callRequest('POST', `/${indexPattern}/_search`, logsQuery);
      
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
      
      // Generate embeddings for each log message
      const textEmbeddingEndpoint = '/_plugins/_ml/text_embedding';
      const logVectors: LogVector[] = [];
      
      // Process in batches to avoid overwhelming the API
      const batchSize = 50;
      
      for (let i = 0; i < logMessages.length; i += batchSize) {
        const batch = logMessages.slice(i, i + batchSize);
        const embeddingRequests = batch.map(log => ({
          text: log.message,
          model_id: 'huggingface/sentence-transformers/all-MiniLM-L6-v2'
        }));
        
        const embeddingResponses = await Promise.all(
          embeddingRequests.map(req => this.callRequest('POST', textEmbeddingEndpoint, req))
        );
        
        for (let j = 0; j < embeddingResponses.length; j++) {
          const response = embeddingResponses[j];
          if (response.embedding_vector) {
            logVectors.push({
              ...batch[j],
              vector: response.embedding_vector
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
      
      // Use OpenSearch's k-means clustering
      const mlEndpoint = '/_plugins/_ml';
      const kmeansRequest = {
        algorithm: 'kmeans',
        parameters: {
          centroids: clusterCount,
          iterations: 25,
          distance_type: 'cosine'
        },
        input_data: {
          feature_vectors: logVectors.map(log => log.vector)
        }
      };
      
      const kmeansResponse = await this.callRequest('POST', `${mlEndpoint}/execute_cluster`, kmeansRequest);
      
      if (!kmeansResponse.cluster_result || !kmeansResponse.cluster_result.cluster_indices) {
        return { 
          clusters: [], 
          message: 'Failed to cluster log messages'
        };
      }
      
      // Process clustering results
      const clusterIndices = kmeansResponse.cluster_result.cluster_indices;
      const clusters: Record<number, any[]> = {};
      
      // Group log messages by cluster
      for (let i = 0; i < clusterIndices.length; i++) {
        const clusterIndex = clusterIndices[i];
        
        if (!clusters[clusterIndex]) {
          clusters[clusterIndex] = [];
        }
        
        clusters[clusterIndex].push(logVectors[i]);
      }
      
      // Format the results
      const clusterResults = Object.entries(clusters)
        .map(([clusterIndex, logs]) => {
          // Only include clusters with enough members
          if (logs.length < minClusterSize) {
            return null;
          }
          
          // Extract common terms for the cluster
          const messages = logs.map(log => log.message);
          const commonTerms = this.extractCommonTerms(messages);
          
          return {
            cluster_id: parseInt(clusterIndex),
            size: logs.length,
            common_terms: commonTerms,
            representative_sample: logs.slice(0, 5).map(log => ({
              id: log.id,
              timestamp: log.timestamp,
              message: log.message,
              service: log.service,
              level: log.level
            }))
          };
        })
        .filter(cluster => cluster !== null)
        .sort((a, b) => b!.size - a!.size);
      
      return {
        clusters: clusterResults,
        total_clusters: clusterResults.length,
        total_messages: logVectors.length,
        message: clusterResults.length > 0 
          ? `Found ${clusterResults.length} log message clusters` 
          : 'No significant log clusters found'
      };
    } catch (error) {
      logger.error('[OpenSearch LogsVectorSearchAdapter] Error clustering log messages', { error });
      return { 
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to cluster log messages'
      };
    }
  }
}
