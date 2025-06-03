/**
 * Centralized embedding generation utilities for OpenSearch
 * This module provides a unified interface for generating embeddings
 * across different tools and features in the application.
 */

import { logger } from '../../../utils/logger.js';
import { inspect } from 'util';
import { OpenSearchCore } from '../core/core.js';
import { applyImprovedSampling } from './improvedSampling.js';
import { extractTextContent } from './textExtraction.js';

/**
 * Options for embedding generation
 */
export interface EmbeddingOptions {
  /** Model ID to use for embedding generation */
  modelId?: string;
  /** Batch size for embedding generation requests */
  batchSize?: number;
  /** Enable sampling to reduce the number of items to embed */
  enableSampling?: boolean;
  /** Percentage of data to sample (1-100) */
  samplingPercent?: number;
  /** Maximum number of samples to process */
  maxSamples?: number;
  /** Specific text fields to include in embedding generation */
  relevantTextFields?: string[];
  /** Specific dimension/attribute fields to include in embedding generation */
  relevantDimensionFields?: string[];
  /** Specific value fields to include in embedding generation */
  relevantValueFields?: string[];
  /** Additional context for logging */
  context?: {
    /** Source of the embedding request (e.g., 'trace_clustering', 'log_search') */
    source: string;
    /** Additional metadata for logging */
    [key: string]: string | number | boolean;
  };
}

/**
 * Result of embedding generation
 */
export interface EmbeddingResult<T> {
  /** The original item with embedding added */
  item: T & { vector?: number[] };
  /** Error information if embedding generation failed */
  error?: EmbeddingError;
}

/**
 * Error information for embedding generation
 */
export interface EmbeddingError {
  /** Error message */
  message: string;
  /** Original error string */
  originalError?: string;
  /** HTTP status code */
  status?: number;
  /** Endpoint used for embedding generation */
  endpoint: string;
  /** Model ID used for embedding generation */
  modelId: string;
  /** Additional error details */
  details?: Record<string, unknown>;
}

/**
 * Generate embeddings for a batch of items
 * 
 * @param client The OpenSearch client
 * @param items Array of items to generate embeddings for
 * @param textExtractor Function to extract text from each item
 * @param options Embedding options
 * @returns The items with embeddings added
 */
