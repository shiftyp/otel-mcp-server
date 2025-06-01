import { logger } from '../../../utils/logger.js';
import { LogsSearchAdapter } from './logSearch.js';
import { Client } from '@opensearch-project/opensearch';
// Import modular components
import { 
  buildBaseQuery, 
  applyIntelligentSampling, 
  buildStandardSearchQuery,
  SearchRequest
} from './semanticLogQuery.js';
import { 
  generateEmbedding, 
  extractLogTextContent, 
  calculateCosineSimilarity
} from './semanticLogEmbedding.js';
import { processResults, EnhancedResultOptions, applyDrainAlgorithm } from './semanticLogResults.js';

/**
 * Extended SemanticSearchOptions with embedding-related properties
 */
export interface EnhancedSemanticSearchOptions extends EnhancedResultOptions {
  embeddingProvider?: any;
  embeddingModelId?: string;
  k?: number;
  samplingPercent?: number;
  minSimilarity?: number;
}

/**
 * Calculate text similarity between query and log text
 * Simple fallback when vector embeddings are not available
 * @param query Query text
 * @param logText Log text
 * @returns Similarity score (0-1)
 */
function calculateTextSimilarity(query: string, logText: string): number {
  if (!query || !logText) return 0;
  
  // Normalize texts
  const normalizedQuery = query.toLowerCase();
  const normalizedLogText = logText.toLowerCase();
  
  // Split into words
  const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 2);
  const logWords = normalizedLogText.split(/\s+/).filter(w => w.length > 2);
  
  if (queryWords.length === 0 || logWords.length === 0) return 0;
  
  // Count matching words
  let matchCount = 0;
  for (const word of queryWords) {
    if (logWords.includes(word)) {
      matchCount++;
    }
  }
  
  // Calculate Jaccard similarity
  const uniqueWords = new Set([...queryWords, ...logWords]);
  return matchCount / uniqueWords.size;
}

/**
 * Perform semantic search using OpenSearch
 * @param query The search query
 * @param options Search options
 * @param adapterOptions Adapter options
 * @returns Search results
 */
