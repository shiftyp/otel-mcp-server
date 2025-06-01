/**
 * Centralized sampling utilities for OpenSearch
 * This module provides a unified interface for sampling data
 * across different tools and features in the application.
 */

import { logger } from '../../../utils/logger.js';
import { OpenSearchCore } from '../core/core.js';

/**
 * Options for data sampling
 */
export interface SamplingOptions {
  /** Enable sampling to reduce the amount of data processed */
  enableSampling?: boolean;
  /** Percentage of data to sample (1-100) */
  samplingPercent?: number;
  /** Maximum number of samples to process */
  maxSamples?: number;
  /** Use intelligent sampling based on severity/status */
  useIntelligentSampling?: boolean;
  /** Data type for intelligent sampling (logs, traces, metrics) */
  dataType?: 'logs' | 'traces' | 'metrics';
  /** Field name being sampled (used for nested field detection) */
  field?: string;
  /** Additional context for logging */
  context?: {
    /** Source of the sampling request (e.g., 'trace_clustering', 'log_search') */
    source: string;
    /** Additional metadata for logging */
    [key: string]: any;
  };
}

/**
 * Result of sampling operation
 */
export interface SamplingResult<T> {
  /** Sampled items */
  items: T[];
  /** Sampling statistics */
  stats: {
    /** Whether sampling was enabled */
    samplingEnabled: boolean;
    /** Sampling percentage used */
    samplingPercent: number;
    /** Maximum samples limit */
    maxSamples: number;
    /** Actual number of samples returned */
    actualSamples: number;
    /** Estimated total items before sampling */
    estimatedTotal?: number;
  };
}

/**
 * Create a sampling aggregation for the given field
 * 
 * @param field Field to sample
 * @param options Sampling options
 * @returns Sampling aggregation
 */
export function createSamplingAggregation(field: string, options: SamplingOptions): any {
  // Get sampling parameters from options or use defaults
  const enableSampling = options.enableSampling !== undefined ? options.enableSampling : true;
  const samplingPercent = options.samplingPercent || 10;
  const maxSamples = options.maxSamples || 100;
  
  // Calculate shard size based on sampling percent
  const shardSize = Math.max(maxSamples, Math.floor(maxSamples * (100 / samplingPercent)));
  
  // Add context to log messages
  const contextPrefix = options.context?.source ? `[${options.context.source}]` : '[Sampling]';
  
  // If sampling is disabled, return a simple terms aggregation
  if (!enableSampling) {
    logger.info(`${contextPrefix} Sampling disabled, using simple terms aggregation`, {
      field,
      maxSamples
    });
  }
  
  // Check if the field path contains dots and might be a nested field
  const fieldParts = field.split('.');
  const isNestedField = fieldParts.length > 1;
  
  // If it's potentially a nested field, determine the root object and path
  let rootObject = null;
  let nestedPath = null;
  let leafField = field;
  
  if (isNestedField) {
    // Common root objects in trace data
    const possibleRootObjects = ['Attributes', 'Resource', 'Scope'];
    
    // Check if the field starts with one of the known root objects
    for (const root of possibleRootObjects) {
      if (field.startsWith(`${root}.`)) {
        rootObject = root;
        nestedPath = root;
        
        // For nested fields, we need to use the correct field path format
        leafField = field.substring(root.length + 1);
        break;
      }
    }
    
    logger.info(`${contextPrefix} Detected field with dot notation`, {
      field,
      rootObject,
      nestedPath,
      leafField
    });
  }
  
  // Add .keyword suffix to all text fields that don't already have it
  // This is needed for both dot-notated fields and regular text fields
  let aggregationField = field;
  if (!field.endsWith('.keyword')) {
    aggregationField = `${field}.keyword`;
    logger.info(`${contextPrefix} Using keyword field for aggregation`, {
      originalField: field,
      aggregationField
    });
  }
  
  // If sampling is enabled, use the sampler aggregation
  if (options.enableSampling) {
    return {
      sampled_data: {
        sampler: {
          shard_size: shardSize
        },
        aggs: {
          values: {
            terms: {
              field: aggregationField,
              size: maxSamples
            }
          }
        }
      }
    };
  }
  
  // Otherwise, use a simple terms aggregation
  return {
    attribute_values: {
      terms: {
        field: aggregationField,
        size: maxSamples
      }
    }
  };
}

/**
 * Create an intelligent sampling query based on severity/status
 * 
 * This function creates a query that samples data with different rates based on severity/status:
 * - Errors/Critical: 100% sampling
 * - Warnings: 50% sampling
 * - Normal/Info: 1% sampling
 * 
 * @param options Sampling options
 * @returns Query fragment for intelligent sampling
 */
