import { logger } from '../../../../utils/logger.js';

/**
 * Interface for embedding providers
 */
export interface EmbeddingProvider {
  /**
   * Generate embedding for text
   */
  generateEmbedding(text: string): Promise<number[]>;
  
  /**
   * Generate embeddings for multiple texts
   */
  generateEmbeddings(texts: string[]): Promise<number[][]>;
  
  /**
   * Get embedding dimension
   */
  getDimension(): number;
}

/**
 * Simple embedding provider using hash-based embeddings
 * In production, use OpenAI, HuggingFace, or other ML providers
 */
export class SimpleEmbeddingProvider implements EmbeddingProvider {
  private readonly dimension: number;
  private readonly cache: Map<string, number[]>;

  constructor(dimension: number = 384) {
    this.dimension = dimension;
    this.cache = new Map();
  }

  public async generateEmbedding(text: string): Promise<number[]> {
    // Check cache
    if (this.cache.has(text)) {
      return this.cache.get(text)!;
    }

    logger.debug('[SimpleEmbeddingProvider] Generating embedding', { 
      textLength: text.length 
    });

    // Simple hash-based embedding (for demo purposes)
    const embedding = this.textToVector(text);
    
    // Cache the result
    this.cache.set(text, embedding);
    
    return embedding;
  }

  public async generateEmbeddings(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(text => this.generateEmbedding(text)));
  }

  public getDimension(): number {
    return this.dimension;
  }

  /**
   * Convert text to vector using simple hashing
   * In production, use proper embeddings
   */
  private textToVector(text: string): number[] {
    const vector = new Array(this.dimension).fill(0);
    const words = text.toLowerCase().split(/\s+/);
    
    for (const word of words) {
      for (let i = 0; i < word.length; i++) {
        const charCode = word.charCodeAt(i);
        const index = (charCode * (i + 1)) % this.dimension;
        vector[index] += 1;
      }
    }
    
    // Normalize
    const magnitude = Math.sqrt(
      vector.reduce((sum, val) => sum + val * val, 0)
    );
    
    if (magnitude > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= magnitude;
      }
    }
    
    return vector;
  }
}

/**
 * OpenSearch vector embedding provider
 * Uses OpenSearch's ML capabilities
 */
export class OpenSearchEmbeddingProvider implements EmbeddingProvider {
  private readonly modelId: string;
  private readonly dimension: number;

  constructor(
    private readonly client: any,
    modelId: string,
    dimension: number = 384
  ) {
    this.modelId = modelId;
    this.dimension = dimension;
  }

  public async generateEmbedding(text: string): Promise<number[]> {
    logger.debug('[OpenSearchEmbeddingProvider] Generating embedding', { 
      modelId: this.modelId,
      textLength: text.length 
    });

    try {
      const response = await this.client.request('POST', '/_plugins/_ml/models/_predict', {
        model_id: this.modelId,
        input: {
          text: text
        }
      });

      return response.inference_results[0].output;
    } catch (error) {
      logger.error('[OpenSearchEmbeddingProvider] Error generating embedding', { error });
      throw error;
    }
  }

  public async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const response = await this.client.request('POST', '/_plugins/_ml/models/_predict', {
      model_id: this.modelId,
      input: {
        text: texts
      }
    });

    return response.inference_results.map((result: any) => result.output);
  }

  public getDimension(): number {
    return this.dimension;
  }
}

/**
 * Factory for creating embedding providers
 */
export class EmbeddingProviderFactory {
  static create(
    type: 'simple' | 'opensearch',
    options?: any
  ): EmbeddingProvider {
    switch (type) {
      case 'opensearch':
        if (!options?.client || !options?.modelId) {
          throw new Error('OpenSearch embedding provider requires client and modelId');
        }
        return new OpenSearchEmbeddingProvider(
          options.client,
          options.modelId,
          options.dimension
        );
      
      case 'simple':
      default:
        return new SimpleEmbeddingProvider(options?.dimension);
    }
  }
}