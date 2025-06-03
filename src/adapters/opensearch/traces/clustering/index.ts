/**
 * Trace attribute clustering implementation
 * This module provides functionality for clustering trace attributes
 * using OpenSearch's ML capabilities and our centralized ML utilities.
 */

import { logger } from '../../../../utils/logger.js';
import { TracesAdapterCore } from '../core/adapter.js';
import { SearchEngineType } from '../../../base/searchAdapter.js';
import { createSamplingAggregation, SamplingOptions } from '../../ml/sampling.js';
import { buildTraceFilters, getValueByPath } from './utils.js';
import { AttributeValueWithEmbedding, ClusterResult, TraceClusteringResult, TraceClusteringWithSamplingOptions } from './types.js';
import { createFallbackClusteringResult } from './fallback.js';
import { processClusteringResult } from './processor.js';
import { generateAttributeEmbeddings } from './embeddings.js';
import { performClusteringWithErrorHandling } from './clustering.js';

/**
 * Class for clustering trace attributes
 */
export class TraceAttributeClustering {
  /**
   * Cluster trace attributes
   * 
   * @param client The OpenSearch client
   * @param attributeKey The attribute key to cluster
   * @param startTime Start time for the search
   * @param endTime End time for the search
   * @param options Clustering options
   * @returns Clustering result
   */
  public static async clusterTraceAttributes(
    client: TracesAdapterCore,
    attributeKey: string | undefined,
    startTime: string,
    endTime: string,
    options: TraceClusteringWithSamplingOptions = {}
  ): Promise<TraceClusteringResult> {
    logger.info('[TraceAttributeClustering] Using OpenSearch implementation');
    return this.clusterAttributesWithOpenSearch(
      client,
      attributeKey,
      startTime,
      endTime,
      options
    );
  }

  /**
   * Cluster trace attributes using OpenSearch's ML capabilities
   */
  /**
   * Helper function to remove embeddings from clusters
   */
  private static removeEmbeddingsFromClusters(clusters: Record<string, AttributeValueWithEmbedding[]>): Record<string, any[]> {
    return Object.entries(clusters).reduce((acc, [key, values]) => {
      acc[key] = values.map((item) => {
        const { vector, ...rest } = item;
        return rest;
      });
      return acc;
    }, {} as Record<string, any[]>);
  }

  /**
   * Helper function to remove embeddings from outliers
   */
  private static removeEmbeddingsFromOutliers(outliers: AttributeValueWithEmbedding[]): any[] {
    return outliers.map((item) => {
      const { vector, ...rest } = item;
      return rest;
    });
  }

