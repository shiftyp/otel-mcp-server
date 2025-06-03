/**
 * Core clustering implementation for trace attributes
 * This module provides functionality for clustering attribute values
 */

import { logger } from '../../../../utils/logger.js';
import { performKMeansClustering } from './algorithm.js';
import { AttributeValueWithEmbedding, ClusterResult } from './types.js';
import { createFallbackClusteringResult } from './fallback.js';
import { TracesAdapterCore } from '../core/adapter.js';

/**
 * Perform clustering with error handling
 * 
 * @param client The OpenSearch client
 * @param attributeKey The attribute key being clustered
 * @param attributeValues The original attribute values
 * @param attributeValuesWithEmbeddings The attribute values with embeddings to cluster
 * @param clusterCount The number of clusters to create
 * @param minClusterSize The minimum size of a cluster
 * @param includeOutliers Whether to include outliers in the results
 * @param enableSampling Whether sampling was enabled
 * @param samplingPercent The sampling percentage used
 * @returns The clustering results
 */
export async function performClusteringWithErrorHandling(
  client: TracesAdapterCore,
  attributeKey: string,
  attributeValues: AttributeValueWithEmbedding[],
  attributeValuesWithEmbeddings: AttributeValueWithEmbedding[],
  clusterCount: number,
  minClusterSize: number,
  includeOutliers: boolean,
  enableSampling: boolean,
  samplingPercent: number
): Promise<ClusterResult[]> {
  try {
    // Check if we have enough values to cluster
    if (attributeValuesWithEmbeddings.length < minClusterSize) {
      logger.warn('[TraceAttributeClustering] Not enough attribute values with valid embeddings for clustering', {
        attributeKey,
        valueCount: attributeValuesWithEmbeddings.length,
        minRequired: minClusterSize
      });
      
      // Return a single cluster with all values
      return [{
        id: 0,
        label: 'All Values',
        values: attributeValuesWithEmbeddings,
        commonTerms: [],
        isOutlier: false
      }];
    }
    
    logger.info('[TraceAttributeClustering] Performing clustering', {
      attributeKey,
      valueCount: attributeValuesWithEmbeddings.length,
      clusterCount,
      minClusterSize,
      includeOutliers
    });
    
    // Perform clustering using the algorithm module
    const clusteringResult = await performKMeansClustering(
      client,
      attributeValuesWithEmbeddings,
      clusterCount,
      minClusterSize,
      includeOutliers
    );
    
    // Validate clustering result
    if (!clusteringResult || !Array.isArray(clusteringResult)) {
      logger.warn('[TraceAttributeClustering] Invalid clustering result', {
        attributeKey,
        result: clusteringResult
      });
      
      // Return a single cluster with all values
      return [{
        id: 0,
        label: 'All Values',
        values: attributeValuesWithEmbeddings,
        commonTerms: [],
        isOutlier: false
      }];
    }
    
    // Assign cluster IDs to attribute values
    attributeValuesWithEmbeddings.forEach((item) => {
      // Find the cluster that contains this value
      const cluster = clusteringResult.find(c => 
        c.values.some(v => v.value === item.value)
      );
      item.clusterId = cluster ? cluster.id : -1; // -1 for outliers
    });
    
    logger.info('[TraceAttributeClustering] Clustering completed successfully', {
      attributeKey,
      clusterCount: clusteringResult.length
    });
    
    // Process clustering results
    const clusters = clusteringResult.map(cluster => {
      // Get the values that belong to this cluster
      const clusterValues = attributeValuesWithEmbeddings.filter((item) => 
        item.clusterId === cluster.id
      );
      
      return {
        id: cluster.id,
        label: `Cluster ${cluster.id + 1}`,
        values: clusterValues,
        commonTerms: cluster.commonTerms || [],
        isOutlier: cluster.isOutlier || false
      };
    });
    
    return clusters;
  } catch (clusteringError) {
    logger.error('[TraceAttributeClustering] Error performing clustering', {
      error: clusteringError instanceof Error ? clusteringError.message : String(clusteringError),
      attributeKey
    });
    
    // Return a single cluster with all values
    return [{
      id: 0,
      label: 'Error',
      values: attributeValuesWithEmbeddings,
      commonTerms: [],
      isOutlier: false
    }];
  }
}
