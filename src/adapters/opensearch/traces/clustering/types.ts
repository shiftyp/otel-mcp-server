/**
 * Types and interfaces for trace attribute clustering
 */

/**
 * Types for trace attribute clustering
 */

// Import types from the ML utilities
import type { SamplingOptions } from '../../ml/sampling.js';
import type { EmbeddingOptions } from '../../ml/embeddings.js';

/**
 * Options for trace attribute clustering
 */
export interface TraceClusteringOptions {
  /** Attribute key to cluster (optional when using text content) */
  attributeKey?: string;
  /** Use text content extraction instead of a specific attribute key */
  useTextContent?: boolean;
  /** Specific fields to extract text from when using text content extraction */
  textFields?: string[];
  /** Service to filter traces by */
  service?: string;
  /** Query string to filter traces by */
  queryString?: string;
  /** Number of clusters to create */
  clusterCount?: number;
  /** Minimum size of a cluster */
  minClusterSize?: number;
  /** Include outliers in results */
  includeOutliers?: boolean;
}

/**
 * Options for trace attribute clustering with sampling
 */
export interface TraceClusteringWithSamplingOptions extends TraceClusteringOptions {
  /** Enable data sampling to improve performance */
  enableSampling?: boolean;
  /** Percentage of data to sample (1-100) */
  samplingPercent?: number;
  /** Maximum number of samples to process */
  maxSamples?: number;
  /** Batch size for embedding generation requests */
  embeddingBatchSize?: number;
  /** Exclude vector embeddings from the response to reduce payload size */
  excludeVectors?: boolean;
  /** Embedding provider configuration */
  embeddingProviderConfig?: any;
  /** Field name being sampled (used for nested field detection) */
  field?: string;
}

/**
 * Attribute value with embedding information
 */
export interface AttributeValueWithEmbedding {
  /** The attribute value */
  value: string;
  /** Document count (when using sampling) */
  count: number;
  /** Optional ID (e.g., trace ID) for reference */
  id?: string;
  /** Vector embedding for the attribute value */
  vector?: number[];
  /** Cluster ID assigned during clustering */
  clusterId?: number;
  /** Error during embedding generation if any */
  embeddingError?: string;
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
  details?: Record<string, any>;
}

/**
 * Cluster result
 */
export interface ClusterResult {
  /** Cluster ID */
  id: number;
  /** Cluster label */
  label: string;
  /** Attribute values in this cluster */
  values: AttributeValueWithEmbedding[];
  /** Common terms in this cluster */
  commonTerms: string[];
  /** Is this an outlier cluster */
  isOutlier: boolean;
}

/**
 * Result of trace attribute clustering
 */
export interface TraceClusteringResult {
  /** The attribute key that was clustered (or 'text_content' if using default text content) */
  attributeKey: string;
  /** Clusters of attribute values */
  clusters: ClusterResult[];
  /** Outlier values that didn't fit in any cluster */
  outliers: AttributeValueWithEmbedding[];
  /** Total number of attribute values */
  totalValues: number;
  /** Number of clusters */
  clusterCount: number;
  /** Minimum size of a cluster */
  minClusterSize: number;
  /** Sizes of each cluster */
  clusterSizes: number[];
  /** Labels for each cluster */
  clusterLabels: string[];
  /** Vector embeddings (optional) */
  vectors?: AttributeValueWithEmbedding[];
  /** Whether sampling was enabled */
  samplingEnabled?: boolean;
  /** Sampling percentage used */
  samplingPercent?: number;
  /** Number of sampled values */
  sampledValues?: number;
  /** Error message if clustering failed */
  error?: string;
  /** Detailed error information if available */
  errorDetails?: Record<string, any>;
  /** Informational message */
  message?: string;
}
