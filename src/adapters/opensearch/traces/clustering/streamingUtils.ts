/**
 * Streaming utilities for trace attribute clustering
 * This module provides utilities for streaming document retrieval and processing
 */

import { logger } from '../../../../utils/logger.js';
import { AttributeValueWithEmbedding } from './types.js';
import { TracesAdapterCore } from '../traceCore.js';

/**
 * Options for streaming document retrieval
 */
export interface StreamingDocumentOptions {
  /** Index pattern to search */
  indexPattern: string;
  /** Search query */
  searchQuery: any;
  /** Page size for document retrieval */
  pageSize: number;
  /** Maximum number of documents to process */
  maxDocsToProcess: number;
  /** Sampling rate (0-1) */
  samplingRate: number;
  /** Whether to extract text content instead of a specific attribute */
  useTextContent: boolean;
  /** Attribute key to extract */
  attributeKey?: string;
  /** Function to extract text content from a document */
  textExtractor: (source: any, id: string) => string;
  /** Function to extract an attribute value from a document */
  attributeExtractor: (source: any, path: string) => any;
}

/**
 * Create an async generator for streaming document retrieval and processing
 * 
 * @param client The OpenSearch client
 * @param options Streaming document options
 * @returns An async generator that yields batches of attribute values
 */
export async function* streamDocuments(
  client: TracesAdapterCore,
  options: StreamingDocumentOptions
): AsyncGenerator<AttributeValueWithEmbedding[], void, unknown> {
  const {
    indexPattern,
    searchQuery,
    pageSize,
    maxDocsToProcess,
    samplingRate,
    useTextContent,
    attributeKey,
    textExtractor,
    attributeExtractor
  } = options;

  // Calculate how many documents to sample per page based on sampling rate
  const samplesPerPage = Math.max(1, Math.ceil(pageSize * samplingRate));

  let processedDocs = 0;
  let searchAfter: any = null;
  let continueProcessing = true;

  // Function to sample documents from a page
  const sampleFromPage = (docs: any[], count: number): any[] => {
    if (docs.length <= count) return docs;
    
    const sampled: any[] = [];
    const indices = new Set<number>();
    
    while (indices.size < count && indices.size < docs.length) {
      const randomIndex = Math.floor(Math.random() * docs.length);
      if (!indices.has(randomIndex)) {
        indices.add(randomIndex);
        sampled.push(docs[randomIndex]);
      }
    }
    
    return sampled;
  };

  // Initialize array to hold attribute values
  let attributeValues: AttributeValueWithEmbedding[] = [];
  
  try {
    // Process each page of search results
    while (processedDocs < maxDocsToProcess) {
      try {
        // Update the search query with search_after if we have it
        const currentQuery = searchAfter ? {
          ...searchQuery,
          search_after: searchAfter
        } : searchQuery;
        
        // Log the current processing state
        logger.info('[StreamingDocuments] Processing state', {
          processedDocs,
          maxDocsToProcess,
          attributeValuesCount: attributeValues.length,
          hasPaginationValues: !!searchAfter
        });
        
        // Execute the search
        logger.info('[StreamingDocuments] Executing search query', {
          indexPattern,
          querySize: currentQuery.size,
          filters: JSON.stringify(currentQuery.query?.bool?.filter || []).substring(0, 200),
          must: JSON.stringify(currentQuery.query?.bool?.must || []).substring(0, 200)
        });
        
        const searchResponse = await client.search({
          index: indexPattern,
          body: currentQuery
        });
      
      // Get the current batch of documents
      const docs = searchResponse.hits?.hits || [];
      processedDocs += docs.length;
      
      logger.info('[StreamingDocuments] Search results', {
        totalHits: searchResponse.hits?.total,
        docsReturned: docs.length,
        processedDocs
      });
      
      // If no more documents, stop processing
      if (docs.length === 0) {
        continueProcessing = false;
        break;
      }
      
      // Sample documents from this page
      const sampledDocs = sampleFromPage(docs, samplesPerPage);
      
      logger.info('[StreamingDocuments] Sampled documents from page', {
        pageSize: docs.length,
        sampledCount: sampledDocs.length,
        totalProcessed: processedDocs
      });
      
      // Process the sampled documents
      attributeValues = [];
      
      if (useTextContent) {
        // For text content clustering, extract text from each sampled document
        logger.info('[StreamingDocuments] Processing documents with text content extraction', {
          sampledCount: sampledDocs.length
        });
        
        let extractedCount = 0;
        let emptyCount = 0;
        
        // If we have no documents, log a warning
        if (sampledDocs.length === 0) {
          logger.warn('[StreamingDocuments] No documents to process for text content extraction');
        }
        
        for (const doc of sampledDocs) {
          const source = doc._source || {};
          // Extract trace ID from the correct field path in logs
          const traceId = source.trace?.id || source.trace_id || source.TraceId || doc._id || 'unknown';
          
          // Log the first document source for debugging
          if (sampledDocs.indexOf(doc) === 0) {
            logger.info('[StreamingDocuments] Sample document source', {
              source: JSON.stringify(source).substring(0, 500), // Limit the size
              hasTrace: !!source.trace,
              hasTraceId: !!source.trace?.id,
              hasMessage: !!source.message,
              hasUrlPath: !!source.url?.path,
              keys: Object.keys(source)
            });
          }
          
          try {
            // Use the provided text extraction function
            const textContent = textExtractor(source, traceId);
            
            if (textContent.trim()) {
              // Store the extracted text with its trace ID
              attributeValues.push({
                value: textContent,
                count: 1,
                id: traceId
              });
              extractedCount++;
              
              // Log the first successful extraction
              if (extractedCount === 1) {
                logger.info('[StreamingDocuments] First extracted text content', {
                  textContent: textContent.substring(0, 200), // Limit the size
                  traceId
                });
              }
            } else {
              emptyCount++;
            }
          } catch (error) {
            logger.warn('[StreamingDocuments] Error extracting text content', {
              error: error instanceof Error ? error.message : String(error),
              traceId
            });
          }
        }
        
        logger.info('[StreamingDocuments] Text extraction summary', {
          sampledCount: sampledDocs.length,
          extractedCount,
          emptyCount,
          attributeValuesCount: attributeValues.length
        });
      } else if (attributeKey) {
        // For attribute-based clustering, extract the specific attribute
        for (const doc of sampledDocs) {
          const source = doc._source || {};
          // Extract trace ID from the correct field path in logs
          const traceId = source.trace?.id || source.trace_id || source.TraceId || doc._id || 'unknown';
          
          // Extract the attribute value using the provided function
          const attrValue = attributeExtractor(source, attributeKey);
          
          if (attrValue !== undefined && typeof attrValue === 'string' && attrValue.trim()) {
            attributeValues.push({
              value: attrValue,
              count: 1,
              id: traceId
            });
          }
        }
      }
      
      // Update search_after for the next page
      if (docs.length > 0) {
        searchAfter = docs[docs.length - 1].sort;
      } else {
        continueProcessing = false;
      }
      
      // Log progress
      logger.info('[StreamingDocuments] Streaming progress', {
        processedDocs,
        attributeValuesCollected: attributeValues.length
      });
      
      // Yield the batch of attribute values
      if (attributeValues.length > 0) {
        yield attributeValues;
      }
    } catch (error) {
      logger.error('[StreamingDocuments] Error processing page', {
        error: error instanceof Error ? error.message : String(error),
        processedDocs
      });
      // Continue to the next page despite errors
    }
    }
  } catch (error) {
    logger.error('[StreamingDocuments] Error during streaming document retrieval', {
      error: error instanceof Error ? error.message : String(error),
      processedDocs
    });
    // Continue with any data we've collected so far
  }
}
