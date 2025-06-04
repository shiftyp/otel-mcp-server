/**
 * Trace attribute clustering implementation
 * This module provides functionality for clustering trace attributes
 * using OpenSearch's ML capabilities and our centralized ML utilities.
 */

import { logger } from '../../../../utils/logger.js';
import { ConfigLoader } from '../../../../config/index.js';
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
      const config = ConfigLoader.get();
      const telemetryFields = config.telemetry.fields;

      const {
        clusterCount = config.ml.clustering.defaultNumClusters || 5,
        minClusterSize = config.ml.clustering.minClusterSize || 3,
        includeOutliers = true,
        enableSampling = true,
        samplingPercent = 10, // Consider making these configurable too
        maxSamples = 100,    // Consider making these configurable too
        embeddingBatchSize = config.ml.embedding.batchSize || 3,
        // useTextContent and textFields from options seem unused if useTextContentExtraction is hardcoded true
        excludeVectors = false
      } = options;

      // This specific implementation path focuses on text content extraction and clustering
      const useTextContentExtraction = true;

      // Use the configured trace index
      const indexPattern = config.telemetry.indices.traces;

      // Log the configuration for debugging
      logger.info('[TraceAttributeClustering] Configuration', {
        indexPattern,
        useTextContentExtraction,
        startTime,
        endTime,
        samplingPercent,
        maxSamples
        // textFields from options is not used when useTextContentExtraction is true
      });

      // Add debug logging
      logger.debug('[TraceAttributeClustering] Starting clustering with index pattern', {
        indexPattern,
        useTextContent: useTextContentExtraction, // Log what's actually being used
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
        useTextContent: useTextContentExtraction, // Log what's actually being used
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
      const cleanTraceTextContent = (source: any, docTraceId: string): string => {
        const textParts: string[] = [];

        const addPart = (key: string, value: any) => {
          if (value !== undefined && value !== null && String(value).trim() !== '') {
            textParts.push(`${key}:${String(value).trim()}`);
          }
        };

        addPart('traceId', getValueByPath(source, telemetryFields.traceId));
        addPart('spanId', getValueByPath(source, telemetryFields.spanId));
        addPart('service', getValueByPath(source, telemetryFields.service));
        addPart('operation', getValueByPath(source, telemetryFields.spanName));
        // duration is numeric, typically not part of text content for clustering unless binned
        // addPart('duration', getValueByPath(source, telemetryFields.duration)); 
        addPart('status', getValueByPath(source, telemetryFields.status));

        // Attempt to get more specific HTTP fields using common patterns if not directly configured
        // These supplement the configured telemetryFields.status
        const httpMethod = getValueByPath(source, 'Attributes.http.method') || getValueByPath(source, 'http.method');
        addPart('httpMethod', httpMethod);

        const httpTarget = getValueByPath(source, 'Attributes.http.target') || 
                           getValueByPath(source, 'Attributes.url.path') || 
                           getValueByPath(source, 'http.target') || 
                           getValueByPath(source, 'url.path');
        addPart('httpTarget', httpTarget);
        
        // Fallback for HTTP info from log message (if source.message exists and is a log line)
        const message = getValueByPath(source, 'message');
        if (typeof message === 'string') {
          const httpMatch = message.match(/"(GET|POST|PUT|DELETE|PATCH)\s+([^\s"]+)\s+HTTP\/[\d\.]+"\s+(\d+)/);
          if (httpMatch) {
            const [, parsedMethod, parsedPath, parsedStatus] = httpMatch;
            if (!httpMethod) addPart('httpMethod', parsedMethod);
            if (!httpTarget) addPart('httpTarget', parsedPath);
            if (!getValueByPath(source, telemetryFields.status) && parsedStatus) addPart('statusMsg', parsedStatus);
          } else {
            // Optionally include part of the message if it's not an HTTP log and not too long
            // if (message.length < 200) addPart('messageSnippet', message.substring(0,50));
          }
        }

        // Additional service context if available and not captured by telemetryFields.service
        addPart('serviceNamespace', getValueByPath(source, 'Resource.service.namespace'));
        addPart('serviceVersion', getValueByPath(source, 'Resource.service.version'));
        addPart('serviceInstanceId', getValueByPath(source, 'Resource.service.instance.id'));

        // Extract some generic attributes if they exist, being selective to avoid noise
        const generalAttributes = getValueByPath(source, 'Attributes');
        if (typeof generalAttributes === 'object' && generalAttributes !== null) {
          for (const [key, value] of Object.entries(generalAttributes)) {
            // Include only if not already captured and value is simple
            if (!key.startsWith('http.') && !key.startsWith('url.') && !key.startsWith('service.')) {
              if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                if (String(value).length < 100) { // Avoid very long attribute values
                   addPart(`attr_${key.replace(/\./g, '_')}`, value);
                }
              }
            }
          }
        }

        return textParts.filter(p => p !== null && p !== undefined).join(' | ');
      };

      // Build filters for the search query
      const filters = buildTraceFilters(
        startTime,
        endTime,
        telemetryFields, // Pass the configured telemetryFields
        attributeKey,    // Pass the original attributeKey (or undefined if not applicable for text content)
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
              { exists: { field: telemetryFields.traceId } }
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
        useTextContent: useTextContentExtraction, // Explicitly use the determined value
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
      const clusteringResult: {
        clusters: { [key: string]: AttributeValueWithEmbedding[] };
        outliers: AttributeValueWithEmbedding[];
      } | null = await performStreamingClusteringWithErrorHandling(
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
          error: 'Streaming clustering failed',
          message: 'Clustering process did not complete successfully.'
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