  private static async clusterAttributesWithOpenSearch(
    client: TracesAdapterCore,
    attributeKey: string | undefined,
    startTime: string,
    endTime: string,
    options: TraceClusteringWithSamplingOptions
  ): Promise<TraceClusteringResult> {
    try {
      const {
        clusterCount = 5,
        minClusterSize = 3,
        includeOutliers = true,
        enableSampling = true,
        samplingPercent = 10,
        maxSamples = 100,
        embeddingBatchSize = 3,
        useTextContent = false,
        textFields = [],
        excludeVectors = false
      } = options;

      // Always use text content extraction
      const useTextContentExtraction = true;

      // Use the logs-generic-default index where trace data is stored
      // We know this index contains trace data based on our findLogs query
      const indexPattern = 'logs-generic-default';

      // Log the configuration for debugging
      logger.info('[TraceAttributeClustering] Configuration', {
        indexPattern,
        useTextContentExtraction,
        startTime,
        endTime,
        samplingPercent,
        maxSamples,
        textFields
      }); // Use the logs index where trace data is available

      // Add debug logging
      logger.debug('[TraceAttributeClustering] Starting clustering with index pattern', {
        indexPattern,
        useTextContent,
        attributeKey,
        startTime,
        endTime,
        options
      });

      // Try to get a sample document to understand structure
      try {
        const sampleQuery = {
          size: 1,
          query: {
            match_all: {}
          }
        };

        const sampleResult = await client.request("GET", `/${indexPattern}/_search`, sampleQuery);

        if (sampleResult?.hits?.hits?.length > 0) {
          const sampleDoc = sampleResult.hits.hits[0]._source;
          logger.debug('[TraceAttributeClustering] Sample document structure', {
            sampleDoc,
            docKeys: Object.keys(sampleDoc || {})
          });
        } else {
          logger.debug('[TraceAttributeClustering] No sample documents found');
        }
      } catch (error) {
        logger.warn('[TraceAttributeClustering] Error getting sample document', {
          error: error instanceof Error ? error.message : String(error)
        });
      }

      // Log the retrieval approach
      logger.info('[TraceAttributeClustering] Using memory-efficient streaming approach for trace clustering', {
        attributeKey,
        useTextContent,
        startTime,
        endTime,
        samplingPercent,
        maxSamples,
        excludeVectors
      });

      // Import required utilities
      const { extractTextContent } = await import('../../ml/textExtraction.js');
      const { streamDocuments } = await import('./streamingUtils.js');
      const { performStreamingClusteringWithErrorHandling } = await import('./streamingClustering.js');
      const { generateAttributeEmbeddingsStreaming } = await import('./embeddings.js');

      // Function to clean and format trace data for better clustering
      const cleanTraceTextContent = (source: any, traceId: string): string => {
        // Initialize array to store meaningful text parts
        const textParts: string[] = [];

        // Extract trace ID
        if (source.trace?.id) {
          textParts.push(`trace:${source.trace.id}`);
        }

        // Extract span ID if available
        if (source.span?.id) {
          textParts.push(`span:${source.span.id}`);
        }

        // Extract URL path if available (common in our logs)
        if (source.url?.path) {
          textParts.push(`path:${source.url.path}`);
        }

        // Extract service name if available
        if (source.service?.name) {
          textParts.push(`service:${source.service.name}`);
        }

        // Extract the message field which often contains HTTP info
        if (source.message) {
          // Extract HTTP method, path, and status code from message if possible
          const httpMatch = source.message.match(/"(GET|POST|PUT|DELETE|PATCH)\s+([^\s]+)\s+HTTP\/[\d\.]+"\s+(\d+)/);
          if (httpMatch) {
            const [, method, path, status] = httpMatch;
            textParts.push(`method:${method}`);
            textParts.push(`endpoint:${path}`);
            textParts.push(`status:${status}`);
          } else {
            // If no HTTP pattern found, use the whole message
            textParts.push(source.message);
          }
        }

        // Extract HTTP method and target if available (common in traces)
        if (source.http) {
          const httpObj = source.http;
          const method = httpObj.method || httpObj.Method || '';
          const target = httpObj.target || httpObj.url || httpObj.path || '';
          const statusCode = httpObj.status_code || httpObj.statusCode || '';

          if (method) textParts.push(`method:${method}`);
          if (target) textParts.push(`endpoint:${target}`);
          if (statusCode) textParts.push(`status:${statusCode}`);
        }

        // Extract service information
        if (source.service) {
          const serviceObj = source.service;
          const serviceName = serviceObj.name || serviceObj.Name || '';
          if (serviceName) textParts.push(`service:${serviceName}`);
        }

        // Extract error information if present
        if (source.error || source.exception) {
          const errorObj = source.error || source.exception;
          const errorMsg = errorObj.message || errorObj.Message || 'error';
          textParts.push(`error:${errorMsg}`);
        }

        // Extract key attributes and recursively break down objects into strings
        if (source.attributes || source.Attributes) {
          const attrs = source.attributes || source.Attributes;

          // Recursive function to process nested objects
          const processAttributeValue = (prefix: string, value: any) => {
            if (value === null || value === undefined) {
              return;
            }

            // Skip trace/span IDs
            if (prefix.toLowerCase().includes('id')) {
              return;
            }

            if (typeof value === 'object' && !Array.isArray(value)) {
              // Process nested object by recursively calling with prefixed keys
              Object.entries(value).forEach(([nestedKey, nestedValue]) => {
                processAttributeValue(`${prefix}.${nestedKey}`, nestedValue);
              });
            } else if (Array.isArray(value)) {
              // For arrays, include each element with its index
              value.forEach((item, index) => {
                if (typeof item === 'object' && item !== null) {
                  processAttributeValue(`${prefix}[${index}]`, item);
                } else {
                  textParts.push(`${prefix}[${index}]:${item}`);
                }
              });
            } else {
              // For primitive values, add them directly
              textParts.push(`${prefix}:${value}`);
            }
          };

          // Process each attribute
          Object.entries(attrs).forEach(([key, value]) => {
            processAttributeValue(key, value);
          });
        }

        // Return the cleaned text content
        return textParts.join(' ');
      };

      // Build filters for the search query
      const filters = buildTraceFilters(
        startTime,
        endTime,
        'text_content', // Always use text_content as the attribute key
        options.service,
        options.queryString,
        true // useTextContent
      );

      // Build the search query to retrieve documents directly
      const pageSize = 1000; // Number of documents to retrieve per page
      const searchQuery = {
        size: pageSize,
        query: {
          bool: {
            must: [
              // Ensure we have trace data by requiring trace.id field
              { exists: { field: "trace.id" } }
            ],
            filter: filters
          }
        },
        sort: [
          { "@timestamp": { order: "desc" } } // Sort by timestamp for consistent paging
        ]
      };

      // Log the full query for debugging
      logger.info('[TraceAttributeClustering] Using search query', {
        query: JSON.stringify(searchQuery)
      });

      // Calculate sampling rate from percentage
      const samplingRate = samplingPercent / 100;

      // Set a maximum number of documents to process
      const maxDocsToProcess = 10000;

      // Create streaming document options
      const streamingOptions = {
        indexPattern,
        searchQuery,
        pageSize,
        maxDocsToProcess,
        samplingRate,
        useTextContent,
        attributeKey,
        textExtractor: cleanTraceTextContent,
        attributeExtractor: getValueByPath
      };

      // Create a streaming document generator
      const documentStream = streamDocuments(client, streamingOptions);

      // Create a streaming embedding generator
      const embeddingStream = generateAttributeEmbeddingsStreaming(
        documentStream,
        embeddingBatchSize,
        options.embeddingProviderConfig
      );

      // Track total values for reporting
      let totalValues = 0;
      let validValues = 0;

      // Collect all attribute values with embeddings
      const allAttributeValues: AttributeValueWithEmbedding[] = [];

      // Process the embedding stream and collect values
      logger.info('[TraceAttributeClustering] Starting to process embedding stream');

      try {
        for await (const batch of embeddingStream) {
          logger.info('[TraceAttributeClustering] Received batch of attribute values with embeddings', {
            batchSize: batch.length
          });

          totalValues += batch.length;
          validValues += batch.length;
          allAttributeValues.push(...batch);
        }
      } catch (error) {
        logger.error('[TraceAttributeClustering] Error processing embedding stream', {
          error: error instanceof Error ? error.message : String(error)
        });
      }

      logger.info('[TraceAttributeClustering] Finished processing embedding stream', {
        totalValues,
        validValues,
        collectedValues: allAttributeValues.length
      });

      // Create a stream from the collected values
      const countingStream = async function* () {
        if (allAttributeValues.length > 0) {
          yield allAttributeValues;
        }
      }();

      // If we have no attribute values, return an empty result
      if (totalValues === 0 || allAttributeValues.length === 0) {
        logger.warn('[TraceAttributeClustering] No attribute values found for clustering');
        return {
          attributeKey: attributeKey || 'text_content',
          totalValues: 0,
          clusters: [],
          outliers: [],
          clusterCount: 0,
          minClusterSize: options.minClusterSize || 3,
          clusterSizes: [],
          clusterLabels: [],
          samplingEnabled: !!enableSampling,
          samplingPercent: samplingPercent || 100,
          sampledValues: 0,
          message: 'No attribute values found'
        };
      }

      // Perform streaming clustering with error handling
      const clusteringResult = await performStreamingClusteringWithErrorHandling(
        client,
        attributeKey || 'text_content',
        [], // Empty array as we're using streaming
        countingStream,
        options.clusterCount || clusterCount,
        options.minClusterSize || minClusterSize,
        options.includeOutliers !== undefined ? options.includeOutliers : includeOutliers,
        enableSampling,
        samplingPercent
      );

      // If clustering failed, return a fallback result
      if (!clusteringResult) {
        logger.warn('[TraceAttributeClustering] Streaming clustering failed');
        return {
          attributeKey: attributeKey || 'text_content',
          totalValues: totalValues,
          clusters: [],
          outliers: [],
          clusterCount: 0,
          minClusterSize: options.minClusterSize || 3,
          clusterSizes: [],
          clusterLabels: [],
          samplingEnabled: !!enableSampling,
          samplingPercent: samplingPercent || 100,
          sampledValues: validValues,
          message: 'Clustering failed'
        };
      }

      // Process the clustering result
      const { clusters, outliers } = clusteringResult;

      // Convert the clusters format to match the expected return type
      const formattedClusters: ClusterResult[] = Object.entries(clusters).map(([label, values], index) => ({
        id: index,
        label,
        values: excludeVectors ? TraceAttributeClustering.removeEmbeddingsFromOutliers(values) : values,
        commonTerms: [],  // We'll leave this empty for now
        isOutlier: false
      }));

      // Return the clustering result
      return {
        attributeKey: attributeKey || 'text_content',
        totalValues: totalValues,
        clusters: formattedClusters,
        outliers: excludeVectors ? TraceAttributeClustering.removeEmbeddingsFromOutliers(outliers) : outliers,
        clusterCount: formattedClusters.length,
        minClusterSize: options.minClusterSize || 3,
        clusterSizes: formattedClusters.map(cluster => cluster.values.length),
        clusterLabels: formattedClusters.map(cluster => cluster.label),
        samplingEnabled: !!enableSampling,
        samplingPercent: samplingPercent || 100,
        sampledValues: validValues
      };
    } catch (error) {
      logger.error('[TraceAttributeClustering] Error clustering trace attributes', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        attributeKey
      });

      // Return a fallback result with error information
      return createFallbackClusteringResult({
        attributeKey: attributeKey || 'text_content',
        attributeValues: [],
        enableSampling: options.enableSampling !== undefined ? options.enableSampling : true,
        samplingPercent: options.samplingPercent || 10,
        reason: error instanceof Error ? error.message : String(error),
        error
      });
    }
  }
}
