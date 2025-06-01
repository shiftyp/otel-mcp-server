/**
 * Utility functions for dynamically generating tool descriptions based on search engine type
 */

import { BaseSearchAdapter, SearchEngineType } from '../adapters/base/searchAdapter.js';

/**
 * Get the search engine name for use in descriptions
 * @param adapter The search adapter instance
 * @returns The search engine name (Elasticsearch or OpenSearch)
 */
export function getSearchEngineName(adapter: BaseSearchAdapter): string {
  return adapter.getType() === SearchEngineType.OPENSEARCH ? 'OpenSearch' : 'Elasticsearch';
}

/**
 * Create a dynamic description that includes the search engine name
 * @param adapter The search adapter instance
 * @param baseDescription The base description template
 * @returns The description with the search engine name inserted
 */
export function createDynamicDescription(adapter: BaseSearchAdapter, baseDescription: string): string {
  const engineName = getSearchEngineName(adapter);
  return baseDescription.replace(/\{searchEngine\}/g, engineName);
}
