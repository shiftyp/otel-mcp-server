/**
 * Embedding generation for trace attribute clustering
 * This module provides functionality for generating embeddings for attribute values
 */

import { logger } from '../../../../utils/logger.js';
import { 
  generateEmbeddings as generateEmbeddingsCore, 
  EmbeddingOptions, 
  EmbeddingResult 
} from '../../ml/embeddings.js';
import { AttributeValueWithEmbedding } from './types.js';

/**
 * Simplified wrapper for generating embeddings for attribute values
 * 
 * @param texts Array of text strings to generate embeddings for
 * @param options Embedding options
 * @returns Array of embedding results
 */
async function generateEmbeddings(
  texts: string[],
  options: EmbeddingOptions = {}
): Promise<Array<{ vector?: number[], error?: string }>> {
  try {
    // Since we don't have access to the OpenSearch client directly in this module,
    // we'll use a simplified approach to generate embeddings
    // In a real implementation, you would use the proper ML pipeline
    
    // Import the text extraction function
    const { extractTextContent } = await import('../../ml/textExtraction.js');
    
    // Create a simple text extractor that just returns the input text
    const textExtractor = (text: string) => text;
    
    // Call the core embedding generation function with a mock client
    // This is a temporary solution until we refactor the embedding generation
    // to not require a client in this context
    const mockClient = {} as any;
    
    // Generate embeddings using the core function
    const results = await generateEmbeddingsCore<string>(
      mockClient,
      texts,
      textExtractor,
      options
    );
    
    // Map the results to a simpler format
    return results.map(result => ({
      vector: result.item.vector,
      error: result.error ? result.error.message : undefined
    }));
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
  embeddingBatchSize: number = 3,
  embeddingModel?: string
): Promise<AttributeValueWithEmbedding[]> {
  if (attributeValues.length === 0) {
    logger.info('[TraceAttributeClustering] No attribute values to generate embeddings for');
    return [];
  }

  logger.info('[TraceAttributeClustering] Generating embeddings for attribute values', {
    valueCount: attributeValues.length,
    embeddingBatchSize,
    embeddingModel: embeddingModel || 'default'
  });

  try {
    // Extract text content for embedding generation
    const texts = attributeValues.map(item => String(item.value));

    // Generate embeddings for the texts
    const embeddingOptions: EmbeddingOptions = {
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
