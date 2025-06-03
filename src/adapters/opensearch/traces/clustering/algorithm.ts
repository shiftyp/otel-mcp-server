/**
 * Clustering algorithms for trace attribute clustering
 * This module provides the actual clustering implementation
 */

import { logger } from '../../../../utils/logger.js';
import { TracesAdapterCore } from '../core/adapter.js';
import { AttributeValueWithEmbedding, ClusterResult } from './types.js';

/**
 * Perform k-means clustering on attribute values with embeddings
 * 
 * @param client The OpenSearch client
 * @param attributeValues Attribute values with embeddings
 * @param clusterCount Number of clusters to create
 * @param minClusterSize Minimum size of a cluster
 * @param includeOutliers Whether to include outliers in the result
 * @returns Array of cluster results
 */
export async function performKMeansClustering(
  client: TracesAdapterCore,
  attributeValues: AttributeValueWithEmbedding[],
  clusterCount: number,
  minClusterSize: number,
  includeOutliers: boolean
): Promise<ClusterResult[]> {
  // Filter out items without embeddings
  const itemsWithEmbeddings = attributeValues.filter(item => item.vector);
  
  // If we don't have enough items to cluster, return them all as a single cluster
  if (itemsWithEmbeddings.length < clusterCount * 2) {
    logger.warn('[TraceAttributeClustering] Not enough items to perform meaningful clustering', {
      itemCount: itemsWithEmbeddings.length,
      clusterCount
    });
    
    return [{
      id: 0,
      label: 'All Values',
      values: itemsWithEmbeddings,
      commonTerms: extractCommonTerms(itemsWithEmbeddings.map(item => item.value)),
      isOutlier: false
    }];
  }
  
  try {
    // Ensure we have valid items with embeddings
    if (!itemsWithEmbeddings || itemsWithEmbeddings.length === 0) {
      logger.warn('[TraceAttributeClustering] No items with embeddings available for clustering');
      return [{
        id: 0,
        label: 'No Embeddings',
        values: attributeValues || [],
        commonTerms: [],
        isOutlier: false
      }];
    }
    
    // Prepare data for k-means clustering
    const vectors = itemsWithEmbeddings.map(item => item.vector!);
    
    // Use OpenSearch's k-means clustering
    const clusteringEndpoint = '/_plugins/_ml/_train/kmeans';
    const clusteringRequest = {
      parameters: {
        centroids: clusterCount,
        iterations: 25,
        distance_type: 'COSINE'
      },
      input_data: {
        vectors
      }
    };
    
    logger.info('[TraceAttributeClustering] Performing k-means clustering', {
      vectorCount: vectors.length,
      clusterCount,
      minClusterSize,
      includeOutliers
    });
    
    const clusteringResponse = await client.request('POST', clusteringEndpoint, clusteringRequest);
    
    if (!clusteringResponse.centroids || !clusteringResponse.cluster_indices) {
      throw new Error('Invalid clustering response from OpenSearch');
    }
    
    // Group items by cluster
    const clusterMap = new Map<number, AttributeValueWithEmbedding[]>();
    
    clusteringResponse.cluster_indices.forEach((clusterIndex: number, itemIndex: number) => {
      if (!clusterMap.has(clusterIndex)) {
        clusterMap.set(clusterIndex, []);
      }
      clusterMap.get(clusterIndex)!.push(itemsWithEmbeddings[itemIndex]);
    });
    
    // Create cluster results
    const clusters: ClusterResult[] = [];
    let outliers: AttributeValueWithEmbedding[] = [];
    
    clusterMap.forEach((items, clusterId) => {
      // Check if this cluster meets the minimum size requirement
      if (items.length >= minClusterSize) {
        // Extract common terms to use as a label
        const commonTerms = extractCommonTerms(items.map(item => item.value));
        const label = commonTerms.length > 0 
          ? commonTerms.slice(0, 3).join(', ')
          : `Cluster ${clusterId + 1}`;
        
        clusters.push({
          id: clusterId,
          label,
          values: items,
          commonTerms,
          isOutlier: false
        });
      } else {
        // Add to outliers
        outliers = outliers.concat(items);
      }
    });
    
    // Add outliers cluster if needed
    if (includeOutliers && outliers.length > 0) {
      clusters.push({
        id: clusters.length,
        label: 'Outliers',
        values: outliers,
        commonTerms: [],
        isOutlier: true
      });
    }
    
    // Sort clusters by size (largest first)
    clusters.sort((a, b) => b.values.length - a.values.length);
    
    return clusters;
  } catch (error: any) {
    logger.error('[TraceAttributeClustering] Error performing clustering', { error });
    
    // Return a single cluster with all items as fallback
    return [{
      id: 0,
      label: 'All Values',
      values: itemsWithEmbeddings,
      commonTerms: extractCommonTerms(itemsWithEmbeddings.map(item => item.value)),
      isOutlier: false
    }];
  }
}

/**
 * Extract common terms from a set of values
 * 
 * @param values Array of string values
 * @returns Array of common terms
 */
export function extractCommonTerms(values: string[] | undefined): string[] {
  // Handle undefined or empty values
  if (!values || values.length === 0) {
    logger.warn('[TraceAttributeClustering] No values provided for extracting common terms');
    return [];
  }
  
  // Tokenize values
  const tokenizedValues = values.map(value => {
    return value
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')  // Replace non-word chars with spaces
      .split(/\s+/)              // Split on whitespace
      .filter(token => token.length > 2);  // Filter out short tokens
  });
  
  // Count token frequencies
  const tokenCounts = new Map<string, number>();
  
  tokenizedValues.forEach(tokens => {
    // Count each token only once per value
    const uniqueTokens = new Set(tokens);
    uniqueTokens.forEach(token => {
      tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
    });
  });
  
  // Find common terms (present in at least 50% of values)
  const threshold = Math.max(2, Math.floor(values.length * 0.5));
  const commonTerms: string[] = [];
  
  tokenCounts.forEach((count, token) => {
    if (count >= threshold) {
      commonTerms.push(token);
    }
  });
  
  // Sort by frequency (most common first)
  return commonTerms.sort((a, b) => 
    (tokenCounts.get(b) || 0) - (tokenCounts.get(a) || 0)
  );
}
