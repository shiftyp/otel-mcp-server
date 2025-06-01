import { logger } from '../../../utils/logger.js';

/**
 * Calculate cosine similarity between two vectors
 * @param vec1 First vector
 * @param vec2 Second vector
 * @returns Cosine similarity (0-1 range)
 */
export function calculateCosineSimilarity(vec1: number[], vec2: number[]): number {
  if (!vec1 || !vec2 || vec1.length !== vec2.length) {
    logger.warn('[SemanticLogSearch] Cannot calculate similarity for invalid vectors', {
      vec1Length: vec1?.length,
      vec2Length: vec2?.length
    });
    return 0;
  }
  
  // Calculate dot product
  let dotProduct = 0;
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
  }
  
  // Calculate magnitudes
  let mag1 = 0;
  let mag2 = 0;
  for (let i = 0; i < vec1.length; i++) {
    mag1 += vec1[i] * vec1[i];
    mag2 += vec2[i] * vec2[i];
  }
  
  mag1 = Math.sqrt(mag1);
  mag2 = Math.sqrt(mag2);
  
  // Avoid division by zero
  if (mag1 === 0 || mag2 === 0) {
    return 0;
  }
  
  // Calculate cosine similarity
  const similarity = dotProduct / (mag1 * mag2);
  
  // Ensure the result is in the range [0, 1]
  return Math.max(0, Math.min(1, similarity));
}

/**
 * Extract log message from a document source
 * @param source Document source
 * @returns Log message
 */
export function extractLogMessage(source: any): string {
  // Try various fields that might contain the message
  let message = source.message || 
               source['log.message'] || 
               source.body || 
               source.Body || 
               source.Message;
  
  // If we still don't have a message, try to extract it from the source
  if (!message && typeof source === 'object') {
    // Look for any field that might contain 'message' in its name
    for (const key in source) {
      if (key.toLowerCase().includes('message') && typeof source[key] === 'string') {
        message = source[key];
        break;
      }
    }
  }
  
  // If we still don't have a message, use the entire source
  if (!message) {
    message = JSON.stringify(source);
  }
  
  // Clean up the message if it's too long
  if (message && message.length > 1000) {
    message = message.substring(0, 1000);
  }
  
  return message;
}

/**
 * Build filters for the log search query
 * @param options Search options
 * @returns Array of filters
 */
export function buildLogFilters(options: any): any[] {
  const filters: any[] = [];
  
  // Add time range filter if specified
  if (options.startTime && options.endTime) {
    filters.push({
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
      filters.push({
        wildcard: {
          'resource.attributes.service.name': options.service
        }
      });
    } else {
      filters.push({
        term: {
          'resource.attributes.service.name': options.service
        }
      });
    }
  }
  
  // Add level filter if specified
  if (options.level) {
    filters.push({
      term: {
        'severity.text': options.level
      }
    });
  }
  
  // Add query string filter if specified
  if (options.queryString) {
    filters.push({
      query_string: {
        query: options.queryString,
        analyze_wildcard: true,
        default_field: '*'
      }
    });
  }
  
  return filters;
}
