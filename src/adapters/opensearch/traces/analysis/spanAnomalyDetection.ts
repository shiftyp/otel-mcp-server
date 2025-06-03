import { logger } from '../../../../utils/logger.js';
import { TracesAdapterCore } from '../core/adapter.js';

/**
 * Span Anomaly Detection using OpenSearch's ML capabilities
 * Detects anomalies in span durations and other span metrics
 */
export class SpanAnomalyDetection {
  /**
   * Detect anomalies in span durations using isolation forest
   * @param client The OpenSearch client to use for requests
   * @param service The service name to analyze
   * @param operation The operation name to analyze
   * @param startTime The start time for the analysis window
   * @param endTime The end time for the analysis window
   * @param options Additional options for anomaly detection
   */
  public static async detectSpanDurationAnomalies(
    client: TracesAdapterCore,
    service: string,
    operation: string,
    startTime: string,
    endTime: string,
    options: {
      maxResults?: number;
      contaminationFactor?: number;
      includeAttributes?: boolean;
      includeTraceIds?: boolean;
    } = {}
  ): Promise<any> {
    logger.info('[SpanAnomalyDetection] Detecting span duration anomalies', { 
      service, 
      operation, 
      startTime, 
      endTime, 
      options 
    });
    
    try {
      // Default options
      const maxResults = options.maxResults || 20;
      const contaminationFactor = options.contaminationFactor || 0.05; // 5% of data expected to be anomalous
      const includeAttributes = options.includeAttributes !== undefined ? options.includeAttributes : true;
      const includeTraceIds = options.includeTraceIds !== undefined ? options.includeTraceIds : true;
      
      // First, get span durations for the specified service and operation
      const indexPattern = 'traces-*';
      const spansQuery = {
        query: {
          bool: {
            filter: [
              {
                range: {
                  'start_time': {
                    gte: startTime,
                    lte: endTime
                  }
                }
              },
              {
                term: {
                  'service.name': service
                }
              },
              {
                term: {
                  'name': operation
                }
              }
            ]
          }
        },
        size: 10000, // Get up to 10000 spans
        _source: includeAttributes 
          ? ['span_id', 'trace_id', 'duration', 'start_time', 'attributes'] 
          : ['span_id', 'trace_id', 'duration', 'start_time'],
        sort: [
          { 'start_time': { order: 'asc' } }
        ]
      };
      
      const spansResponse = await client.request('POST', `/${indexPattern}/_search`, spansQuery);
      
      if (!spansResponse.hits || !spansResponse.hits.hits || spansResponse.hits.hits.length === 0) {
        return { 
          anomalies: [], 
          message: `No spans found for service ${service} and operation ${operation} in the specified time range`
        };
      }
      
      const spans = spansResponse.hits.hits.map((hit: any) => hit._source);
      
      // Extract durations for anomaly detection
      const durations = spans.map((span: any) => span.duration || 0);
      
      // Use OpenSearch's ML plugin for anomaly detection with Isolation Forest
      const mlEndpoint = '/_plugins/_ml';
      const isolationForestRequest = {
        algorithm: 'isolation_forest',
        parameters: {
          contamination: contaminationFactor,
          n_estimators: 100,
          max_samples: 'auto',
          max_features: 1.0
        },
        input_data: {
          // Convert to feature vectors (1D for duration)
          feature_vectors: durations.map((duration: number) => [duration])
        }
      };
      
      const isolationForestResponse = await client.request('POST', `${mlEndpoint}/execute_outlier`, isolationForestRequest);
      
      if (!isolationForestResponse.outlier_result || !isolationForestResponse.outlier_result.outlier_scores) {
        return { 
          anomalies: [], 
          error: 'Failed to get anomaly detection results',
          message: 'OpenSearch ML plugin failed to detect anomalies'
        };
      }
      
      // Process the anomaly scores
      const anomalyScores = isolationForestResponse.outlier_result.outlier_scores;
      
      // Identify anomalies (higher score = more anomalous)
      const anomalies = [];
      
      for (let i = 0; i < spans.length; i++) {
        if (i < anomalyScores.length) {
          const span = spans[i];
          const anomalyScore = anomalyScores[i];
          
          // Higher score indicates more anomalous
          if (anomalyScore > 0.5) {
            const anomaly: any = {
              spanId: span.span_id,
              duration: span.duration,
              startTime: span.start_time,
              anomalyScore
            };
            
            if (includeTraceIds) {
              anomaly.traceId = span.trace_id;
            }
            
            if (includeAttributes && span.attributes) {
              anomaly.attributes = span.attributes;
            }
            
            anomalies.push(anomaly);
          }
        }
      }
      
      // Sort anomalies by score (descending)
      anomalies.sort((a: any, b: any) => b.anomalyScore - a.anomalyScore);
      
      // Calculate duration statistics
      const durationStats = {
        min: Math.min(...durations),
        max: Math.max(...durations),
        avg: durations.reduce((sum: number, val: number) => sum + val, 0) / durations.length,
        p50: this.percentile(durations, 50),
        p95: this.percentile(durations, 95),
        p99: this.percentile(durations, 99)
      };
      
      return {
        service,
        operation,
        anomalies: anomalies.slice(0, maxResults),
        durationStats,
        summary: {
          totalSpans: spans.length,
          anomalyCount: anomalies.length,
          anomalyRate: spans.length > 0 ? anomalies.length / spans.length : 0,
          avgAnomalyScore: anomalies.length > 0 
            ? anomalies.reduce((sum: number, anomaly: any) => sum + anomaly.anomalyScore, 0) / anomalies.length 
            : 0,
          avgAnomalyDuration: anomalies.length > 0 
            ? anomalies.reduce((sum: number, anomaly: any) => sum + anomaly.duration, 0) / anomalies.length 
            : 0
        },
        message: `Detected ${anomalies.length} anomalous spans for service ${service} and operation ${operation}`
      };
    } catch (error: any) {
      logger.error('[SpanAnomalyDetection] Error detecting span duration anomalies', { error, service, operation });
      return { 
        anomalies: [], 
        error: error.message || String(error),
        message: `Failed to detect span duration anomalies for service ${service} and operation ${operation}`
      };
    }
  }
  
