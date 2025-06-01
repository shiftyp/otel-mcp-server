import { logger } from '../../../utils/logger.js';
import { semanticSearchWithOpenSearch } from './semanticSearchOpenSearch.js';
import type { SemanticSearchOptions } from './semanticLogSearch.js';

/**
 * Perform semantic search using Elasticsearch's vector search capabilities
 * @param query The search query
 * @param options Search options
 * @param adapterOptions Adapter options
 * @returns Search results
 */
export async function semanticSearchWithElasticsearch(
  query: string,
  options: SemanticSearchOptions,
  adapterOptions: any
): Promise<any> {
  // For now, we'll just delegate to the OpenSearch implementation
  // In the future, this can be enhanced with Elasticsearch-specific optimizations
  logger.info('[SemanticLogSearch] Using OpenSearch implementation for Elasticsearch search');
  return semanticSearchWithOpenSearch(query, options, adapterOptions);
}
