/**
 * Fallback result creation for trace attribute clustering
 * This module provides functionality for creating fallback results when clustering fails
 */

import { logger } from '../../../../utils/logger.js';
import { AttributeValueWithEmbedding, TraceClusteringResult } from './types.js';

/**
 * Create a fallback clustering result when clustering cannot be performed
 * 
 * @param params Parameters for creating the fallback result
 * @returns A fallback clustering result
 */
export function createFallbackClusteringResult(params: {
  attributeKey: string;
  attributeValues: AttributeValueWithEmbedding[];
  enableSampling: boolean;
  samplingPercent: number;
  reason: string;
  error?: any;
}): TraceClusteringResult {
  const {
    attributeKey,
    attributeValues,
    enableSampling,
    samplingPercent,
    reason,
    error
  } = params;
  
  // Log the fallback reason
  logger.warn('[TraceAttributeClustering] Using fallback clustering result', {
    reason,
    attributeKey,
    valueCount: attributeValues.length,
    error: error instanceof Error ? error.message : String(error || '')
  });
  
  // Create a fallback result with a single cluster
  return {
    attributeKey,
    totalValues: attributeValues.length,
    clusters: [{
      id: 0,
      label: reason,
      values: attributeValues.map(item => ({
        value: item.value,
        count: item.count,
        vector: undefined
      })),
      commonTerms: [],
      isOutlier: false
    }],
    // Add required properties for TraceClusteringResult
    outliers: [],
    clusterCount: 1,
    minClusterSize: 1,
    clusterSizes: [attributeValues.length],
    clusterLabels: [reason],
    samplingEnabled: enableSampling,
    samplingPercent,
    sampledValues: attributeValues.length,
    error: reason
  };
}