  /**
   * Detect anomalies in span attribute patterns using DBSCAN clustering
   * @param client The OpenSearch client to use for requests
   * @param service The service name to analyze
   * @param attributeKeys The attribute keys to include in the analysis
   * @param startTime The start time for the analysis window
   * @param endTime The end time for the analysis window
   * @param options Additional options for anomaly detection
   */
  public static async detectSpanAttributeAnomalies(
    client: TracesAdapterCore,
    service: string,
    attributeKeys: string[],
    startTime: string,
    endTime: string,
    options: {
      maxResults?: number;
      eps?: number;
      minPoints?: number;
      includeTraceIds?: boolean;
    } = {}
  ): Promise<any> {
    logger.info('[SpanAnomalyDetection] Detecting span attribute anomalies', { 
      service, 
      attributeKeys, 
      startTime, 
      endTime, 
      options 
    });
    
    try {
      // Default options
      const maxResults = options.maxResults || 20;
      const eps = options.eps || 0.5;
      const minPoints = options.minPoints || 5;
      const includeTraceIds = options.includeTraceIds !== undefined ? options.includeTraceIds : true;
      
      if (!attributeKeys || attributeKeys.length === 0) {
        return { 
          anomalies: [], 
          error: 'No attribute keys specified',
          message: 'Please specify at least one attribute key for analysis'
        };
      }
      
      // First, get spans with the specified attributes for the service
      const indexPattern = 'traces-*';
      const spansQuery = {
        query: {
          bool: {
            filter: [
              {
                range: {
                  'start_time': {
                    gte: startTime,
                    lte: endTime
                  }
                }
              },
              {
                term: {
                  'service.name': service
                }
              }
            ]
          }
        },
        size: 10000, // Get up to 10000 spans
        _source: includeTraceIds 
          ? ['span_id', 'trace_id', 'name', 'duration', 'start_time', 'attributes'] 
          : ['span_id', 'name', 'duration', 'start_time', 'attributes'],
        sort: [
          { 'start_time': { order: 'asc' } }
        ]
      };
      
      const spansResponse = await client.request('POST', `/${indexPattern}/_search`, spansQuery);
      
      if (!spansResponse.hits || !spansResponse.hits.hits || spansResponse.hits.hits.length === 0) {
        return { 
          anomalies: [], 
          message: `No spans found for service ${service} in the specified time range`
        };
      }
      
      const spans = spansResponse.hits.hits.map((hit: any) => hit._source);
      
      // Extract attribute values and convert to feature vectors
      const featureVectors = [];
      const spanIndices = [];
      
      for (let i = 0; i < spans.length; i++) {
        const span = spans[i];
        const attributes = span.attributes || {};
        
        // Check if the span has all the required attributes
        const hasAllAttributes = attributeKeys.every(key => attributes[key] !== undefined);
        
        if (hasAllAttributes) {
          // Extract attribute values and convert to numeric
          const featureVector = attributeKeys.map(key => {
            const value = attributes[key];
            return typeof value === 'number' ? value : 0; // Convert non-numeric to 0
          });
          
          featureVectors.push(featureVector);
          spanIndices.push(i);
        }
      }
      
      if (featureVectors.length === 0) {
        return { 
          anomalies: [], 
          message: `No spans found with all specified attributes for service ${service}`
        };
      }
      
      // Use OpenSearch's ML plugin for anomaly detection with DBSCAN
      const mlEndpoint = '/_plugins/_ml';
      const dbscanRequest = {
        algorithm: 'dbscan',
        parameters: {
          eps,
          min_points: minPoints
        },
        input_data: {
          feature_vectors: featureVectors
        }
      };
      
      const dbscanResponse = await client.request('POST', `${mlEndpoint}/execute_cluster`, dbscanRequest);
      
      if (!dbscanResponse.cluster_result || !dbscanResponse.cluster_result.cluster_indices) {
        return { 
          anomalies: [], 
          error: 'Failed to get clustering results',
          message: 'OpenSearch ML plugin failed to cluster attribute patterns'
        };
      }
      
      // Process the clustering results
      const clusterIndices = dbscanResponse.cluster_result.cluster_indices;
      
      // Identify anomalies (cluster -1 = noise points)
      const anomalies = [];
      
      for (let i = 0; i < clusterIndices.length; i++) {
        if (clusterIndices[i] === -1) {
          const spanIndex = spanIndices[i];
          const span = spans[spanIndex];
          
          const anomaly: any = {
            spanId: span.span_id,
            operation: span.name,
            duration: span.duration,
            startTime: span.start_time,
            attributes: {}
          };
          
          // Include only the analyzed attributes
          for (const key of attributeKeys) {
            if (span.attributes && span.attributes[key] !== undefined) {
              anomaly.attributes[key] = span.attributes[key];
            }
          }
          
          if (includeTraceIds) {
            anomaly.traceId = span.trace_id;
          }
          
          anomalies.push(anomaly);
        }
      }
      
      // Calculate cluster statistics
      const clusterCounts: Record<string, number> = {};
      for (const cluster of clusterIndices) {
        clusterCounts[cluster] = (clusterCounts[cluster] || 0) + 1;
      }
      
      const clusters = Object.entries(clusterCounts)
        .map(([cluster, count]) => ({
          cluster: parseInt(cluster),
          count,
          isAnomaly: cluster === '-1'
        }))
        .sort((a, b) => b.count - a.count);
      
      return {
        service,
        attributeKeys,
        anomalies: anomalies.slice(0, maxResults),
        clusters,
        summary: {
          totalSpans: spans.length,
          analyzedSpans: featureVectors.length,
          clusterCount: clusters.length,
          anomalyCount: anomalies.length,
          anomalyRate: featureVectors.length > 0 ? anomalies.length / featureVectors.length : 0
        },
        message: `Detected ${anomalies.length} anomalous attribute patterns for service ${service}`
      };
    } catch (error: any) {
      logger.error('[SpanAnomalyDetection] Error detecting span attribute anomalies', { error, service, attributeKeys });
      return { 
        anomalies: [], 
        error: error.message || String(error),
        message: `Failed to detect span attribute anomalies for service ${service}`
      };
    }
  }
  
  /**
   * Calculate percentile value from an array of numbers
   * @param values Array of numeric values
   * @param percentile Percentile to calculate (0-100)
   */
  private static percentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    
    // Sort values
    const sorted = [...values].sort((a, b) => a - b);
    
    // Calculate index
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
  }
}
