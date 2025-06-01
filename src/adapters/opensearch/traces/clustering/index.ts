/**
 * Trace attribute clustering implementation
 * This module provides functionality for clustering trace attributes
 * using OpenSearch's ML capabilities and our centralized ML utilities.
 */

import { logger } from '../../../../utils/logger.js';
import { TracesAdapterCore } from '../traceCore.js';
import { SearchEngineType } from '../../../base/searchAdapter.js';
import { createSamplingAggregation, SamplingOptions } from '../../ml/sampling.js';
import { buildTraceFilters, getValueByPath } from './utils.js';
import { AttributeValueWithEmbedding, TraceClusteringResult, TraceClusteringWithSamplingOptions } from './types.js';
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
    // Determine the search engine type
    const engineType = await client.getEngineType();
    
    // Use the appropriate implementation based on the engine type
    if (engineType === SearchEngineType.ELASTICSEARCH) {
      logger.info('[TraceAttributeClustering] Using Elasticsearch implementation');
      // For Elasticsearch, we'll use the OpenSearch implementation as a fallback
      return this.clusterAttributesWithOpenSearch(
        client,
        attributeKey,
        startTime,
        endTime,
        options
      );
    } else {
      logger.info('[TraceAttributeClustering] Using OpenSearch implementation');
      return this.clusterAttributesWithOpenSearch(
        client,
        attributeKey,
        startTime,
        endTime,
        options
      );
    }
  }
  
  /**
   * Cluster trace attributes using OpenSearch's ML capabilities
   */
  private static async clusterAttributesWithOpenSearch(
    client: TracesAdapterCore,
    attributeKey: string | undefined,
    startTime: string,
    endTime: string,
    options: TraceClusteringWithSamplingOptions
  ): Promise<TraceClusteringResult> {
    const {
      service,
      queryString,
      clusterCount = 5,
      minClusterSize = 3,
      includeOutliers = true,
      enableSampling = true,
      samplingPercent = 10,
      maxSamples = 100,
      embeddingBatchSize = 3,
      excludeVectors = false,
      useTextContent = false,
      textFields = []
    } = options;

    try {
      // Determine the index pattern to use
      const indexPattern = 'traces-*'; // Use a more general pattern that covers all trace indices
      
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
        
        const sampleResult = await client.search({
          index: indexPattern,
          body: sampleQuery
        });
        
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
      logger.info('[TraceAttributeClustering] Using streaming approach to retrieve and sample traces', {
        attributeKey,
        useTextContent,
        startTime,
        endTime,
        samplingPercent,
        maxSamples
      });
      
      // Build filters for the search query
      const filters = buildTraceFilters(startTime, endTime, attributeKey, service, queryString, useTextContent);
      
      // Import the text extraction utility
      const { extractTextContent } = await import('../../ml/textExtraction.js');
      
      // Discover trace fields dynamically if possible
      let dynamicTextFields: string[] = [];
      try {
        // Try to get trace fields from the parent adapter
        try {
          // Use a more generic approach to access the parent adapter's methods
          const tracesAdapter = (client as any)._parent || {};
          if (typeof tracesAdapter.getTraceFields === 'function') {
            const fields = await tracesAdapter.getTraceFields();
            // Filter for text and keyword fields that might contain useful text
            dynamicTextFields = fields
              .filter((field: any) => 
                field.type === 'text' || 
                field.type === 'keyword' || 
                (field.type === 'string' && !field.name.endsWith('.raw')))
              .map((field: any) => field.name);
            
            logger.debug('[TraceAttributeClustering] Using dynamically discovered text fields', {
              fieldCount: dynamicTextFields.length,
              fields: dynamicTextFields
            });
          }
        } catch (innerError) {
          logger.warn('[TraceAttributeClustering] Error accessing parent adapter', {
            error: innerError instanceof Error ? innerError.message : String(innerError)
          });
        }
      } catch (error) {
        logger.warn('[TraceAttributeClustering] Error discovering dynamic text fields', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
      
      // Build the search query to retrieve documents directly
      const pageSize = 1000; // Number of documents to retrieve per page
      const searchQuery = {
        size: pageSize,
        query: {
          bool: {
            filter: filters
          }
        },
        sort: [
          { "@timestamp": { order: "desc" } } // Sort by timestamp for consistent paging
        ]
      };
      
      // Initialize arrays to store sampled documents
      let attributeValues: string[] = [];
      let attributeIds: string[] = [];
      
      // Calculate how many documents to sample per page based on sampling percentage
      const samplingRate = samplingPercent / 100;
      const samplesPerPage = Math.max(1, Math.ceil(pageSize * samplingRate));
      
      // Set a maximum number of documents to process
      const maxDocsToProcess = 10000;
      let processedDocs = 0;
      let searchAfter: any = null;
      
      // Function to sample documents from a page
      const sampleFromPage = (docs: any[], count: number): any[] => {
        if (docs.length <= count) return docs;
        
        const sampled: any[] = [];
        const indices = new Set<number>();
        
        while (indices.size < count && indices.size < docs.length) {
          const randomIndex = Math.floor(Math.random() * docs.length);
          if (!indices.has(randomIndex)) {
            indices.add(randomIndex);
            sampled.push(docs[randomIndex]);
          }
        }
        
        return sampled;
      };
      
      // Execute the search query with paging and streaming
      let continueProcessing = true;
      
      try {
        while (continueProcessing && processedDocs < maxDocsToProcess) {
          // Update the search query with search_after if we have it
          const currentQuery = searchAfter ? {
            ...searchQuery,
            search_after: searchAfter
          } : searchQuery;
          
          // Execute the search
          const searchResponse = await client.search({
            index: indexPattern,
            body: currentQuery
          });
          
          // Get the current batch of documents
          const docs = searchResponse.hits?.hits || [];
          processedDocs += docs.length;
          
          // If no more documents, stop processing
          if (docs.length === 0) {
            continueProcessing = false;
            break;
          }
          
          // Sample documents from this page
          const sampledDocs = sampleFromPage(docs, samplesPerPage);
          
          logger.debug('[TraceAttributeClustering] Sampled documents from page', {
            pageSize: docs.length,
            sampledCount: sampledDocs.length,
            totalProcessed: processedDocs
          });
          
          // Process the sampled documents
          if (useTextContent) {
            // For text content clustering, extract text from each sampled document
            for (const doc of sampledDocs) {
              const source = doc._source || {};
              const traceId = source.trace_id || source.TraceId || doc._id || 'unknown';
              
              try {
                // Use provided textFields if available, otherwise use dynamically discovered fields
                const fieldsToUse = textFields?.length > 0 ? textFields : 
                               (dynamicTextFields.length > 0 ? dynamicTextFields : undefined);
                
                const textContent = extractTextContent(source, { textFields: fieldsToUse }) || '';
                
                if (textContent.trim()) {
                  // Store the extracted text with its trace ID
                  attributeValues.push(textContent);
                  attributeIds.push(traceId);
                }
              } catch (error) {
                logger.warn('[TraceAttributeClustering] Error extracting text content', {
                  error: error instanceof Error ? error.message : String(error),
                  traceId
                });
              }
            }
          } else if (attributeKey) {
            // For attribute-based clustering, extract the specific attribute
            for (const doc of sampledDocs) {
              const source = doc._source || {};
              const traceId = source.trace_id || source.TraceId || doc._id || 'unknown';
              
              // Extract the attribute value
              const attrValue = getValueByPath(source, attributeKey);
              
              if (attrValue !== undefined && typeof attrValue === 'string' && attrValue.trim()) {
                attributeValues.push(attrValue);
                attributeIds.push(traceId);
              }
            }
          }
          
          // Update search_after for the next page
          if (docs.length > 0) {
            searchAfter = docs[docs.length - 1].sort;
          } else {
            continueProcessing = false;
          }
          
          // Log progress
          logger.info('[TraceAttributeClustering] Streaming progress', {
            processedDocs,
            attributeValuesCollected: attributeValues.length
          });
          
          // Check if we've collected enough samples
          if (attributeValues.length >= maxSamples) {
            logger.info('[TraceAttributeClustering] Collected enough samples, stopping streaming');
            continueProcessing = false;
          }
        }
      } catch (error) {
        logger.error('[TraceAttributeClustering] Error during streaming document retrieval', {
          error: error instanceof Error ? error.message : String(error),
          processedDocs,
          attributeValuesCollected: attributeValues.length
        });
        // Continue with any data we've collected so far
      }
      
      logger.info('[TraceAttributeClustering] Retrieved attribute values', {
        attributeKey,
        valueCount: attributeValues.length
      });
      
      // If we have no attribute values, return an empty result
      if (attributeValues.length === 0) {
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
      
      // Convert string values to AttributeValueWithEmbedding objects
      const attributeValuesWithCount = attributeValues.map((value: string, index: number) => ({
        value,
        count: 1,
        id: attributeIds[index] || 'unknown'
      }));
      
      // Generate embeddings for the attribute values
      const attributesWithEmbeddings = await generateAttributeEmbeddings(
        attributeValuesWithCount,
        options.embeddingBatchSize || 3,
        options.embeddingProviderConfig
      );
      
      // Ensure all attributes have IDs (should already be set from above)
      
      // If we couldn't generate any valid embeddings, return a fallback result
      if (attributesWithEmbeddings.length === 0) {
        logger.warn('[TraceAttributeClustering] No valid embeddings generated for attribute values');
        return createFallbackClusteringResult({
          attributeKey: attributeKey || 'text_content',
          attributeValues: attributeValuesWithCount,
          enableSampling,
          samplingPercent,
          reason: 'No valid embeddings generated'
        });
      }
      
      // Perform clustering with error handling
      const clusters = await performClusteringWithErrorHandling(
        client,
        attributeKey || 'text_content',
        attributeValuesWithCount,
        attributesWithEmbeddings,
        options.clusterCount || clusterCount,
        options.minClusterSize || minClusterSize,
        options.includeOutliers !== undefined ? options.includeOutliers : includeOutliers,
        enableSampling,
        samplingPercent
      );
      
      // Process the clustering result (sort, exclude vectors if needed)
      const { clusterSizes, clusterLabels, outliers } = processClusteringResult({
        attributeKey: attributeKey || 'text_content',
        attributeValues: attributeValuesWithCount,
        attributeValuesWithEmbeddings: attributesWithEmbeddings,
        clusters,
        enableSampling,
        samplingPercent,
        excludeVectors
      });
      
      // Return the clustering result
      return {
        // Use 'text_content' as the attribute key if we're using text content
        attributeKey: useTextContent ? 'text_content' : attributeKey || 'text_content',
        clusters,
        outliers: includeOutliers ? outliers : [],
        clusterCount: options.clusterCount || clusterCount,
        minClusterSize: options.minClusterSize || minClusterSize,
        totalValues: attributeValues.length,
        clusterSizes,
        clusterLabels,
        // Include vectors if not explicitly excluded
        vectors: excludeVectors ? undefined : attributesWithEmbeddings,
        // Include sampling information
        samplingEnabled: !!enableSampling,
        samplingPercent: samplingPercent || 100,
        sampledValues: attributeValues.length
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
