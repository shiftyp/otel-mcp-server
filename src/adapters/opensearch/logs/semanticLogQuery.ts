import { logger } from '../../../utils/logger.js';
import type { SemanticSearchOptions } from './semanticLogSearch.js';
import { createCustomLogSamplingQuery } from './semanticLogSampling.js';

/**
 * Interface for OpenSearch search parameters
 */
export interface SearchRequest {
  index?: string;
  size?: number;
  from?: number;
  sort?: any;
  query?: any;
  search?: string;
  body?: any;
  _source?: {
    includes: string[];
  };
  [key: string]: any;
}

/**
 * Build a base query for semantic log search
 * @param options Search options
 * @returns Base query object
 */
export function buildBaseQuery(options: SemanticSearchOptions): SearchRequest {
  // Create base query with source field selection
  const baseQuery: SearchRequest = {
    _source: {
      includes: [
        '@timestamp',
        'text_content',
        'text_content.vector',
        'body',
        'message',
        'log.message',
        'resource.attributes.service.name',
        'service.name',
        'severity_text',
        'trace_id',
        'span_id',
        'attributes.*'
      ]
    },
    query: {
      match_all: {}
    }
  };

  // Convert match_all to bool query for filters
  baseQuery.query = {
    bool: {
      must: [{ match_all: {} }],
      filter: []
    }
  };

  // Add time range filter
  if (options.startTime && options.endTime) {
    baseQuery.query.bool.filter.push({
      range: {
        '@timestamp': {
          gte: options.startTime,
          lte: options.endTime
        }
      }
    });
  }

  // Add service filter if specified
  if (options.service) {
    // Support wildcard patterns in service names
    if (options.service.includes('*')) {
      baseQuery.query.bool.filter.push({
        wildcard: {
          'service.name': options.service
        }
      });
    } else {
      baseQuery.query.bool.filter.push({
        term: {
          'service.name': options.service
        }
      });
    }
  }

  // Add query string if specified
  if (options.queryString) {
    baseQuery.search = options.queryString;
  }

  // If no query has been added, use a match_all query to get all logs
  if (!baseQuery.query && !baseQuery.search) {
    baseQuery.query = { match_all: {} };
  }

  return baseQuery;
}

/**
 * Apply intelligent sampling to the query
 * @param baseQuery Base query to modify
 * @param options Search options
 * @returns Modified query with sampling
 */
export function applyIntelligentSampling(baseQuery: SearchRequest, options: SemanticSearchOptions): SearchRequest {
  try {
    if (options.samplingPercent && options.samplingPercent < 100) {
      logger.info('[SemanticLogSearch] Applying custom sampling', { 
        samplingType: 'custom',
        dataType: 'logs'
      });
      
      // Create custom sampling query
      const customSamplingQuery = createCustomLogSamplingQuery();
      
      // Store the original query
      const originalQuery = baseQuery.query;
      
      // If we have a query, combine it with custom sampling
      if (originalQuery && Object.keys(originalQuery).length > 0) {
        // Replace with a bool query that combines both
        baseQuery.query = {
          bool: {
            must: [originalQuery],
            filter: [customSamplingQuery]
          }
        };
      } else {
        // Just use the custom sampling query
        baseQuery.query = customSamplingQuery;
      }
    }
  } catch (error) {
    logger.warn('[SemanticLogSearch] Error applying custom sampling, falling back to standard sampling', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
  
  return baseQuery;
}

/**
 * Build a standard search query (non-vector)
 * @param baseQuery Base query to modify
 * @param size Number of results to return
 * @returns Standard search query
 */
export function buildStandardSearchQuery(baseQuery: SearchRequest, size: number): SearchRequest {
  const standardQuery = {
    ...baseQuery,
    size: size
  };
  
  logger.info('[SemanticLogSearch] Using standard query (no vector search)', {
    size
  });
  
  return standardQuery;
}
