/**
 * OpenAI-compatible embedding generation utilities
 * This module provides a unified interface for generating embeddings
 * using any OpenAI-compatible API endpoint.
 */

import { logger } from '../../../utils/logger.js';
import { OpenSearchCore } from '../core/core.js';
import { applyImprovedSampling } from './improvedSampling.js';
import { EmbeddingOptions, EmbeddingResult, EmbeddingError } from './embeddings.js';
import axios from 'axios';

/**
 * OpenAI embedding model configuration
 */
export interface OpenAIEmbeddingConfig {
  /** API endpoint URL (e.g. 'https://api.openai.com/v1/embeddings' or custom endpoint) */
  endpoint: string;
  /** API key for authentication */
  apiKey: string;
  /** Model name to use (e.g. 'text-embedding-3-small') */
  model: string;
  /** Organization ID (optional, for OpenAI multi-org accounts) */
  organization?: string;
  /** Maximum tokens per batch (helps avoid rate limits) */
  maxTokensPerBatch?: number;
  /** Maximum concurrent requests (helps avoid rate limits) */
  maxConcurrentRequests?: number;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Generate embeddings using any OpenAI-compatible API
 * 
 * @param client The OpenSearch client (used for logging context only)
 * @param items Array of items to generate embeddings for
 * @param textExtractor Function to extract text from each item
 * @param openAIConfig OpenAI API configuration
 * @param options Embedding options
 * @returns The items with embeddings added
 */
export async function generateOpenAIEmbeddings<T>(
  client: OpenSearchCore,
  items: T[],
  textExtractor: (item: T) => string,
  openAIConfig: OpenAIEmbeddingConfig,
  options: EmbeddingOptions = {}
): Promise<EmbeddingResult<T>[]> {
  // Create context prefix for logging
  const contextPrefix = options.context?.source 
    ? `[${options.context.source}]` 
    : '[OpenAIEmbeddings]';
  
  // Apply default values for OpenAI config
  const config = {
    endpoint: openAIConfig.endpoint,
    apiKey: openAIConfig.apiKey,
    model: openAIConfig.model,
    organization: openAIConfig.organization,
    maxTokensPerBatch: openAIConfig.maxTokensPerBatch || 8192,
    maxConcurrentRequests: openAIConfig.maxConcurrentRequests || 5,
    timeoutMs: openAIConfig.timeoutMs || 30000
  };
  
  // Log detailed information about the embedding generation configuration
  logger.info(`${contextPrefix} Starting OpenAI embedding generation`, {
    endpoint: config.endpoint,
    model: config.model,
    itemsCount: items.length,
    batchSize: options.batchSize || 20,
    samplingEnabled: options.enableSampling,
    samplingPercent: options.samplingPercent,
    maxSamples: options.maxSamples
  });
  
  // Apply improved sampling to the items
  const samplingResult = applyImprovedSampling(items, {
    ...options,
    // Disable pagination for embeddings to get all sampled items at once
    enablePagination: false
  }, contextPrefix);
  
  // Handle the result based on its type
  let sampledItems: T[];
  if (Array.isArray(samplingResult)) {
    sampledItems = samplingResult;
  } else {
    // If we got a paginated result (shouldn't happen with enablePagination: false)
    sampledItems = samplingResult.items;
    logger.info(`${contextPrefix} Received paginated sampling result`, {
      totalItems: samplingResult.totalItems,
      sampledItems: samplingResult.items.length,
      samplingApplied: samplingResult.samplingApplied
    });
  }
  
  // Initialize results array
  const results: EmbeddingResult<T>[] = sampledItems.map(item => ({ 
    item: { ...item, vector: undefined } as T & { vector?: number[] } 
  }));
  
  // Get embedding batch size from options or use default
  const batchSize = options.batchSize || 20; // Default to 20 for OpenAI API
  
  // Extract text from each item with validation
  const textsWithIndices: {index: number, text: string, originalIndex: number}[] = [];
  
  for (let i = 0; i < sampledItems.length; i++) {
    try {
      // Extract text and validate it
      let text: string | null | undefined;
      try {
        const item = sampledItems[i];
        
        // Handle different types of items
        if (typeof item === 'string') {
          // If the item is already a string, use it directly
          text = item;
        } else {
          // Try the standard extraction
          text = textExtractor(item);
        }
      } catch (extractError) {
        logger.warn(`${contextPrefix} Error extracting text from item`, {
          error: extractError instanceof Error ? extractError.message : String(extractError),
          itemIndex: i,
          itemType: typeof sampledItems[i]
        });
        text = null;
      }
      
      // Skip null/empty values
      if (text === null || text === undefined || text === '') {
        logger.warn(`${contextPrefix} Skipping item with null/empty text`, {
          itemIndex: i,
          itemType: typeof sampledItems[i]
        });
        
        // Add error to result
        results[i].error = {
          message: 'No valid text to embed',
          endpoint: config.endpoint,
          modelId: config.model,
          details: { 
            reason: 'empty_or_null_text',
            itemType: typeof sampledItems[i]
          }
        };
        continue;
      }
      
      textsWithIndices.push({
        index: i,
        text: text,
        originalIndex: i
      });
    } catch (error: any) {
      logger.error(`${contextPrefix} Error processing item for embedding`, {
        error: error.message,
        stack: error.stack,
        itemIndex: i
      });
      
      // Add error to result
      results[i].error = {
        message: 'Error processing item for embedding',
        originalError: error.toString(),
        endpoint: config.endpoint,
        modelId: config.model,
        details: {
          itemIndex: i,
          itemType: typeof sampledItems[i]
        }
      };
    }
  }
  
  // Process items in batches to avoid overwhelming the API
  const batches: {index: number, text: string, originalIndex: number}[][] = [];
  for (let i = 0; i < textsWithIndices.length; i += batchSize) {
    batches.push(textsWithIndices.slice(i, Math.min(i + batchSize, textsWithIndices.length)));
  }
  
  // Process batches with concurrency control
  const batchPromises: Promise<void>[] = [];
  const activeBatches = new Set<Promise<void>>();
  
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    
    // Skip if batch is empty
    if (batch.length === 0) {
      continue;
    }
    
    // Declare the batch promise variable first
    let batchPromise: Promise<void>;
    
    // Process this batch asynchronously
    batchPromise = (async () => {
      try {
        // Extract just the texts for the embedding request
        const batchTexts = batch.map(item => item.text);
        
        // Format request for the OpenAI embedding API
        const embeddingRequest = {
          model: config.model,
          input: batchTexts,
          encoding_format: 'float' // Use float format for consistent output
        };
        
        // Log detailed information about the request
        logger.info(`${contextPrefix} OpenAI embedding request batch ${batchIndex + 1}/${batches.length}`, {
          batchSize: batchTexts.length,
          endpoint: config.endpoint,
          model: config.model
        });
        
        // Prepare headers for the request
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        };
        
        // Add organization header if provided
        if (config.organization) {
          headers['OpenAI-Organization'] = config.organization;
        }
        
        // Make the request to the OpenAI-compatible API
        const response = await axios.post(config.endpoint, embeddingRequest, {
          headers,
          timeout: config.timeoutMs
        });
        
        // Process the response
        if (response.data && response.data.data && Array.isArray(response.data.data)) {
          // Standard OpenAI API response format
          for (let i = 0; i < Math.min(response.data.data.length, batch.length); i++) {
            const embedding = response.data.data[i];
            const itemIndex = batch[i].index;
            
            if (embedding && embedding.embedding && Array.isArray(embedding.embedding)) {
              // Standard OpenAI format
              results[itemIndex].item.vector = embedding.embedding;
            } else if (embedding && Array.isArray(embedding)) {
              // Some compatible APIs might return the embedding directly
              results[itemIndex].item.vector = embedding;
            } else {
              // Could not find embedding in expected format
              logger.error(`${contextPrefix} Could not find embedding in response for item ${itemIndex}`, {
                embeddingKeys: embedding ? Object.keys(embedding) : [],
                responseFormat: JSON.stringify(response.data).substring(0, 200)
              });
              
              // Add error to result
              results[itemIndex].error = {
                message: 'Could not find embedding in response',
                endpoint: config.endpoint,
                modelId: config.model,
                details: {
                  itemIndex,
                  responseFormat: embedding ? Object.keys(embedding) : []
                }
              };
            }
          }
        } else {
          // Non-standard response format
          logger.error(`${contextPrefix} Unexpected response format from OpenAI API`, {
            responseKeys: response.data ? Object.keys(response.data) : [],
            responseJson: JSON.stringify(response.data).substring(0, 500)
          });
          
          // Create error object
          const embeddingError: EmbeddingError = {
            message: 'Unexpected response format from OpenAI API',
            endpoint: config.endpoint,
            modelId: config.model,
            details: {
              responseKeys: response.data ? Object.keys(response.data) : []
            }
          };
          
          // Mark each item in the batch with the embedding error
          batch.forEach(item => {
            results[item.index].error = embeddingError;
          });
        }
      } catch (error: any) {
        // Log the error details
        logger.error(`${contextPrefix} Error generating OpenAI embeddings for batch ${batchIndex + 1}/${batches.length}`, {
          error: error.message,
          stack: error.stack,
          endpoint: config.endpoint,
          model: config.model,
          batchSize: batch.length,
          response: error.response ? {
            status: error.response.status,
            statusText: error.response.statusText,
            data: JSON.stringify(error.response.data).substring(0, 500)
          } : 'No response'
        });
        
        // Create error object
        const embeddingError: EmbeddingError = {
          message: error.message || 'Unknown error generating embedding',
          originalError: error.toString(),
          status: error.response?.status,
          endpoint: config.endpoint,
          modelId: config.model,
          details: {
            error: error.message,
            response: error.response ? {
              status: error.response.status,
              statusText: error.response.statusText,
              data: JSON.stringify(error.response.data).substring(0, 500)
            } : 'No response'
          }
        };
        
        // Mark each item in the batch with the embedding error
        batch.forEach(item => {
          results[item.index].error = embeddingError;
        });
      } finally {
        // Remove this promise from the active set when done
        // The batchPromise will be defined at this point
        // @ts-expect-error
        activeBatches.delete(batchPromise);
      }
    })();
    
