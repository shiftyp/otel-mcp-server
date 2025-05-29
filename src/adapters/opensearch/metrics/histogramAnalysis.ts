import { logger } from '../../../utils/logger.js';

/**
 * Helper class for histogram metric analysis using OpenSearch ML capabilities
 */
export class HistogramAnalysis {
  
  /**
   * Analyze histogram distributions using k-means clustering
   * @param histogramData Array of histogram metrics with buckets
   * @param k Number of clusters to identify
   */
  public static async analyzeWithKMeans(
    client: any,
    histogramData: Array<{
      timestamp: string;
      buckets: Array<{
        key: number;
        doc_count: number;
      }>;
    }>,
    k: number = 3
  ): Promise<any> {
    logger.info('[HistogramAnalysis] Analyzing histograms with k-means', { dataPoints: histogramData.length, k });
    
    try {
      // Convert histogram data to feature vectors for k-means
      // For each histogram, create a normalized vector of bucket counts
      const featureVectors: number[][] = [];
      
      // Find all unique bucket keys across all histograms
      const allKeys = new Set<number>();
      for (const histogram of histogramData) {
        for (const bucket of histogram.buckets) {
          allKeys.add(bucket.key);
        }
      }
      
      // Sort keys for consistent vector positions
      const sortedKeys = Array.from(allKeys).sort((a, b) => a - b);
      
      // Create feature vectors
      for (const histogram of histogramData) {
        const vector: number[] = new Array(sortedKeys.length).fill(0);
        
        // Get total count for normalization
        const totalCount = histogram.buckets.reduce((sum, bucket) => sum + bucket.doc_count, 0);
        
        // Fill vector with normalized bucket counts
        for (const bucket of histogram.buckets) {
          const keyIndex = sortedKeys.indexOf(bucket.key);
          if (keyIndex !== -1) {
            vector[keyIndex] = totalCount > 0 ? bucket.doc_count / totalCount : 0;
          }
        }
        
        featureVectors.push(vector);
      }
      
      // Use OpenSearch's k-means algorithm
      const kmeansEndpoint = '/_plugins/_ml/kmeans';
      const kmeansRequest = {
        centroids: k,
        iterations: 25,
        distance_type: 'COSINE',
        data: featureVectors
      };
      
      const kmeansResponse = await client.request('POST', kmeansEndpoint, kmeansRequest);
      
      // Process the results
      const clusters: Record<number, Array<{
        timestamp: string;
        clusterCentroid: number[];
        distance: number;
      }>> = {};
      
      if (kmeansResponse.centroids && kmeansResponse.assignments) {
        // Map assignments back to original data
        for (let i = 0; i < kmeansResponse.assignments.length; i++) {
          const clusterIndex = kmeansResponse.assignments[i];
          const centroid = kmeansResponse.centroids[clusterIndex];
          
          // Calculate cosine distance to centroid
          const distance = this.cosineDistance(featureVectors[i], centroid);
          
          if (!clusters[clusterIndex]) {
            clusters[clusterIndex] = [];
          }
          
          clusters[clusterIndex].push({
            timestamp: histogramData[i].timestamp,
            clusterCentroid: centroid,
            distance
          });
        }
      }
      
      // Find representative histograms for each cluster
      const clusterRepresentatives: Record<number, {
        timestamp: string;
        buckets: Array<{ key: number; doc_count: number }>;
        memberCount: number;
      }> = {};
      
      for (const [clusterIndex, members] of Object.entries(clusters)) {
        // Sort by distance to centroid (ascending)
        members.sort((a, b) => a.distance - b.distance);
        
        // Get the most representative member (closest to centroid)
        if (members.length > 0) {
          const representativeTimestamp = members[0].timestamp;
          const representativeHistogram = histogramData.find(h => h.timestamp === representativeTimestamp);
          
          if (representativeHistogram) {
            clusterRepresentatives[parseInt(clusterIndex)] = {
              timestamp: representativeTimestamp,
              buckets: representativeHistogram.buckets,
              memberCount: members.length
            };
          }
        }
      }
      
      return {
        clusters,
        clusterRepresentatives,
        clusterCount: Object.keys(clusters).length,
        sortedKeys,
        centroids: kmeansResponse.centroids
      };
    } catch (error) {
      logger.error('[HistogramAnalysis] Error analyzing histograms with k-means', { error });
      return { 
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to analyze histograms with k-means'
      };
    }
  }
  
