/**
 * Embedding provider utility to switch between different embedding backends
 * This module provides a unified interface for generating embeddings
 * using either OpenSearch's built-in ML capabilities or external OpenAI-compatible APIs.
 */

import { logger } from '../../../utils/logger.js';
import { OpenSearchCore } from '../core/core.js';
import { 
  generateEmbeddings, 
  generateEmbedding, 
  EmbeddingOptions, 
  EmbeddingResult 
} from './embeddings.js';
import { 
  generateOpenAIEmbeddings, 
  generateOpenAIEmbedding, 
  OpenAIEmbeddingConfig 
} from './openaiEmbeddings.js';

/**
 * Embedding provider configuration
 */
export interface EmbeddingProviderConfig {
  /** Provider type: 'opensearch' or 'openai' */
  provider: 'opensearch' | 'openai';
  /** OpenSearch model ID (used when provider is 'opensearch') */
  modelId?: string;
  /** OpenAI configuration (used when provider is 'openai') */
  openai?: OpenAIEmbeddingConfig;
}

/**
 * Get default embedding provider configuration from environment variables
 */
export function getDefaultEmbeddingConfig(): EmbeddingProviderConfig {
  // Check if OpenAI configuration is available
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const openaiEndpoint = process.env.OPENAI_EMBEDDINGS_ENDPOINT || 'https://api.openai.com/v1/embeddings';
  const openaiModel = process.env.OPENAI_EMBEDDINGS_MODEL || 'text-embedding-3-small';
  
  // If OpenAI API key is available, use OpenAI as the provider
  if (openaiApiKey) {
    return {
      provider: 'openai',
      openai: {
        endpoint: openaiEndpoint,
        apiKey: openaiApiKey,
        model: openaiModel,
        organization: process.env.OPENAI_ORGANIZATION,
        maxTokensPerBatch: parseInt(process.env.OPENAI_MAX_TOKENS_PER_BATCH || '8192', 10),
        maxConcurrentRequests: parseInt(process.env.OPENAI_MAX_CONCURRENT_REQUESTS || '5', 10),
        timeoutMs: parseInt(process.env.OPENAI_TIMEOUT_MS || '30000', 10)
      }
    };
  }
  
  // Otherwise, use OpenSearch as the provider
  return {
    provider: 'opensearch',
    modelId: process.env.EMBEDDINGS_MODEL_ID || 'iUEnH5cBhdg3okuzOF5d'
  };
}

/**
 * Generate embeddings using the configured provider
 * 
 * @param client The OpenSearch client
 * @param items Array of items to generate embeddings for
 * @param textExtractor Function to extract text from each item
 * @param options Embedding options
 * @param providerConfig Provider configuration (optional, uses default if not provided)
 * @returns The items with embeddings added
 */
export async function generateEmbeddingsWithProvider<T>(
  client: OpenSearchCore,
  items: T[],
  textExtractor: (item: T) => string,
  options: EmbeddingOptions = {},
  providerConfig?: EmbeddingProviderConfig
): Promise<EmbeddingResult<T>[]> {
  // Use provided config or get default
  const config = providerConfig || getDefaultEmbeddingConfig();
  
  // Create context prefix for logging
  const contextPrefix = options.context?.source 
    ? `[${options.context.source}]` 
    : '[EmbeddingProvider]';
  
  // Log the provider being used
  logger.info(`${contextPrefix} Using embedding provider: ${config.provider}`, {
    provider: config.provider,
    modelId: config.provider === 'opensearch' ? config.modelId : config.openai?.model,
    itemCount: items.length
  });
  
  // Use the appropriate provider
  if (config.provider === 'openai') {
    // Ensure OpenAI configuration is available
    if (!config.openai) {
      throw new Error('OpenAI configuration is required when provider is "openai"');
    }
    
    // Use OpenAI provider
    return generateOpenAIEmbeddings(
      client,
      items,
      textExtractor,
      config.openai,
      options
    );
  } else {
    // Use OpenSearch provider
    return generateEmbeddings(
      client,
      items,
      textExtractor,
      {
        ...options,
        modelId: config.modelId
      }
    );
  }
}

/**
 * Generate an embedding for a single item using the configured provider
 * 
 * @param client The OpenSearch client
 * @param item Item to generate embedding for
 * @param textExtractor Function to extract text from the item
 * @param options Embedding options
 * @param providerConfig Provider configuration (optional, uses default if not provided)
 * @returns The item with embedding added
 */
export async function generateEmbeddingWithProvider<T>(
  client: OpenSearchCore,
  item: T,
  textExtractor: (item: T) => string,
  options: EmbeddingOptions = {},
  providerConfig?: EmbeddingProviderConfig
): Promise<EmbeddingResult<T>> {
  // Use the batch function with a single item for consistency
  const results = await generateEmbeddingsWithProvider(
    client,
    [item],
    textExtractor,
    options,
    providerConfig
  );
  
  // Return the first (and only) result
  return results[0];
}
