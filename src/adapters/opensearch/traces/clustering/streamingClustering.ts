/**
 * Streaming clustering implementation for trace attributes
 * This module provides functionality for clustering trace attributes using a streaming approach
 */

import { logger } from '../../../../utils/logger.js';
import { TracesAdapterCore } from '../traceCore.js';
import { AttributeValueWithEmbedding, TraceClusteringResult } from './types.js';
import { createFallbackClusteringResult } from './fallback.js';

/**
 * Streaming k-means clustering implementation
 * This implementation processes embeddings in batches to reduce memory usage
 * 
 * @param attributesWithEmbeddings An async generator that yields batches of attributes with embeddings
 * @param clusterCount Number of clusters to create
 * @param minClusterSize Minimum size of a cluster
 * @param includeOutliers Whether to include outliers in the result
 * @returns Clustering result with clusters and outliers
 */
export async function streamingKMeansClustering(
  attributesWithEmbeddings: AsyncGenerator<AttributeValueWithEmbedding[], void, unknown>,
  clusterCount: number,
  minClusterSize: number,
  includeOutliers: boolean
): Promise<{
  clusters: { [key: string]: AttributeValueWithEmbedding[] };
  outliers: AttributeValueWithEmbedding[];
}> {
  // Initialize centroids and clusters
  const centroids: number[][] = [];
  const clusters: { [key: string]: AttributeValueWithEmbedding[] } = {};
  const allVectors: AttributeValueWithEmbedding[] = [];
  
  // First pass: collect initial vectors for centroid initialization
  // We only need a small number of vectors to initialize centroids
  const initialVectorCount = Math.max(clusterCount * 3, 100);
  let initialVectors: AttributeValueWithEmbedding[] = [];
  
  logger.info('[StreamingClustering] Collecting initial vectors for centroid initialization', {
    targetCount: initialVectorCount
  });
  
  try {
    // Collect initial vectors from the first few batches
    for await (const batch of attributesWithEmbeddings) {
      initialVectors = [...initialVectors, ...batch];
      
      if (initialVectors.length >= initialVectorCount) {
        // We have enough vectors to initialize centroids
        break;
      }
    }
    
    if (initialVectors.length === 0) {
      logger.warn('[StreamingClustering] No vectors available for clustering');
      return { clusters: {}, outliers: [] };
    }
    
    if (initialVectors.length < clusterCount) {
      logger.warn('[StreamingClustering] Not enough vectors for requested cluster count', {
        vectorCount: initialVectors.length,
        requestedClusterCount: clusterCount
      });
      // Adjust cluster count to match available vectors
      clusterCount = Math.max(1, Math.floor(initialVectors.length / 2));
    }
    
    // Initialize centroids using k-means++ initialization
    logger.info('[StreamingClustering] Initializing centroids with k-means++', {
      vectorCount: initialVectors.length,
      clusterCount
    });
    
    // Initialize first centroid randomly
    const firstCentroidIndex = Math.floor(Math.random() * initialVectors.length);
    centroids.push([...initialVectors[firstCentroidIndex].vector!]);
    
    // Initialize remaining centroids using k-means++ method
    for (let i = 1; i < clusterCount; i++) {
      // Calculate squared distances to nearest centroids
      const squaredDistances = initialVectors.map(vector => {
        const nearestDistance = Math.min(...centroids.map(centroid => 
          calculateEuclideanDistanceSquared(vector.vector!, centroid)
        ));
        return nearestDistance;
      });
      
      // Calculate sum of squared distances
      const sumSquaredDistances = squaredDistances.reduce((sum, dist) => sum + dist, 0);
      
      // Choose next centroid with probability proportional to squared distance
      let random = Math.random() * sumSquaredDistances;
      let nextCentroidIndex = 0;
      
      for (let j = 0; j < squaredDistances.length; j++) {
        random -= squaredDistances[j];
        if (random <= 0) {
          nextCentroidIndex = j;
          break;
        }
      }
      
      centroids.push([...initialVectors[nextCentroidIndex].vector!]);
    }
    
    // Initialize clusters
    for (let i = 0; i < clusterCount; i++) {
      clusters[`cluster_${i}`] = [];
    }
    
    // Second pass: process all vectors in batches and assign to clusters
    // Create a new generator to process all vectors
    const allVectorsGenerator = processAllVectors(attributesWithEmbeddings, initialVectors);
    
    logger.info('[StreamingClustering] Processing vectors in batches and assigning to clusters');
    
    // Process vectors in batches
    for await (const batch of allVectorsGenerator) {
      // Process each vector in the batch
      for (const vector of batch) {
        if (!vector.vector || vector.vector.length === 0) continue;
        
        // Find nearest centroid
        let minDistance = Infinity;
        let nearestClusterIndex = 0;
        
        for (let i = 0; i < centroids.length; i++) {
          const distance = calculateEuclideanDistance(vector.vector, centroids[i]);
          if (distance < minDistance) {
            minDistance = distance;
            nearestClusterIndex = i;
          }
        }
        
        // Assign vector to nearest cluster
        const clusterKey = `cluster_${nearestClusterIndex}`;
        clusters[clusterKey].push(vector);
        
        // Store vector for final processing
        allVectors.push(vector);
      }
    }
    
    // Update centroids based on assigned vectors
    for (let i = 0; i < clusterCount; i++) {
      const clusterKey = `cluster_${i}`;
      const clusterVectors = clusters[clusterKey];
      
      if (clusterVectors.length > 0) {
        // Calculate new centroid as mean of all vectors in cluster
        const newCentroid = calculateMeanVector(clusterVectors.map(v => v.vector!));
        centroids[i] = newCentroid;
      }
    }
    
    // Final assignment pass with updated centroids
    // Clear existing clusters
    for (let i = 0; i < clusterCount; i++) {
      clusters[`cluster_${i}`] = [];
    }
    
    // Reassign all vectors to clusters with updated centroids
    for (const vector of allVectors) {
      if (!vector.vector || vector.vector.length === 0) continue;
      
      // Find nearest centroid
      let minDistance = Infinity;
      let nearestClusterIndex = 0;
      
      for (let i = 0; i < centroids.length; i++) {
        const distance = calculateEuclideanDistance(vector.vector, centroids[i]);
        if (distance < minDistance) {
          minDistance = distance;
          nearestClusterIndex = i;
        }
      }
      
      // Assign vector to nearest cluster
      const clusterKey = `cluster_${nearestClusterIndex}`;
      clusters[clusterKey].push(vector);
    }
    
    // Filter out small clusters and collect outliers
    const outliers: AttributeValueWithEmbedding[] = [];
    const validClusters: { [key: string]: AttributeValueWithEmbedding[] } = {};
    
    Object.entries(clusters).forEach(([clusterKey, clusterVectors]) => {
      if (clusterVectors.length < minClusterSize) {
        // This is a small cluster, add its vectors to outliers
        if (includeOutliers) {
          outliers.push(...clusterVectors);
        }
      } else {
        // This is a valid cluster
        validClusters[clusterKey] = clusterVectors;
      }
    });
    
    logger.info('[StreamingClustering] Clustering completed', {
      totalVectors: allVectors.length,
      validClusters: Object.keys(validClusters).length,
      outlierCount: outliers.length
    });
    
    return {
      clusters: validClusters,
      outliers
    };
  } catch (error) {
    logger.error('[StreamingClustering] Error during streaming clustering', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Process all vectors, including the initial vectors used for centroid initialization
 * 
 * @param attributesWithEmbeddings The original generator of attribute batches
 * @param initialVectors The initial vectors already processed
 * @returns A new generator that yields all vectors
 */
async function* processAllVectors(
  attributesWithEmbeddings: AsyncGenerator<AttributeValueWithEmbedding[], void, unknown>,
  initialVectors: AttributeValueWithEmbedding[]
): AsyncGenerator<AttributeValueWithEmbedding[], void, unknown> {
  // First yield the initial vectors
  yield initialVectors;
  
  // Then yield all remaining batches from the original generator
  yield* attributesWithEmbeddings;
}

/**
 * Calculate Euclidean distance between two vectors
 * 
 * @param a First vector
 * @param b Second vector
 * @returns Euclidean distance
 */
function calculateEuclideanDistance(a: number[], b: number[]): number {
  return Math.sqrt(calculateEuclideanDistanceSquared(a, b));
}

/**
 * Calculate squared Euclidean distance between two vectors
 * 
 * @param a First vector
 * @param b Second vector
 * @returns Squared Euclidean distance
 */
function calculateEuclideanDistanceSquared(a: number[], b: number[]): number {
  let sum = 0;
  const length = Math.min(a.length, b.length);
  
  for (let i = 0; i < length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  
  return sum;
}

/**
 * Calculate mean vector from a list of vectors
 * 
 * @param vectors List of vectors
 * @returns Mean vector
 */
function calculateMeanVector(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    return [];
  }
  
  const dimensions = vectors[0].length;
  const mean = new Array(dimensions).fill(0);
  
  for (const vector of vectors) {
    for (let i = 0; i < dimensions; i++) {
      mean[i] += vector[i] / vectors.length;
    }
  }
  
  return mean;
}

/**
 * Perform streaming clustering with error handling
 * 
 * @param client The OpenSearch client
 * @param attributeKey The attribute key being clustered
 * @param attributeValues The attribute values
 * @param attributesWithEmbeddingsGenerator Generator that yields batches of attributes with embeddings
 * @param clusterCount Number of clusters to create
 * @param minClusterSize Minimum size of a cluster
 * @param includeOutliers Whether to include outliers in the result
 * @param enableSampling Whether sampling is enabled
 * @param samplingPercent Sampling percentage
 * @returns Clustering result with clusters and outliers
 */
export async function performStreamingClusteringWithErrorHandling(
  client: TracesAdapterCore,
  attributeKey: string,
  attributeValues: AttributeValueWithEmbedding[],
  attributesWithEmbeddingsGenerator: AsyncGenerator<AttributeValueWithEmbedding[], void, unknown>,
  clusterCount: number,
  minClusterSize: number,
  includeOutliers: boolean,
  enableSampling: boolean,
  samplingPercent: number
): Promise<{
  clusters: { [key: string]: AttributeValueWithEmbedding[] };
  outliers: AttributeValueWithEmbedding[];
}> {
  try {
    // Perform streaming k-means clustering
    return await streamingKMeansClustering(
      attributesWithEmbeddingsGenerator,
      clusterCount,
      minClusterSize,
      includeOutliers
    );
  } catch (error) {
    logger.error('[StreamingClustering] Error during clustering', {
      error: error instanceof Error ? error.message : String(error),
      attributeKey
    });
    
    // Return empty clusters
    return {
      clusters: {},
      outliers: []
    };
  }
}