  /**
   * Detect anomalies in histogram metrics using neural network-based approach
   * Uses OpenSearch's neural network capabilities
   */
  public static async detectAnomalies(
    client: any,
    histogramData: Array<{
      timestamp: string;
      buckets: Array<{
        key: number;
        doc_count: number;
      }>;
    }>,
    options: {
      sensitivity?: number;
      minAnomalyScore?: number;
    } = {}
  ): Promise<any> {
    logger.info('[HistogramAnalysis] Detecting anomalies in histograms', { 
      dataPoints: histogramData.length, 
      options 
    });
    
    try {
      const sensitivity = options.sensitivity || 0.5;
      const minAnomalyScore = options.minAnomalyScore || 0.7;
      
      // Convert histogram data to feature vectors for anomaly detection
      // For each histogram, create a normalized vector of bucket counts
      const featureVectors: number[][] = [];
      
      // Find all unique bucket keys across all histograms
      const allKeys = new Set<number>();
      for (const histogram of histogramData) {
        for (const bucket of histogram.buckets) {
          allKeys.add(bucket.key);
        }
      }
      
      // Sort keys for consistent vector positions
      const sortedKeys = Array.from(allKeys).sort((a, b) => a - b);
      
      // Create feature vectors
      for (const histogram of histogramData) {
        const vector: number[] = new Array(sortedKeys.length).fill(0);
        
        // Get total count for normalization
        const totalCount = histogram.buckets.reduce((sum, bucket) => sum + bucket.doc_count, 0);
        
        // Fill vector with normalized bucket counts
        for (const bucket of histogram.buckets) {
          const keyIndex = sortedKeys.indexOf(bucket.key);
          if (keyIndex !== -1) {
            vector[keyIndex] = totalCount > 0 ? bucket.doc_count / totalCount : 0;
          }
        }
        
        featureVectors.push(vector);
      }
      
      // Use OpenSearch's Random Cut Forest for anomaly detection
      // This is a neural network-based approach in OpenSearch
      const rcfEndpoint = '/_plugins/_ml/rcf';
      const rcfRequest = {
        num_trees: 50,
        sample_size: Math.min(256, Math.max(50, Math.floor(featureVectors.length * 0.1))),
        training_data_size: featureVectors.length,
        training_data: featureVectors,
        anomaly_score_threshold: minAnomalyScore
      };
      
      const rcfResponse = await client.request('POST', rcfEndpoint, rcfRequest);
      
      // Process the results
      const anomalies: Array<{
        timestamp: string;
        anomalyScore: number;
        buckets: Array<{ key: number; doc_count: number }>;
      }> = [];
      
      if (rcfResponse.anomaly_results) {
        for (let i = 0; i < rcfResponse.anomaly_results.length; i++) {
          const result = rcfResponse.anomaly_results[i];
          
          if (result.anomaly_score >= minAnomalyScore) {
            anomalies.push({
              timestamp: histogramData[i].timestamp,
              anomalyScore: result.anomaly_score,
              buckets: histogramData[i].buckets
            });
          }
        }
      }
      
      // Sort anomalies by score (descending)
      anomalies.sort((a, b) => b.anomalyScore - a.anomalyScore);
      
      return {
        anomalies,
        anomalyCount: anomalies.length,
        totalHistograms: histogramData.length,
        anomalyPercentage: histogramData.length > 0 
          ? (anomalies.length / histogramData.length) * 100 
          : 0,
        sortedKeys,
        modelInfo: rcfResponse.model_info
      };
    } catch (error) {
      logger.error('[HistogramAnalysis] Error detecting anomalies in histograms', { error });
      return { 
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to detect anomalies in histograms'
      };
    }
  }
  
  /**
   * Calculate cosine distance between two vectors
   */
  private static cosineDistance(a: number[], b: number[]): number {
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
      return 1.0; // Maximum distance for zero vectors
    }
    
    const similarity = dotProduct / (normA * normB);
    // Convert similarity to distance (1 - similarity)
    return 1 - similarity;
  }
}
