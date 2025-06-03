/**
 * Processor for trace attribute clustering results
 * This module provides functionality for processing clustering results
 */

import { logger } from '../../../../utils/logger.js';
import { 
  AttributeValueWithEmbedding, 
  ClusterResult, 
  TraceClusteringResult 
} from './types.js';

/**
 * Process clustering results to create the final response
 * 
 * @param params Parameters for processing the clustering result
 * @returns The processed clustering result
 */
export function processClusteringResult(params: {
  attributeKey: string;
  attributeValues: AttributeValueWithEmbedding[];
  attributeValuesWithEmbeddings: AttributeValueWithEmbedding[];
  clusters: ClusterResult[];
  excludeVectors: boolean;
  enableSampling: boolean;
  samplingPercent: number;
}): TraceClusteringResult {
  const {
    attributeKey,
    attributeValues,
    attributeValuesWithEmbeddings,
    clusters,
    excludeVectors,
    enableSampling,
    samplingPercent
  } = params;

  // Process each cluster to create the final response
  const processedClusters = clusters.map(cluster => {
    // Get the values for this cluster
    const clusterValues = attributeValuesWithEmbeddings.filter(
      item => item.clusterId === cluster.id
    );
    
    // Sort values by count (descending)
    const sortedValues = [...clusterValues].sort((a, b) => b.count - a.count);
    
    // Process values to include or exclude vectors based on the option
    const processedValues = sortedValues.map(item => ({
      value: item.value,
      count: item.count,
      // Only include vector if excludeVectors is false
      vector: excludeVectors ? undefined : item.vector
    }));
    
    // Create the processed cluster
    return {
      id: cluster.id,
      label: cluster.label,
      values: processedValues,
      commonTerms: cluster.commonTerms || [],
      isOutlier: cluster.isOutlier || false
    };
  });
  
  // Sort clusters by the total count of values (descending)
  const sortedClusters = [...processedClusters].sort((a, b) => {
    const aCount = a.values.reduce((sum, item) => sum + item.count, 0);
    const bCount = b.values.reduce((sum, item) => sum + item.count, 0);
    return bCount - aCount;
  });
  
  // Extract outliers from clusters if any are marked as outliers
  const outliers: AttributeValueWithEmbedding[] = [];
  sortedClusters.forEach(cluster => {
    if (cluster.isOutlier) {
      outliers.push(...cluster.values);
    }
  });

  // Extract cluster sizes and labels for the result
  const clusterSizes = sortedClusters.map(cluster => cluster.values.length);
  const clusterLabels = sortedClusters.map(cluster => cluster.label);

  // Create the final response
  return {
    attributeKey,
    totalValues: attributeValues.length,
    clusters: sortedClusters,
    outliers,
    clusterCount: sortedClusters.length,
    minClusterSize: Math.min(...clusterSizes, Number.MAX_SAFE_INTEGER),
    clusterSizes,
    clusterLabels,
    samplingEnabled: enableSampling,
    samplingPercent,
    sampledValues: attributeValues.length
  };
}
