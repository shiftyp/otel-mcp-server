import { logger } from '../../../utils/logger.js';
import { extractTextContent, TextExtractionOptions } from '../ml/textExtraction.js';
import type { SemanticSearchOptions } from './semanticLogSearch.js';
import { generateEmbeddingWithProvider, EmbeddingProviderConfig } from '../ml/embeddingProvider.js';
import { OpenSearchCore } from '../core/core.js';
import { generateOpenAIEmbeddings } from '../ml/openaiEmbeddings.js';

/**
 * Generate embeddings for a query or log message
 * @param text Text to generate embeddings for
 * @param embeddingProvider Embedding provider config or any provider object
 * @param options Additional options
 * @param adapterOptions Optional adapter options with client
 * @returns Vector embedding
 */
export async function generateEmbedding(
  text: string,
  embeddingProvider: EmbeddingProviderConfig | any,
  options: {
    modelId?: string;
    context?: string;
  } = {},
  adapterOptions?: any
): Promise<number[]> {
  if (!text) {
    logger.warn('[SemanticLogEmbedding] Cannot generate embedding: missing text');
    return [];
  }

  if (!embeddingProvider) {
    logger.warn('[SemanticLogEmbedding] Cannot generate embedding: missing provider');
    return [];
  }

  try {
    const startTime = Date.now();
    logger.debug('[SemanticLogEmbedding] Generating embedding for text', { textLength: text.length });
    
    // Check if we have a proper embedding provider config
    if (embeddingProvider.provider === 'openai' && embeddingProvider.openai) {
      // We have a proper EmbeddingProviderConfig
      logger.info('[SemanticLogEmbedding] Using configured embedding provider', {
        provider: embeddingProvider.provider,
        modelId: embeddingProvider.openai.model
      });
      
      // Use the adapter from options if available
      const adapter = adapterOptions?.coreAdapter;
      
      if (!adapter) {
        logger.warn('[SemanticLogEmbedding] No adapter available for embedding generation');
        return [];
      }
      
      logger.debug('[SemanticLogEmbedding] Using OpenAI embedding provider', {
        endpoint: embeddingProvider.openai.endpoint,
        model: embeddingProvider.openai.model,
        adapterType: adapter.constructor.name,
        adapterInfo: JSON.stringify(adapter)
      });
      
      // Generate embedding using OpenAI directly
      try {
        logger.info('[SemanticLogEmbedding] Calling generateOpenAIEmbeddings with params', {
          textLength: text.length,
          openaiConfig: JSON.stringify(embeddingProvider.openai),
          modelId: options.modelId || embeddingProvider.openai.model
        });
        
        const embeddingResults = await generateOpenAIEmbeddings(
          adapter,
          [{ id: 'query', text }],
          (item) => item.text,
          embeddingProvider.openai,
          {
            modelId: options.modelId || embeddingProvider.openai.model,
            context: { source: 'semantic_log_search' }
          }
        );
        
        const embeddingTimeMs = Date.now() - startTime;
        logger.info('[SemanticLogEmbedding] Embedding generation time', { embeddingTimeMs });
        
        logger.info('[SemanticLogEmbedding] Embedding results received', {
          hasResults: !!embeddingResults,
          resultCount: embeddingResults ? embeddingResults.length : 0,
          firstResult: embeddingResults && embeddingResults.length > 0 ? 
            JSON.stringify(embeddingResults[0]) : 'none'
        });
        
        if (embeddingResults && embeddingResults.length > 0 && embeddingResults[0].item.vector) {
          logger.info('[SemanticLogEmbedding] Generated embedding', {
            vectorLength: embeddingResults[0].item.vector.length
          });
          return embeddingResults[0].item.vector;
        } else {
          logger.warn('[SemanticLogEmbedding] No embedding generated from provider');
          return [];
        }
      } catch (embeddingError) {
        logger.error('[SemanticLogEmbedding] Error generating OpenAI embedding', { 
          error: embeddingError,
          stack: embeddingError instanceof Error ? embeddingError.stack : 'No stack trace',
          message: embeddingError instanceof Error ? embeddingError.message : String(embeddingError)
        });
        return [];
      }
    } else {
      // Try to use the provider directly if it has generateEmbeddings method
      logger.debug('[SemanticLogEmbedding] Attempting to use provider directly');
      
      if (typeof embeddingProvider.generateEmbeddings === 'function') {
        try {
          const items = [{
            id: 'query',
            text: text,
            metadata: {
              context: options.context || 'semantic_log_search'
            }
          }];
          
          const embeddings = await embeddingProvider.generateEmbeddings(items, {
            modelId: options.modelId || 'text-embedding-3-small'
          });
          
          const embeddingTimeMs = Date.now() - startTime;
          logger.info('[SemanticLogEmbedding] Embedding generation time', { embeddingTimeMs });
          
          if (embeddings && embeddings.length > 0 && embeddings[0].vector) {
            logger.info('[SemanticLogEmbedding] Generated embedding', {
              vectorLength: embeddings[0].vector.length
            });
            return embeddings[0].vector;
          }
        } catch (directProviderError) {
          logger.error('[SemanticLogEmbedding] Error using provider directly', { error: directProviderError });
        }
      }
      
      logger.warn('[SemanticLogEmbedding] Provider does not have generateEmbeddings method');
      return [];
    }
  } catch (error) {
    logger.error('[SemanticLogEmbedding] Error generating embedding', { error });
    return [];
  }
}

/**
 * Extract text content from a log document
 * @param logDocument Log document source
 * @returns Extracted text content
 */
export function extractLogTextContent(logDocument: Record<string, any>): string {
  // Define text extraction options
  const textExtractionOptions: TextExtractionOptions = {
    textFields: ['message', 'body', 'log.message', 'text_content'],
    dimensionFields: ['attributes', 'resource.attributes', 'labels'],
    valueFields: []
  };
  
  // Extract text content
  return extractTextContent(logDocument, textExtractionOptions);
}

/**
 * Calculate cosine similarity between two vectors
 * @param vec1 First vector
 * @param vec2 Second vector
 * @returns Cosine similarity (0-1 range)
 */
export function calculateCosineSimilarity(vec1: number[], vec2: number[]): number {
  if (!vec1 || !vec2 || vec1.length === 0 || vec2.length === 0 || vec1.length !== vec2.length) {
    return 0;
  }
  
  let dotProduct = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;
  
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    magnitude1 += vec1[i] * vec1[i];
    magnitude2 += vec2[i] * vec2[i];
  }
  
  magnitude1 = Math.sqrt(magnitude1);
  magnitude2 = Math.sqrt(magnitude2);
  
  // Avoid division by zero
  if (magnitude1 === 0 || magnitude2 === 0) {
    return 0;
  }
  
  // Calculate cosine similarity
  const similarity = dotProduct / (magnitude1 * magnitude2);
  
  // Ensure the result is in the range [0, 1]
  return Math.max(0, Math.min(1, similarity));
}