    // Add to tracking collections
    batchPromises.push(batchPromise);
    activeBatches.add(batchPromise);
    
    // Wait if we've reached the concurrency limit
    if (activeBatches.size >= config.maxConcurrentRequests) {
      // Wait for any batch to complete
      await Promise.race(Array.from(activeBatches));
    }
    
    // Add a small delay between batches to avoid rate limiting
    if (batchIndex < batches.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  // Wait for all batches to complete
  await Promise.all(batchPromises);
  
  return results;
}

/**
 * Generate an embedding for a single item using any OpenAI-compatible API
 * 
 * @param client The OpenSearch client (used for logging context only)
 * @param item Item to generate embedding for
 * @param textExtractor Function to extract text from the item
 * @param openAIConfig OpenAI API configuration
 * @param options Embedding options
 * @returns The item with embedding added
 */
export async function generateOpenAIEmbedding<T>(
  client: OpenSearchCore,
  item: T,
  textExtractor: (item: T) => string,
  openAIConfig: OpenAIEmbeddingConfig,
  options: EmbeddingOptions = {}
): Promise<EmbeddingResult<T>> {
  // Use the batch function with a single item for consistency
  const results = await generateOpenAIEmbeddings(
    client,
    [item],
    textExtractor,
    openAIConfig,
    options
  );
  
  // Return the first (and only) result
  return results[0];
}