export async function generateEmbeddings<T>(
  client: OpenSearchCore,
  items: T[],
  textExtractor: (item: T) => string,
  options: EmbeddingOptions = {}
): Promise<EmbeddingResult<T>[]> {
  // Get the model ID from options, environment, or use default
  const modelId = options.modelId || process.env.EMBEDDINGS_MODEL_ID || 'iUEnH5cBhdg3okuzOF5d';
  const textEmbeddingEndpoint = `/_plugins/_ml/models/${modelId}/_predict`;
  
  // Get embedding batch size from options or use default
  const batchSize = options.batchSize || 3; // Default to 3 as it's proven to work well
  
  // Create context prefix for logging
  const contextPrefix = options.context?.source 
    ? `[${options.context.source}]` 
    : '[Embeddings]';
  
  // Create text extraction options from embedding options
  const textExtractionOptions = {
    textFields: options.relevantTextFields,
    dimensionFields: options.relevantDimensionFields,
    valueFields: options.relevantValueFields,
    useOnlyRelevantFields: options.relevantTextFields !== undefined || 
                           options.relevantDimensionFields !== undefined || 
                           options.relevantValueFields !== undefined
  };
  
  // Create a wrapped text extractor that applies our field selection
  const enhancedTextExtractor = (item: T): string => {
    try {
      // If we have relevant fields defined, use them for extraction
      if (textExtractionOptions.useOnlyRelevantFields) {
        // Extract text using only the relevant fields
        return extractTextContent(item, textExtractionOptions);
      }
      // Otherwise use the provided extractor
      return textExtractor(item);
    } catch (error) {
      logger.warn(`${contextPrefix} Error in enhanced text extraction`, {
        error: error instanceof Error ? error.message : String(error)
      });
      // Fall back to the original extractor
      return textExtractor(item);
    }
  };
  
  // Log detailed information about the embedding generation configuration
  logger.info(`${contextPrefix} Starting embedding generation`, {
    modelId,
    itemsCount: items.length,
    batchSize,
    samplingEnabled: options.enableSampling,
    usingRelevantFields: textExtractionOptions.useOnlyRelevantFields,
    relevantTextFields: options.relevantTextFields,
    relevantDimensionFields: options.relevantDimensionFields,
    relevantValueFields: options.relevantValueFields,
    samplingPercent: options.samplingPercent,
    maxSamples: options.maxSamples
  });
  
  // Import and use the improved sampling module
  const { applyImprovedSampling } = await import('./improvedSampling.js');
  
  // Apply improved sampling to the items
  const samplingResult = applyImprovedSampling(items, {
    ...options,
    // Disable pagination for embeddings to get all sampled items at once
    enablePagination: false
  }, contextPrefix);
  
  // Handle the result based on its type
  if (Array.isArray(samplingResult)) {
    items = samplingResult;
  } else {
    // If we got a paginated result (shouldn't happen with enablePagination: false)
    items = samplingResult.items;
    logger.info(`${contextPrefix} Received paginated sampling result`, {
      totalItems: samplingResult.totalItems,
      sampledItems: samplingResult.items.length,
      samplingApplied: samplingResult.samplingApplied
    });
  }

  // Initialize results array
  const results: EmbeddingResult<T>[] = items.map(item => ({ 
    item: { ...item, vector: undefined } as T & { vector?: number[] } 
  }));
  
  // Process items in batches to avoid overwhelming the API
  for (let i = 0; i < items.length; i += batchSize) {
    const batchItems = items.slice(i, Math.min(i + batchSize, items.length));
    const batchResults = results.slice(i, Math.min(i + batchSize, items.length));
    
    // Extract text from each item in the batch with validation
    const batchTextsWithIndices: {index: number, text: string}[] = [];
    
    for (let j = 0; j < batchItems.length; j++) {
      try {
        // Extract text and validate it
        let text: string | null | undefined;
        try {
          // Add more robust handling for complex objects
          const item = batchItems[j];
          
          // Log the item structure for debugging
          logger.debug(`${contextPrefix} Extracting text from item`, {
            itemType: typeof item,
            itemKeys: typeof item === 'object' && item !== null ? Object.keys(item) : [],
            itemSample: JSON.stringify(item).substring(0, 100)
          });
          
          // Handle different types of items
          if (typeof item === 'string') {
            // If the item is already a string, use it directly
            text = item;
            logger.debug(`${contextPrefix} Item is a string, using directly`, {
              textLength: text.length,
              textSample: text.substring(0, 50)
            });
          } else if (typeof item === 'object' && item !== null && 'value' in item) {
            // If the item has a 'value' property, extract it using the enhanced extractor
            text = enhancedTextExtractor(item);
            logger.debug(`${contextPrefix} Extracted text from item with 'value' property`, {
              textLength: text.length,
              textSample: text.substring(0, 50),
              usingRelevantFields: textExtractionOptions.useOnlyRelevantFields
            });
          } else if (Array.isArray(item)) {
            // If it's an array, log a warning and try to extract from the first element
            logger.warn(`${contextPrefix} Received array instead of single item`, {
              arrayLength: item.length,
              firstItem: item.length > 0 ? JSON.stringify(item[0]).substring(0, 100) : 'empty'
            });
            
            if (item.length > 0) {
              text = enhancedTextExtractor(item[0]);
            } else {
              text = '';
            }
          } else {
            // Try the enhanced extraction
            text = enhancedTextExtractor(item);
            logger.debug(`${contextPrefix} Using enhanced text extractor for item`, {
              textLength: text.length,
              textSample: text.substring(0, 50),
              itemType: typeof item,
              usingRelevantFields: textExtractionOptions.useOnlyRelevantFields
            });
          }
        } catch (extractError) {
          logger.warn(`${contextPrefix} Error extracting text from item`, {
            error: extractError instanceof Error ? extractError.message : String(extractError),
            itemIndex: j,
            item: JSON.stringify(batchItems[j]).substring(0, 200),
            itemType: typeof batchItems[j]
          });
          text = null;
        }
        
        // Skip null/empty values
        if (text === null || text === undefined || text === '') {
          logger.warn(`${contextPrefix} Skipping item with null/empty text`, {
            itemIndex: j,
            itemType: typeof batchItems[j],
            item: JSON.stringify(batchItems[j]).substring(0, 200)
          });
          
          // Add error to result
          batchResults[j].error = {
            message: 'No valid text to embed',
            endpoint: textEmbeddingEndpoint,
            modelId,
            details: { 
              reason: 'empty_or_null_text',
              itemType: typeof batchItems[j]
            }
          };
          continue;
        }
        
        batchTextsWithIndices.push({
          index: j,
          text: text
        });
      } catch (error: any) {
        logger.error(`${contextPrefix} Error processing item for embedding`, {
          error: error.message,
          stack: error.stack,
          itemIndex: j,
          item: JSON.stringify(batchItems[j]).substring(0, 200)
        });
        
        // Add error to result
        batchResults[j].error = {
          message: 'Error processing item for embedding',
          originalError: error.toString(),
          endpoint: textEmbeddingEndpoint,
          modelId,
          details: {
            itemIndex: j,
            itemType: typeof batchItems[j]
          }
        };
      }
    }
    
    // Extract just the texts for the embedding request
    const validTexts = batchTextsWithIndices.map(item => item.text);
    
    // Skip if no valid texts to embed
    if (validTexts.length === 0) {
      logger.warn(`${contextPrefix} No valid texts to embed in batch ${i / batchSize + 1}`);
      continue;
    }
    
    try {
      // Format request for the embedding model
      const embeddingRequest = {
        parameters: {
          input: validTexts
          // Don't override the model, use the one configured in OpenSearch
        }
      };
      
      // Log detailed information about the request
      logger.info(`${contextPrefix} Embedding request`, {
        batchSize: validTexts.length,
        endpoint: textEmbeddingEndpoint,
        modelId,
        requestBody: JSON.stringify(embeddingRequest)
      });
      
      // Make the request to the OpenSearch ML API
      const embeddingResponse = await client.callRequest(
        'POST',
        textEmbeddingEndpoint,
        embeddingRequest
      );
      
      // Log detailed information about the response
      logger.info(`${contextPrefix} Embedding response`, {
        responseType: typeof embeddingResponse,
        responseKeys: embeddingResponse ? Object.keys(embeddingResponse) : [],
        rawResponse: typeof embeddingResponse === 'string' ? 
          embeddingResponse : 
          JSON.stringify(embeddingResponse, null, 2)
      });
      
      // Process the response
      if (embeddingResponse) {
        // Log the full response structure for debugging
        logger.info(`${contextPrefix} Full embedding response`, {
          responseType: typeof embeddingResponse,
          responseKeys: Object.keys(embeddingResponse),
          responseJson: JSON.stringify(embeddingResponse).substring(0, 500) + '...'
        });
        
        // Check for the standard OpenSearch ML inference results format
        if (embeddingResponse.inference_results && embeddingResponse.inference_results.length > 0) {
          // Process each embedding result
          for (let k = 0; k < Math.min(embeddingResponse.inference_results.length, batchTextsWithIndices.length); k++) {
            const embedding = embeddingResponse.inference_results[k];
            const itemIndex = batchTextsWithIndices[k].index;
            
            // Log the full embedding structure for debugging
            logger.info(`${contextPrefix} Embedding structure from inference_results[${k}]`, {
              embeddingKeys: embedding ? Object.keys(embedding) : [],
              embeddingType: embedding ? typeof embedding : 'undefined',
              embeddingJson: embedding ? JSON.stringify(embedding).substring(0, 500) : 'none'
            });
            
            // Check for different response formats
            if (embedding && embedding.output && embedding.output.length > 0) {
              // Log the output structure
              logger.info(`${contextPrefix} Output structure`, {
                outputKeys: embedding.output[0] ? Object.keys(embedding.output[0]) : [],
                outputJson: embedding.output[0] ? JSON.stringify(embedding.output[0]).substring(0, 500) : 'none'
              });
              
              // First check for OpenAI connector model format
              if (embedding.output[0].dataAsMap) {
                logger.info(`${contextPrefix} Found dataAsMap in output`, {
                  dataAsMapKeys: Object.keys(embedding.output[0].dataAsMap),
                  dataAsMapJson: JSON.stringify(embedding.output[0].dataAsMap).substring(0, 500)
                });
                
                // Check for the embedding in various possible locations
                if (embedding.output[0].dataAsMap.data && 
                    embedding.output[0].dataAsMap.data.length > 0) {
                  
                  // Log the data structure
                  logger.info(`${contextPrefix} Found data array in dataAsMap`, {
                    dataLength: embedding.output[0].dataAsMap.data.length,
                    firstDataItem: embedding.output[0].dataAsMap.data[0] ? 
                      JSON.stringify(embedding.output[0].dataAsMap.data[0]).substring(0, 500) : 'none'
                  });
                  
                  // Check if embedding is directly in the data array
                  if (embedding.output[0].dataAsMap.data[0].embedding) {
                    // OpenAI connector model format
                    logger.info(`${contextPrefix} Found embedding in OpenAI connector model format`);
                    batchResults[itemIndex].item.vector = embedding.output[0].dataAsMap.data[0].embedding;
                    continue;
                  }
                  
                  // Check if the data itself is the embedding array
                  if (Array.isArray(embedding.output[0].dataAsMap.data[0]) && 
                      typeof embedding.output[0].dataAsMap.data[0][0] === 'number') {
                    logger.info(`${contextPrefix} Found embedding as direct array in data[0]`);
                    batchResults[itemIndex].item.vector = embedding.output[0].dataAsMap.data[0];
                    continue;
                  }
                }
                
                // Check if embedding is directly in dataAsMap
                if (embedding.output[0].dataAsMap.embedding) {
                  logger.info(`${contextPrefix} Found embedding directly in dataAsMap`);
                  batchResults[itemIndex].item.vector = embedding.output[0].dataAsMap.embedding;
                  continue;
                }
              }
              
              // Original expected format
              if (embedding.output[0].data) {
                logger.info(`${contextPrefix} Found embedding in output[0].data`);
                batchResults[itemIndex].item.vector = embedding.output[0].data;
                continue;
              }
            }
            
            // Try other known formats
            if (embedding && embedding.response && embedding.response.data) {
              // Alternative format with response.data
              logger.info(`${contextPrefix} Found embedding in response.data`);
              batchResults[itemIndex].item.vector = embedding.response.data;
              continue;
            } else if (embedding && embedding.embedding) {
              // Format with direct embedding field
              logger.info(`${contextPrefix} Found embedding in direct embedding field`);
              batchResults[itemIndex].item.vector = embedding.embedding;
              continue;
            } else if (embedding && embedding.data) {
              // Format with direct data field
              logger.info(`${contextPrefix} Found embedding in direct data field`);
              batchResults[itemIndex].item.vector = embedding.data;
              continue;
            } else if (embedding && embedding.Attributes && embedding.Attributes.vector) {
              // Format with Attributes.vector field
              logger.info(`${contextPrefix} Found embedding in Attributes.vector`);
              batchResults[itemIndex].item.vector = embedding.Attributes.vector;
              continue;
            } else if (embedding && embedding.attributes && embedding.attributes.vector) {
              // Format with attributes.vector field (lowercase)
              logger.info(`${contextPrefix} Found embedding in attributes.vector`);
              batchResults[itemIndex].item.vector = embedding.attributes.vector;
              continue;
            }
            
            // If we get here, we couldn't find the embedding in any known format
            logger.error(`${contextPrefix} Could not find embedding in response for item ${itemIndex}`, {
              embeddingKeys: embedding ? Object.keys(embedding) : [],
              embeddingJson: embedding ? JSON.stringify(embedding).substring(0, 500) : 'none'
            });
            
            // Add error to result
            batchResults[itemIndex].error = {
              message: 'Could not find embedding in response',
              endpoint: textEmbeddingEndpoint,
              modelId,
              details: {
                itemIndex,
                responseFormat: embedding ? Object.keys(embedding) : []
              }
            };
          }
        } else {
          // No inference_results found
          logger.error(`${contextPrefix} No inference_results found in response`, {
            responseKeys: Object.keys(embeddingResponse),
            responseJson: JSON.stringify(embeddingResponse).substring(0, 500)
          });
          
          // Create error object
          const embeddingError: EmbeddingError = {
            message: 'No inference_results found in response',
            endpoint: textEmbeddingEndpoint,
            modelId,
            details: {
              responseKeys: Object.keys(embeddingResponse)
            }
          };
          
          // Mark each item in the batch with the embedding error
          batchTextsWithIndices.forEach(item => {
            batchResults[item.index].error = embeddingError;
          });
        }
      } else {
        // Empty response
        logger.error(`${contextPrefix} Empty response from embedding API`, {
          endpoint: textEmbeddingEndpoint,
          modelId
        });
        
        // Create error object
        const embeddingError: EmbeddingError = {
          message: 'Empty response from embedding API',
          endpoint: textEmbeddingEndpoint,
          modelId
        };
        
        // Mark each item in the batch with the embedding error
        batchTextsWithIndices.forEach(item => {
          batchResults[item.index].error = embeddingError;
        });
      }
    } catch (error: any) {
      // Log the error details with sampling information
      logger.error(`${contextPrefix} Error generating embeddings`, {
        error: error.message,
        stack: error.stack,
        endpoint: textEmbeddingEndpoint,
        modelId,
        batchSize: validTexts.length,
        samplingEnabled: options.enableSampling,
        samplingPercent: options.samplingPercent,
        maxSamples: options.maxSamples,
        // Include sample values in the error for debugging
        sampleTexts: validTexts.slice(0, 2).map(text => 
          typeof text === 'string' ? text.substring(0, 50) : String(text).substring(0, 50)
        ),
        openSearchError: error.body ? JSON.stringify(error.body).substring(0, 500) : undefined
      });
      
      // Create error object
      const errorDetails = {
        error: error.message,
        stack: error.stack,
        endpoint: textEmbeddingEndpoint,
        modelId,
        batchSize: validTexts.length,
        samplingEnabled: options.enableSampling,
        samplingPercent: options.samplingPercent,
        maxSamples: options.maxSamples,
        sampleTexts: validTexts.slice(0, 2).map(text => 
          typeof text === 'string' ? text.substring(0, 50) : String(text).substring(0, 50)
        ),
        openSearchError: error.body ? JSON.stringify(error.body).substring(0, 500) : undefined
      };
      
      // Create error object
      const embeddingError: EmbeddingError = {
        message: error.message || 'Unknown error generating embedding',
        originalError: error.toString(),
        status: error.status,
        endpoint: textEmbeddingEndpoint,
        modelId,
        details: errorDetails
      };
      
      // Mark each item in the batch with the embedding error
      batchTextsWithIndices.forEach(item => {
        batchResults[item.index].error = embeddingError;
      });
    }
    
    // Add a small delay between batches to avoid rate limiting
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return results;
}

/**
 * Generate embeddings for a single item
 * 
 * @param client The OpenSearch client
 * @param item Item to generate embedding for
 * @param textExtractor Function to extract text from the item
 * @param options Embedding options
 * @returns The item with embedding added
 */
export async function generateEmbedding<T>(
  client: OpenSearchCore,
  item: T,
  textExtractor: (item: T) => string,
  options: EmbeddingOptions = {}
): Promise<EmbeddingResult<T>> {
  // Use the batch function with a single item for consistency
  const results = await generateEmbeddings(
    client,
    [item],
    textExtractor,
    options
  );
  
  // Return the first (and only) result
  return results[0];
}