export function createIntelligentSamplingQuery(options: SamplingOptions = {}): any {
  const dataType = options.dataType || 'logs';
  const contextPrefix = options.context?.source 
    ? `[${options.context.source}]` 
    : '[IntelligentSampling]';

  logger.info(`${contextPrefix} Creating intelligent sampling query for ${dataType}`, {
    dataType,
    useIntelligentSampling: options.useIntelligentSampling
  });

  if (!options.useIntelligentSampling) {
    return {}; // Return empty query if intelligent sampling is disabled
  }

  // Define field and values based on data type
  let field: string;
  let errorValues: string[] = [];
  let warningValues: string[] = [];
  let normalValues: string[] = [];

  switch (dataType) {
    case 'logs':
      field = 'level';
      errorValues = ['error', 'critical', 'fatal', 'emergency', 'alert'];
      warningValues = ['warning', 'warn'];
      normalValues = ['info', 'debug', 'trace', 'notice'];
      break;
    case 'traces':
      field = 'status.code';
      errorValues = ['2', 'ERROR', 'error'];
      warningValues = ['1', 'WARNING', 'warning'];
      normalValues = ['0', 'OK', 'ok', 'SUCCESS', 'success'];
      break;
    case 'metrics':
      field = 'status';
      errorValues = ['error', 'critical', 'alert'];
      warningValues = ['warning', 'warn'];
      normalValues = ['ok', 'normal', 'good'];
      break;
    default:
      logger.warn(`${contextPrefix} Unknown data type for intelligent sampling: ${dataType}, using default field`);
      field = 'level';
      errorValues = ['error', 'critical', 'fatal'];
      warningValues = ['warning', 'warn'];
      normalValues = ['info', 'debug', 'trace'];
  }

  // Create a random value script for sampling
  // This ensures consistent sampling across shards and queries
  return {
    function_score: {
      query: {
        bool: {
          should: [
            // 100% of errors
            {
              terms: {
                [field]: errorValues
              }
            },
            // 50% of warnings
            {
              bool: {
                must: [
                  {
                    terms: {
                      [field]: warningValues
                    }
                  },
                  {
                    script: {
                      script: "Math.random() < 0.5" // 50% sampling
                    }
                  }
                ]
              }
            },
            // 1% of normal/info logs
            {
              bool: {
                must: [
                  {
                    terms: {
                      [field]: normalValues
                    }
                  },
                  {
                    script: {
                      script: "Math.random() < 0.01" // 1% sampling
                    }
                  }
                ]
              }
            }
          ]
        }
      }
    }
  };
}

/**
 * Process sampling results from an OpenSearch response
 * 
 * @param response The OpenSearch response containing aggregations
 * @param options Sampling options used in the request
 * @param valueExtractor Function to extract values from buckets
 * @returns Sampling result with items and statistics
 */
