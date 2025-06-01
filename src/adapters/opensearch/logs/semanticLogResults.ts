import { logger } from '../../../utils/logger.js';
import { enrichWithContext } from './semanticLogContext.js';
import type { SemanticSearchOptions } from './semanticLogSearch.js';

/**
 * Extended SemanticSearchOptions with additional result processing properties
 */
export interface EnhancedResultOptions extends SemanticSearchOptions {
  deduplicateResults?: boolean;
  includeContext?: boolean;
  contextWindowSize?: number;
  minSimilarity?: number;
}

/**
 * Process and format semantic search results
 * @param scoredResults Results with similarity scores
 * @param options Search options
 * @returns Processed results
 */
export function processResults(
  scoredResults: Array<{ 
    id: string; 
    score: number; 
    source: Record<string, any>;
    timestamp?: string;
  }>,
  options: EnhancedResultOptions
): { 
  results: any[]; 
  dedupedPatterns?: Record<string, any>;
  count: number;
} {
  const results: any[] = [];
  
  // Only include results that meet the minimum similarity threshold
  for (const result of scoredResults) {
    if (result.score >= (options.minSimilarity || 0.7)) {
      // Format the result
      const formattedResult = {
        id: result.id,
        score: result.score,
        timestamp: result.timestamp || result.source['@timestamp'],
        message: result.source.message || result.source['log.message'] || result.source.text_content || '',
        service: result.source['service.name'] || result.source['resource.attributes.service.name'] || 'unknown',
        trace_id: result.source.trace_id,
        span_id: result.source.span_id,
        severity: result.source.severity_text || result.source['log.level'] || result.source['event.severity'],
        attributes: result.source.attributes || {},
        source: result.source
      };
      
      results.push(formattedResult);
    }
  }
  
  // Add context if requested
  if (options.includeContext) {
    // Clone results before enriching with context
    const resultsWithContext = [...results];
    
    // Enrich with context asynchronously
    // Note: We're intentionally not awaiting this since the original function
    // signature doesn't return a Promise
    enrichWithContext(resultsWithContext, options.contextWindowSize || 5, {})
      .catch(err => logger.error('Error enriching context', { error: err }));
      
    return {
      results: resultsWithContext,
      count: resultsWithContext.length
    };
  }
  
  // Deduplicate results if requested
  if (options.deduplicateResults) {
    const dedupedResults = deduplicateResults(results);
    return {
      results: dedupedResults.results,
      dedupedPatterns: dedupedResults.patterns,
      count: dedupedResults.results.length
    };
  }
  
  return {
    results,
    count: results.length
  };
}

/**
 * Normalize message pattern for deduplication
 * @param message Message to normalize
 * @returns Normalized pattern
 */
export function normalizeMessagePattern(message: string): string {
  if (!message) return '';
  
  // Replace numbers, UUIDs, hashes, timestamps, and other variable parts with placeholders
  return message
    .replace(/\d+/g, '{NUM}')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{UUID}')
    .replace(/[0-9a-f]{32}/gi, '{HASH}')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})/g, '{TIMESTAMP}')
    .replace(/\b([a-f0-9]{7,40})\b/gi, '{HASH}');
}

/**
 * Deduplicate results based on message patterns
 * @param results Results to deduplicate
 * @returns Deduplicated results and pattern information
 */
/**
 * Apply DRAIN algorithm to detect log patterns
 * DRAIN is a log parsing algorithm that groups similar log messages by structure
 * @param results Results to analyze
 * @returns Pattern clusters with samples
 */
export function applyDrainAlgorithm(results: any[]): {
  patterns: Array<{
    pattern: string;
    count: number;
    similarity: number;
    samples: any[];
    services: string[];
  }>;
  originalResults: any[];
} {
  // Step 1: Extract message patterns
  const patternMap: Record<string, {
    pattern: string;
    rawPattern: string;
    count: number;
    totalScore: number;
    samples: any[];
    services: Set<string>;
  }> = {};
  
  // Group results by normalized pattern
  for (const log of results) {
    const message = log.message || '';
    const pattern = normalizeMessagePattern(message);
    
    if (!patternMap[pattern]) {
      patternMap[pattern] = {
        pattern,
        rawPattern: message,
        count: 0,
        totalScore: 0,
        samples: [],
        services: new Set<string>()
      };
    }
    
    patternMap[pattern].count++;
    patternMap[pattern].totalScore += (log.score || 0);
    
    // Keep a limited number of diverse samples
    if (patternMap[pattern].samples.length < 3) {
      patternMap[pattern].samples.push(log);
    }
    
    // Track services
    if (log.service && log.service !== 'unknown') {
      patternMap[pattern].services.add(log.service);
    }
  }
  
  // Step 2: Convert to array and sort by count and score
  const patterns = Object.values(patternMap).map(p => ({
    pattern: p.pattern,
    count: p.count,
    similarity: p.totalScore / p.count, // Average similarity score
    samples: p.samples,
    services: Array.from(p.services)
  }));
  
  // Sort by count (descending) and then by similarity score
  patterns.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.similarity - a.similarity;
  });
  
  logger.info('[SemanticLogSearch] Applied DRAIN algorithm', {
    originalCount: results.length,
    patternCount: patterns.length,
    topPatternCount: patterns.length > 0 ? patterns[0].count : 0
  });
  
  return {
    patterns,
    originalResults: results
  };
}

export function deduplicateResults(results: any[]): {
  results: any[];
  patterns: Record<string, { count: number, samples: Array<{ id: string, timestamp: string }> }>;
} {
  const patternMap: Record<string, { count: number, samples: Array<{ id: string, timestamp: string }> }> = {};
  
  // Group results by normalized pattern
  for (const log of results) {
    const pattern = normalizeMessagePattern(log.message || '');
    if (!patternMap[pattern]) {
      patternMap[pattern] = { 
        count: 0, 
        samples: [] 
      };
    }
    
    patternMap[pattern].count++;
    if (patternMap[pattern].samples.length < 3) {
      patternMap[pattern].samples.push({
        id: log.id,
        timestamp: log.timestamp
      });
    }
  }
  
  // Keep one representative for each pattern
  const dedupedResults: any[] = [];
  const patterns = Object.keys(patternMap);
  
  for (const pattern of patterns) {
    // Find the highest scored result for this pattern
    const matchingLogs = results.filter(log => normalizeMessagePattern(log.message || '') === pattern);
    const highestScoredLog = matchingLogs.reduce((prev, current) => 
      (current.score > prev.score) ? current : prev, matchingLogs[0]);
    
    // Add count information
    highestScoredLog.pattern_count = patternMap[pattern].count;
    dedupedResults.push(highestScoredLog);
  }
  
  // Sort by score
  dedupedResults.sort((a, b) => b.score - a.score);
  
  logger.info('[SemanticLogSearch] Deduplicated results', {
    originalCount: results.length,
    dedupedCount: dedupedResults.length,
    patternCount: patterns.length
  });
  
  return {
    results: dedupedResults,
    patterns: patternMap
  };
}