export async function semanticSearchWithOpenSearch(
  query: string,
  options: EnhancedSemanticSearchOptions,
  adapterOptions: { 
    client: Client | LogsSearchAdapter; 
    embeddingProvider?: any;
    coreAdapter?: any;
  }
): Promise<{ 
  results: any[]; 
  error?: string; 
  message?: string; 
  query?: any; 
  count?: number; 
  dedupedPatterns?: any;
  patterns?: Array<{
    pattern: string;
    count: number;
    similarity: number;
    samples: any[];
    services: string[];
  }>; 
}> {
  try {
    logger.debug('Semantic search with OpenSearch', { query, options });
    
    // Create logs search adapter
    const logsAdapter = adapterOptions.client instanceof LogsSearchAdapter ? 
      adapterOptions.client : new LogsSearchAdapter(adapterOptions);
    
    // Get embedding provider from options or adapter
    let embeddingProvider = options.embeddingProvider || adapterOptions.embeddingProvider;
    
    // If no embedding provider but we have config, create one
    if (!embeddingProvider && options.embeddingProviderConfig) {
      logger.info('[SemanticLogSearch] Creating embedding provider from config', {
        providerConfig: JSON.stringify(options.embeddingProviderConfig)
      });
      
      // Use the embedding provider config directly
      embeddingProvider = options.embeddingProviderConfig;
    }
    
    // Force using OpenAI API directly if no provider is available
    if (!embeddingProvider) {
      logger.info('[SemanticLogSearch] No embedding provider available, creating default OpenAI provider');
      
      // Create a default OpenAI embedding provider
      embeddingProvider = {
        provider: 'openai',
        openai: {
          endpoint: process.env.OPENAI_EMBEDDINGS_ENDPOINT || 'https://api.openai.com/v1/embeddings',
          apiKey: process.env.OPENAI_API_KEY || '',
          model: 'text-embedding-3-small',
          maxTokensPerBatch: 8192,
          maxConcurrentRequests: 5,
          timeoutMs: 30000
        }
      };
    }
    
    // Set minimum similarity threshold - use a lower default for better recall
    const minSimilarity = options.minSimilarity || 0.2;
    
    // Get embedding model ID
    const embeddingModelId = options.embeddingProviderConfig?.openai?.model || options.embeddingModelId;
    
    // Log embedding configuration
    logger.debug('Embedding configuration', { 
      embeddingProvider, 
      embeddingModelId, 
      hasEmbeddingProviderConfig: !!options.embeddingProviderConfig 
    });
    
    // Build base query
    const baseQuery = buildBaseQuery(options);
    
    // Calculate sampling parameters
    const k = options.k || 10;
    const samplingPercent = options.samplingPercent || 20;
    // Increase max sample size to get more logs for semantic scoring
    const maxSampleSize = Math.min(5000, k * 50);
    const needsPagination = maxSampleSize > 100;
    const pageSize = needsPagination ? 100 : maxSampleSize;
    const numPages = needsPagination ? Math.ceil(maxSampleSize / pageSize) : 1;
    
    logger.debug('Sampling parameters', { 
      k, 
      samplingPercent, 
      maxSampleSize, 
      needsPagination, 
      pageSize, 
      numPages
    });
    
    // Apply intelligent sampling to base query
    const sampledQuery = applyIntelligentSampling(baseQuery, options);
    
    // Collect candidate logs through pagination if needed
    let allCandidateLogs: any[] = [];
    let queryVector: number[] | undefined;
    
    // Generate embedding on-the-fly for the query
    try {
      if (embeddingProvider || options.embeddingProviderConfig) {
        logger.info('[SemanticLogSearch] Generating embedding on-the-fly for query', {
          query,
          hasEmbeddingProvider: !!embeddingProvider,
          hasEmbeddingProviderConfig: !!options.embeddingProviderConfig
        });
        
        // Use the embedding provider to generate the query vector
        const providerToUse = embeddingProvider || options.embeddingProviderConfig;
        
        queryVector = await generateEmbedding(
          query,
          providerToUse,
          {
            modelId: options.embeddingModelId,
            context: 'semantic_log_search'
          },
          {
            client: logsAdapter,
            coreAdapter: adapterOptions.coreAdapter
          }
        );
        
        logger.info('[SemanticLogSearch] Query embedding generated on-the-fly', {
          hasVector: !!queryVector,
          vectorLength: queryVector?.length || 0
        });
      } else {
        logger.info('[SemanticLogSearch] No embedding provider available, using standard search', {
          query
        });
        queryVector = undefined;
      }
    } catch (embeddingError) {
      logger.error('[SemanticLogSearch] Error generating query embedding on-the-fly', {
        error: embeddingError,
        message: embeddingError instanceof Error ? embeddingError.message : String(embeddingError),
        stack: embeddingError instanceof Error ? embeddingError.stack : 'No stack trace'
      });
      queryVector = undefined;
    }
    
    // Collect candidate logs
    for (let page = 0; page < numPages; page++) {
      const from = page * pageSize;
      const size = Math.min(pageSize, maxSampleSize - from);
      
      if (size <= 0) break;
      
      logger.debug(`Fetching candidate logs page ${page + 1}/${numPages}`, { from, size });
      
      // Build search request
      // Use standard search for fetching candidate logs
      const searchRequest = buildStandardSearchQuery(sampledQuery, size);
  
      // Log the search approach
      logger.info('[SemanticLogSearch] Using standard search for candidate retrieval', {
        queryText: query,
        hasQueryVector: !!queryVector,
        vectorLength: queryVector?.length || 0
      });
      
      // Add pagination parameters
      searchRequest.from = from;
      searchRequest.size = size;
      
      // Execute search
      const searchResponse = await logsAdapter.searchLogs(searchRequest);
      
      if (!searchResponse?.body?.hits?.hits) {
        logger.warn('No hits in search response', { searchResponse });
        continue;
      }
      
      // Extract hits
      const hits = searchResponse.body.hits.hits;
      allCandidateLogs = [...allCandidateLogs, ...hits];
      
      logger.debug(`Retrieved ${hits.length} logs from page ${page + 1}`, { 
        totalSoFar: allCandidateLogs.length,
        target: maxSampleSize
      });
      
      // Break early if we have enough logs
      if (allCandidateLogs.length >= maxSampleSize) {
        break;
      }
    }
    
    logger.info(`Retrieved ${allCandidateLogs.length} candidate logs for semantic scoring`);
    
    // Score candidate logs by semantic similarity
    let results: any[] = [];
    
    // Calculate similarity scores for each log
    for (const hit of allCandidateLogs) {
      const source = hit._source;
      
      // Extract text content from the log
      const logText = extractLogTextContent(source);
      
      let similarityScore: number;
      
      // If we have a query vector, generate embedding for this log and use cosine similarity
      // Use the same embedding provider that worked for the query
      const providerToUse = embeddingProvider || options.embeddingProviderConfig;
      
      // Ensure we have a provider to use
      if (queryVector && queryVector.length > 0) {
        try {
          logger.info('[SemanticLogSearch] Attempting to generate log vector on-the-fly', {
            logTextLength: logText.length,
            hasEmbeddingProvider: !!embeddingProvider,
            embeddingProviderType: typeof embeddingProvider,
            embeddingProviderKeys: Object.keys(embeddingProvider || {}),
            modelId: options.embeddingModelId
          });
          
          // Generate embedding for this log on-the-fly using the same provider that worked for the query
          const logVector = await generateEmbedding(
            logText,
            providerToUse,
            {
              modelId: options.embeddingModelId,
              context: 'semantic_log_search'
            },
            {
              client: logsAdapter,
              coreAdapter: adapterOptions.coreAdapter
            }
          );
          
          logger.info('[SemanticLogSearch] Log vector generation result', {
            hasLogVector: !!logVector,
            logVectorLength: logVector?.length || 0,
            logTextLength: logText.length
          });
          
          // Calculate cosine similarity if we got a valid vector
          if (logVector && logVector.length > 0) {
            similarityScore = calculateCosineSimilarity(queryVector, logVector);
            logger.info('[SemanticLogSearch] Calculated cosine similarity for log', {
              similarityScore,
              logTextLength: logText.length,
              logVectorLength: logVector.length,
              queryVectorLength: queryVector.length
            });
          } else {
            // Fallback to text similarity if vector generation failed
            similarityScore = calculateTextSimilarity(query, logText);
            logger.warn('[SemanticLogSearch] Fallback to text similarity (empty log vector)', {
              similarityScore,
              logTextLength: logText.length
            });
          }
        } catch (embeddingError) {
          // Fallback to text similarity if embedding generation fails
          similarityScore = calculateTextSimilarity(query, logText);
          logger.warn('[SemanticLogSearch] Error generating log embedding, falling back to text similarity', {
            error: embeddingError instanceof Error ? embeddingError.message : String(embeddingError),
            similarityScore,
            logTextLength: logText.length
          });
        }
      } else {
        // Fallback to text similarity if we don't have a query vector
        similarityScore = calculateTextSimilarity(query, logText);
        logger.debug('[SemanticLogSearch] Using text similarity (no query vector)', {
          similarityScore,
          logTextLength: logText.length
        });
      }
      
      // Add to results with similarity score
      results.push({
        ...hit,
        _score: similarityScore,
        similarity: similarityScore
      });
    }
    
    // Filter by minimum similarity and sort by score
    const filteredLogs = results
      .filter(item => item._score >= minSimilarity)
      .sort((a, b) => b._score - a._score);
    
    logger.info(`Found ${filteredLogs.length} logs with similarity >= ${minSimilarity}`);
    
    // Convert the filtered logs to the format expected by processResults
    const scoredResults = filteredLogs.map(log => ({
      id: log._id || '',
      score: log._score || 0,
      source: log._source || {},
      timestamp: log._source?.['@timestamp'] || ''
    }));
    
    // Process the results to add context and format them properly
    const processedResults = processResults(scoredResults, {
      minSimilarity,
      includeContext: options.includeContext,
      contextWindowSize: options.contextWindowSize,
      deduplicateResults: options.deduplicateResults
    });
    
    logger.info(`Processed ${processedResults.results.length} results after formatting`);
    
    // Apply DRAIN algorithm to identify common patterns
    const { patterns, originalResults } = applyDrainAlgorithm(processedResults.results);
    
    logger.info(`Identified ${patterns.length} distinct log patterns`);
    
    // Return the processed results with patterns
    return {
      results: processedResults.results,
      patterns: patterns,
      count: filteredLogs.length,
      query: sampledQuery
    };
  } catch (error) {
    logger.error('Error in semantic search', { error });
    return {
      results: [],
      error: error instanceof Error ? error.message : String(error),
      message: 'Error performing semantic search'
    };
  }
}