export function processSamplingResults<T>(
  response: any,
  options: SamplingOptions = {},
  valueExtractor: (bucket: any) => T = (bucket: any) => bucket.key as unknown as T
): SamplingResult<T> {
  // Get sampling parameters from options or use defaults
  const enableSampling = options.enableSampling !== undefined ? options.enableSampling : true;
  const samplingPercent = options.samplingPercent || 10;
  const maxSamples = options.maxSamples || 100;
  const field = options.field || '';
  
  // Create context prefix for logging
  const contextPrefix = options.context?.source 
    ? `[${options.context.source}]` 
    : '[Sampling]';
  
  // Check if we have aggregations in the response
  const hasAggregations = response && response.aggregations;
  const aggregationKeys = hasAggregations ? Object.keys(response.aggregations) : [];
  
  logger.info(`${contextPrefix} Processing sampling results`, {
    hasAggregations,
    aggregationKeys,
    samplingEnabled: enableSampling
  });
  
  // If we don't have aggregations, return an empty result
  if (!hasAggregations || aggregationKeys.length === 0) {
    logger.warn(`${contextPrefix} No aggregations found in response`);
    return {
      items: [],
      stats: {
        samplingEnabled: enableSampling,
        samplingPercent,
        maxSamples,
        actualSamples: 0,
        estimatedTotal: 0
      }
    };
  }
  
  // Get the first aggregation key (usually 'sampled_data' or 'attribute_values')
  const aggKey = aggregationKeys[0];
  const agg = response.aggregations[aggKey];
  
  // Log the structure of the aggregation for debugging
  logger.info(`${contextPrefix} Search response structure`, {
    hasAggregations,
    aggregationKeys,
    sampleAggregation: JSON.stringify(agg).substring(0, 500),
    attributeKey: field
  });
  
  // Check for different possible bucket locations based on whether we're using nested aggregations
  let buckets: any[] = [];
  
  // Log the complete aggregation structure for debugging
  logger.debug(`${contextPrefix} Aggregation structure:`, {
    aggKey,
    aggKeys: agg ? Object.keys(agg) : [],
    aggStructure: JSON.stringify(agg).substring(0, 500)
  });
  
  // First check for standard aggregation structure with sampling
  if (agg.values?.buckets) {
    buckets = agg.values.buckets;
    logger.info(`${contextPrefix} Found ${buckets.length} buckets in ${aggKey}.values`);
  }
  // Check for nested aggregation structure with sampling
  else if (agg.nested_values?.values?.buckets) {
    buckets = agg.nested_values.values.buckets;
    logger.info(`${contextPrefix} Found ${buckets.length} buckets in ${aggKey}.nested_values.values`);
  }
  // Check for direct nested aggregation structure without sampling
  else if (agg.nested_values?.buckets) {
    buckets = agg.nested_values.buckets;
    logger.info(`${contextPrefix} Found ${buckets.length} buckets in ${aggKey}.nested_values`);
  }
  // Check for direct values aggregation without sampling
  else if (agg.attribute_values?.buckets) {
    buckets = agg.attribute_values.buckets;
    logger.info(`${contextPrefix} Found ${buckets.length} buckets in ${aggKey}.attribute_values`);
  }
  // Finally check for direct buckets on the aggregation
  else if (agg.buckets) {
    buckets = agg.buckets;
    logger.info(`${contextPrefix} Found ${buckets.length} buckets directly in ${aggKey}`);
  }
  // Check for terms aggregation structure
  else if (agg.kind_values?.buckets) {
    buckets = agg.kind_values.buckets;
    logger.info(`${contextPrefix} Found ${buckets.length} buckets in ${aggKey}.kind_values`);
  }
  // Check for any property that has a buckets array
  else {
    // Look for any property that contains a buckets array
    for (const key in agg) {
      if (agg[key]?.buckets && Array.isArray(agg[key].buckets)) {
        buckets = agg[key].buckets;
        logger.info(`${contextPrefix} Found ${buckets.length} buckets in ${aggKey}.${key}`);
        break;
      }
    }
  }
  
  // If we still can't find buckets in any of the expected locations, log a warning
  if (buckets.length === 0) {
    // Log detailed aggregation structure for debugging
    logger.warn(`${contextPrefix} No valid buckets found in response`, {
      hasAggregations: !!response.aggregations,
      aggregationKeys: response.aggregations ? Object.keys(response.aggregations) : [],
      samplingEnabled: enableSampling,
      sampledDataKeys: agg ? Object.keys(agg) : [],
      nestedValuesExists: !!agg?.nested_values,
      nestedValuesKeys: agg?.nested_values ? Object.keys(agg.nested_values) : []
    });
    
    // Return empty result
    return {
      items: [],
      stats: {
        samplingEnabled: enableSampling,
        samplingPercent,
        maxSamples,
        actualSamples: 0,
        estimatedTotal: 0
      }
    };
  }
  
  // Extract items from buckets
  const items: T[] = [];
  const actualSamples = buckets.length;
  
  // Log the first bucket structure to understand what we're working with
  if (buckets.length > 0) {
    logger.debug(`${contextPrefix} Sample bucket structure:`, {
      sampleBucket: JSON.stringify(buckets[0]).substring(0, 500),
      bucketKeys: Object.keys(buckets[0])
    });
  }
  
  for (const bucket of buckets) {
    try {
      // Validate bucket before extraction
      if (!bucket || typeof bucket !== 'object') {
        logger.warn(`${contextPrefix} Invalid bucket in results`, {
          bucket: bucket ? typeof bucket : 'null/undefined'
        });
        continue;
      }
      
      // Extract value using the provided extractor function
      const extractedValue = valueExtractor(bucket);
      
      // Add valid values to the results
      if (extractedValue !== undefined && extractedValue !== null) {
        items.push(extractedValue);
      }
    } catch (error) {
      logger.error(`${contextPrefix} Error extracting value from bucket`, {
        error: error instanceof Error ? error.message : String(error),
        bucket: JSON.stringify(bucket).substring(0, 200)
      });
    }
  }
  
  // Log sampling information
  logger.info(`${contextPrefix} Processed data`, {
    itemCount: items.length,
    samplingEnabled: enableSampling,
    samplingPercent,
    maxSamples
  });
  
  // Calculate estimated total based on sampling percentage
  const estimatedTotal = enableSampling 
    ? Math.round(items.length * (100 / samplingPercent))
    : items.length;
  
  return {
    items,
    stats: {
      samplingEnabled: enableSampling,
      samplingPercent,
      maxSamples,
      actualSamples,
      estimatedTotal
    }
  };
}
