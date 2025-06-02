/**
 * Embedding generation for trace attribute clustering using OpenAI
 * This module provides functionality for generating embeddings for attribute values
 */

import { logger } from '../../../../utils/logger.js';
import { AttributeValueWithEmbedding } from './types.js';
import axios from 'axios';

// OpenAI embedding model to use
const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

/**
 * Interface for OpenAI embedding options
 */
interface OpenAIEmbeddingOptions {
  /** Model ID to use for embedding generation */
  modelId?: string;
  /** Batch size for embedding generation requests */
  batchSize?: number;
  /** Additional context for logging */
  context?: {
    /** Source of the embedding request */
    source: string;
    /** Additional metadata for logging */
    [key: string]: any;
  };
}

/**
 * Generate embeddings using OpenAI API
 * 
 * @param texts Array of text strings to generate embeddings for
 * @param options OpenAI embedding options
 * @returns Array of embedding results
 */
async function generateEmbeddings(
  texts: string[],
  options: OpenAIEmbeddingOptions = {}
): Promise<Array<{ vector?: number[], error?: string }>> {
  // Get the API key from environment variables
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    logger.error('[TraceAttributeClustering] Missing OpenAI API key');
    return texts.map(() => ({
      vector: undefined,
      error: 'Missing OpenAI API key'
    }));
  }
  
  // Get the model ID from options or use default
  const modelId = options.modelId || OPENAI_EMBEDDING_MODEL;
  
  // Get batch size from options or use default
  const batchSize = options.batchSize || 20; // OpenAI can handle larger batches
  
  // Initialize results array
  const results: Array<{ vector?: number[], error?: string }> = [];
  
  try {
    // Process texts in batches
    for (let i = 0; i < texts.length; i += batchSize) {
      const batchTexts = texts.slice(i, Math.min(i + batchSize, texts.length));
      
      logger.info('[TraceAttributeClustering] Generating OpenAI embeddings', {
        batchSize: batchTexts.length,
        batchNumber: Math.floor(i / batchSize) + 1,
        totalBatches: Math.ceil(texts.length / batchSize),
        modelId
      });
      
      try {
        // Call OpenAI API to generate embeddings
        const response = await axios.post(
          'https://api.openai.com/v1/embeddings',
          {
            input: batchTexts,
            model: modelId
          },
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        // Process the response
        if (response.data && response.data.data) {
          // Add each embedding to the results
          for (let j = 0; j < response.data.data.length; j++) {
            const embedding = response.data.data[j];
            results.push({
              vector: embedding.embedding,
              error: undefined
            });
          }
        } else {
          // Handle unexpected response format
          logger.error('[TraceAttributeClustering] Unexpected OpenAI API response format', {
            responseKeys: Object.keys(response.data || {}),
            statusCode: response.status
          });
          
          // Add error results for this batch
          for (let j = 0; j < batchTexts.length; j++) {
            results.push({
              vector: undefined,
              error: 'Unexpected API response format'
            });
          }
        }
      } catch (error) {
        // Log the error
        logger.error('[TraceAttributeClustering] Error calling OpenAI API', {
          error: error instanceof Error ? error.message : String(error),
          batchSize: batchTexts.length,
          batchNumber: Math.floor(i / batchSize) + 1
        });
        
        // Add error results for this batch
        for (let j = 0; j < batchTexts.length; j++) {
          results.push({
            vector: undefined,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
    
    return results;
  } catch (error) {
    logger.error('[TraceAttributeClustering] Error generating embeddings', {
      error: error instanceof Error ? error.message : String(error)
    });
    
    // Return empty results with errors
    return texts.map(() => ({
      vector: undefined,
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}

/**
 * Generate embeddings for attribute values
 * 
 * @param attributeValues The attribute values to generate embeddings for
 * @param embeddingBatchSize The batch size for embedding generation
 * @param embeddingModel Optional embedding model to use
 * @returns The attribute values with embeddings
 */
export async function generateAttributeEmbeddings(
  attributeValues: AttributeValueWithEmbedding[],
  embeddingBatchSize: number = 20, // Increased batch size for OpenAI
  embeddingModel?: string
): Promise<AttributeValueWithEmbedding[]> {
  if (attributeValues.length === 0) {
    logger.info('[TraceAttributeClustering] No attribute values to generate embeddings for');
    return [];
  }

  logger.info('[TraceAttributeClustering] Generating OpenAI embeddings for attribute values', {
    valueCount: attributeValues.length,
    embeddingBatchSize,
    embeddingModel: embeddingModel || OPENAI_EMBEDDING_MODEL
  });

  try {
    // Extract text content for embedding generation
    const texts = attributeValues.map(item => String(item.value));

    // Generate embeddings for the texts using OpenAI
    const embeddingOptions: OpenAIEmbeddingOptions = {
      batchSize: embeddingBatchSize,
      modelId: embeddingModel,
      context: {
        source: 'TraceAttributeClustering'
      }
    };

    const embeddingResults = await generateEmbeddings(texts, embeddingOptions);

    // Combine the original attribute values with their embeddings
    const attributeValuesWithEmbeddings = attributeValues.map((item, index) => {
      const embeddingResult = embeddingResults[index];
      return {
        ...item,
        vector: embeddingResult?.vector,
        embeddingError: embeddingResult?.error
      };
    });

    // Filter out attribute values with missing embeddings
    const validAttributeValues = attributeValuesWithEmbeddings.filter(item => {
      const hasVector = item.vector && item.vector.length > 0;
      if (!hasVector) {
        logger.warn('[TraceAttributeClustering] Attribute value has no embedding', {
          value: item.value,
          error: item.embeddingError
        });
      }
      return hasVector;
    });

    logger.info('[TraceAttributeClustering] Generated embeddings for attribute values', {
      totalValues: attributeValues.length,
      validValues: validAttributeValues.length,
      invalidValues: attributeValues.length - validAttributeValues.length
    });

    return validAttributeValues;
  } catch (error) {
    logger.error('[TraceAttributeClustering] Error generating embeddings', {
      error: error instanceof Error ? error.message : String(error),
      valueCount: attributeValues.length
    });
    throw error;
  }
}

/**
 * Generate embeddings for attribute values in a streaming fashion
 * This version processes attribute values in batches to reduce memory usage
 * 
 * @param attributeValueBatches An async generator that yields batches of attribute values
 * @param embeddingBatchSize The batch size for embedding generation
 * @param embeddingModel Optional embedding model to use
 * @returns An async generator that yields batches of attribute values with embeddings
 */
export async function* generateAttributeEmbeddingsStreaming(
  attributeValueBatches: AsyncGenerator<AttributeValueWithEmbedding[], void, unknown>,
  embeddingBatchSize: number = 20,
  embeddingModel?: string
): AsyncGenerator<AttributeValueWithEmbedding[], void, unknown> {
  let totalProcessed = 0;
  let totalValid = 0;

  logger.info('[TraceAttributeClustering] Starting streaming embedding generation', {
    embeddingBatchSize,
    embeddingModel: embeddingModel || OPENAI_EMBEDDING_MODEL
  });

  try {
    // Process each batch of attribute values as they come in
    for await (const attributeBatch of attributeValueBatches) {
      if (attributeBatch.length === 0) continue;

      totalProcessed += attributeBatch.length;
      
      logger.debug('[TraceAttributeClustering] Processing batch for embedding generation', {
        batchSize: attributeBatch.length,
        totalProcessed
      });

      // Extract text content for embedding generation
      const texts = attributeBatch.map(item => String(item.value));

      // Generate embeddings for the texts using OpenAI
      const embeddingOptions: OpenAIEmbeddingOptions = {
        batchSize: embeddingBatchSize,
        modelId: embeddingModel,
        context: {
          source: 'TraceAttributeClustering'
        }
      };

      const embeddingResults = await generateEmbeddings(texts, embeddingOptions);

      // Combine the original attribute values with their embeddings
      const attributeValuesWithEmbeddings = attributeBatch.map((item, index) => {
        const embeddingResult = embeddingResults[index];
        return {
          ...item,
          vector: embeddingResult?.vector,
          embeddingError: embeddingResult?.error
        };
      });

      // Filter out attribute values with missing embeddings
      const validAttributeValues = attributeValuesWithEmbeddings.filter(item => {
        const hasVector = item.vector && item.vector.length > 0;
        if (!hasVector) {
          logger.warn('[TraceAttributeClustering] Attribute value has no embedding', {
            value: item.value,
            error: item.embeddingError
          });
        }
        return hasVector;
      });

      totalValid += validAttributeValues.length;

      logger.debug('[TraceAttributeClustering] Generated embeddings for batch', {
        batchSize: attributeBatch.length,
        validValues: validAttributeValues.length,
        totalProcessed,
        totalValid
      });

      // Yield the valid attribute values with embeddings
      if (validAttributeValues.length > 0) {
        yield validAttributeValues;
      }
    }

    logger.info('[TraceAttributeClustering] Completed streaming embedding generation', {
      totalProcessed,
      totalValid
    });
  } catch (error) {
    logger.error('[TraceAttributeClustering] Error in streaming embedding generation', {
      error: error instanceof Error ? error.message : String(error),
      totalProcessed
    });
    throw error;
  }
}
