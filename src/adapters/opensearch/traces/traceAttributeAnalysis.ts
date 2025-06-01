import { logger } from '../../../utils/logger.js';
import { TracesAdapterCore } from './traceCore.js';
import { SearchEngineType } from '../../base/searchAdapter.js';

/**
 * Trace Attribute Analysis using OpenSearch's NLP capabilities
 * Applies NLP techniques to analyze trace attributes
 */
export class TraceAttributeAnalysis {
  /**
   * Apply NLP analysis to trace attributes
   * @param client The OpenSearch client to use for requests
   * @param traces Array of traces to analyze
   * @param options Additional options for attribute analysis
   */
  public static async analyzeTraceAttributes(
    client: TracesAdapterCore,
    traces: any[],
    options: {
      attributeKeys?: string[];
      includeSpanAttributes?: boolean;
      analyzeSentiment?: boolean;
      extractEntities?: boolean;
    } = {}
  ): Promise<any> {
    logger.info('[TraceAttributeAnalysis] Analyzing trace attributes', { 
      traceCount: traces.length, 
      options 
    });
    
    try {
      // Default options
      const attributeKeys = options.attributeKeys || [];
      const includeSpanAttributes = options.includeSpanAttributes !== undefined ? options.includeSpanAttributes : true;
      const analyzeSentiment = options.analyzeSentiment !== undefined ? options.analyzeSentiment : true;
      const extractEntities = options.extractEntities !== undefined ? options.extractEntities : true;
      
      if (traces.length === 0) {
        return { 
          results: [], 
          message: 'No traces provided for attribute analysis'
        };
      }
      
      // Extract text attributes from traces
      const textAttributes: Array<{
        traceId: string;
        spanId?: string;
        key: string;
        value: string;
      }> = [];
      
      for (const trace of traces) {
        // Extract trace-level attributes
        const traceAttributes = trace.attributes || {};
        
        for (const [key, value] of Object.entries(traceAttributes)) {
          // Only include specified keys if provided, otherwise include all string attributes
          if ((attributeKeys.length === 0 || attributeKeys.includes(key)) && typeof value === 'string') {
            textAttributes.push({
              traceId: trace.trace_id,
              key,
              value
            });
          }
        }
        
        // Extract span-level attributes if requested
        if (includeSpanAttributes && trace.spans) {
          for (const span of trace.spans) {
            const spanAttributes = span.attributes || {};
            
            for (const [key, value] of Object.entries(spanAttributes)) {
              // Only include specified keys if provided, otherwise include all string attributes
              if ((attributeKeys.length === 0 || attributeKeys.includes(key)) && typeof value === 'string') {
                textAttributes.push({
                  traceId: trace.trace_id,
                  spanId: span.span_id,
                  key,
                  value
                });
              }
            }
          }
        }
      }
      
      if (textAttributes.length === 0) {
        return { 
          results: [], 
          message: 'No text attributes found in the provided traces'
        };
      }
      
      // Group attributes by key
      const attributesByKey: Record<string, Array<{
        traceId: string;
        spanId?: string;
        value: string;
      }>> = {};
      
      for (const attr of textAttributes) {
        if (!attributesByKey[attr.key]) {
          attributesByKey[attr.key] = [];
        }
        
        attributesByKey[attr.key].push({
          traceId: attr.traceId,
          spanId: attr.spanId,
          value: attr.value
        });
      }
      
      // Process each attribute key
      const results: Record<string, any> = {};
      
      for (const [key, attributes] of Object.entries(attributesByKey)) {
        const keyResults: any = {
          count: attributes.length,
          uniqueValues: new Set(attributes.map(attr => attr.value)).size
        };
        
        // Analyze sentiment if requested
        if (analyzeSentiment) {
          keyResults.sentiment = await this.analyzeSentiment(client, key, attributes);
        }
        
        // Extract entities if requested
        if (extractEntities) {
          keyResults.entities = await this.extractEntities(client, key, attributes);
        }
        
        results[key] = keyResults;
      }
      
      return {
        results,
        summary: {
          traceCount: traces.length,
          attributeKeyCount: Object.keys(results).length,
          totalAttributes: textAttributes.length
        },
        message: `Analyzed ${textAttributes.length} text attributes from ${traces.length} traces`
      };
    } catch (error: any) {
      logger.error('[TraceAttributeAnalysis] Error analyzing trace attributes', { error });
      return { 
        results: [], 
        error: error.message || String(error),
        message: 'Failed to analyze trace attributes'
      };
    }
  }
  
  /**
   * Analyze sentiment of attribute values
   * @param client The OpenSearch client to use for requests
   * @param key Attribute key
   * @param attributes Array of attribute values
   */
  private static async analyzeSentiment(
    client: TracesAdapterCore,
    key: string,
    attributes: Array<{
      traceId: string;
      spanId?: string;
      value: string;
    }>
  ): Promise<any> {
    logger.info('[TraceAttributeAnalysis] Analyzing sentiment for attribute', { 
      key, 
      attributeCount: attributes.length 
    });
    
    try {
      // Use OpenSearch's NLP sentiment analysis
      const nlpEndpoint = '/_plugins/_ml/nlp/sentiment';
      
      // Process in batches to avoid overwhelming the API
      const batchSize = 50;
      const results: Array<{
        traceId: string;
        spanId?: string;
        value: string;
        sentiment: string;
        sentimentScore: number;
      }> = [];
      
      for (let i = 0; i < attributes.length; i += batchSize) {
        const batch = attributes.slice(i, i + batchSize);
        const batchRequests = batch.map(attr => ({
          text: attr.value
        }));
        
        const batchResults = await Promise.all(
          batchRequests.map(req => client.request('POST', nlpEndpoint, req))
        );
        
        for (let j = 0; j < batchResults.length; j++) {
          const result = batchResults[j];
          const attrIndex = i + j;
          
          if (attrIndex < attributes.length) {
            results.push({
              ...attributes[attrIndex],
              sentiment: result.sentiment,
              sentimentScore: result.sentiment_score
            });
          }
        }
      }
      
      // Group by sentiment
      const sentimentGroups: Record<string, any[]> = {
        positive: [],
        negative: [],
        neutral: []
      };
      
      for (const result of results) {
        sentimentGroups[result.sentiment].push(result);
      }
      
      // Calculate sentiment statistics
      const sentimentStats = {
        positive: sentimentGroups.positive.length,
        negative: sentimentGroups.negative.length,
        neutral: sentimentGroups.neutral.length,
        total: results.length,
        negativityRatio: results.length > 0 ? sentimentGroups.negative.length / results.length : 0
      };
      
      return {
        results,
        sentimentGroups,
        stats: sentimentStats
      };
    } catch (error: any) {
      logger.error('[TraceAttributeAnalysis] Error analyzing sentiment', { error, key });
      return { 
        error: error.message || String(error)
      };
    }
  }
  
  /**
   * Extract entities from attribute values
   * @param client The OpenSearch client to use for requests
   * @param key Attribute key
   * @param attributes Array of attribute values
   */
  private static async extractEntities(
    client: TracesAdapterCore,
    key: string,
    attributes: Array<{
      traceId: string;
      spanId?: string;
      value: string;
    }>
  ): Promise<any> {
    logger.info('[TraceAttributeAnalysis] Extracting entities for attribute', { 
      key, 
      attributeCount: attributes.length 
    });
    
    try {
      // Use OpenSearch's NLP entity recognition
      const nerEndpoint = '/_plugins/_ml/nlp/ner';
      
      // Process in batches to avoid overwhelming the API
      const batchSize = 50;
      const results: Array<{
        traceId: string;
        spanId?: string;
        value: string;
        entities: Array<{
          text: string;
          type: string;
          score: number;
          beginOffset: number;
          endOffset: number;
        }>;
      }> = [];
      
      for (let i = 0; i < attributes.length; i += batchSize) {
        const batch = attributes.slice(i, i + batchSize);
        const batchRequests = batch.map(attr => ({
          text: attr.value,
          model_id: 'dslim/bert-base-NER' // Standard NER model
        }));
        
        const batchResults = await Promise.all(
          batchRequests.map(req => client.request('POST', nerEndpoint, req))
        );
        
        for (let j = 0; j < batchResults.length; j++) {
          const result = batchResults[j];
          const attrIndex = i + j;
          
          if (attrIndex < attributes.length) {
            results.push({
              ...attributes[attrIndex],
              entities: result.entities || []
            });
          }
        }
      }
      
      // Group entities by type
      const entityTypes: Record<string, Array<{
        text: string;
        score: number;
        count: number;
      }>> = {};
      
      for (const result of results) {
        for (const entity of result.entities) {
          if (!entityTypes[entity.type]) {
            entityTypes[entity.type] = [];
          }
          
          // Check if this entity text already exists
          const existingEntity = entityTypes[entity.type].find(e => e.text === entity.text);
          
          if (existingEntity) {
            existingEntity.count++;
            existingEntity.score = (existingEntity.score + entity.score) / 2; // Average score
          } else {
            entityTypes[entity.type].push({
              text: entity.text,
              score: entity.score,
              count: 1
            });
          }
        }
      }
      
      // Sort entities by count (descending)
      for (const type in entityTypes) {
        entityTypes[type].sort((a, b) => b.count - a.count);
      }
      
      // Calculate entity statistics
      const entityStats = {
        totalEntities: results.reduce((sum, result) => sum + result.entities.length, 0),
        uniqueEntities: Object.values(entityTypes).reduce((sum, entities) => sum + entities.length, 0),
        typeCount: Object.keys(entityTypes).length
      };
      
      return {
        results,
        entityTypes,
        stats: entityStats
      };
    } catch (error: any) {
      logger.error('[TraceAttributeAnalysis] Error extracting entities', { error, key });
      return { 
        error: error.message || String(error)
      };
    }
  }
  
  /**
   * Classify trace attributes into categories
   * @param client The OpenSearch client to use for requests
   * @param attributeKey The attribute key to classify
   * @param startTime The start time for the analysis window
   * @param endTime The end time for the analysis window
   * @param options Additional options for classification
   */
  public static async classifyTraceAttributes(
    client: TracesAdapterCore,
    attributeKey: string,
    startTime: string,
    endTime: string,
    options: {
      service?: string;
      categories?: string[];
      maxResults?: number;
    } = {}
  ): Promise<any> {
    logger.info('[TraceAttributeAnalysis] Classifying trace attributes', { 
      attributeKey, 
      startTime, 
      endTime, 
      options 
    });
    
    try {
      // Default options
      const categories = options.categories || ['error', 'warning', 'info', 'debug'];
      const maxResults = options.maxResults || 1000;
      
      // First, get traces with the specified attribute
      const indexPattern = 'traces-*';
      const tracesQuery: any = {
        query: {
          bool: {
            filter: [
              {
                range: {
                  'start_time': {
                    gte: startTime,
                    lte: endTime
                  }
                }
              },
              {
                exists: {
                  field: `attributes.${attributeKey}`
                }
              }
            ]
          }
        },
        size: maxResults,
        _source: ['trace_id', `attributes.${attributeKey}`]
      };
      
      // Add service filter if specified
      if (options.service) {
        tracesQuery.query.bool.filter.push({
          term: {
            'service.name': options.service
          }
        });
      }
      
      const tracesResponse = await client.request('POST', `/${indexPattern}/_search`, tracesQuery);
      
      if (!tracesResponse.hits || !tracesResponse.hits.hits || tracesResponse.hits.hits.length === 0) {
        return { 
          classifications: [], 
          message: `No traces found with attribute ${attributeKey} in the specified time range`
        };
      }
      
      // Extract attribute values
      const attributeValues: Array<{
        traceId: string;
        value: string;
      }> = [];
      
      for (const hit of tracesResponse.hits.hits) {
        const source = hit._source;
        const value = source.attributes?.[attributeKey];
        
        if (value && typeof value === 'string') {
          attributeValues.push({
            traceId: source.trace_id,
            value
          });
        }
      }
      
      if (attributeValues.length === 0) {
        return { 
          classifications: [], 
          message: `No string values found for attribute ${attributeKey}`
        };
      }
      
      // Use OpenSearch's NLP text classification
      const classificationEndpoint = '/_plugins/_ml/nlp/text_classification';
      
      // Process in batches to avoid overwhelming the API
      const batchSize = 50;
      const classifications: Array<{
        traceId: string;
        value: string;
        category: string;
        score: number;
      }> = [];
      
      for (let i = 0; i < attributeValues.length; i += batchSize) {
        const batch = attributeValues.slice(i, i + batchSize);
        const batchRequests = batch.map(attr => ({
          text: attr.value,
          categories
        }));
        
        const batchResults = await Promise.all(
          batchRequests.map(req => client.request('POST', classificationEndpoint, req))
        );
        
        for (let j = 0; j < batchResults.length; j++) {
          const result = batchResults[j];
          const attrIndex = i + j;
          
          if (attrIndex < attributeValues.length && result.classifications) {
            // Get the top classification
            const topClassification = result.classifications[0];
            
            classifications.push({
              ...attributeValues[attrIndex],
              category: topClassification.category,
              score: topClassification.score
            });
          }
        }
      }
      
      // Group by category
      const categoryGroups: Record<string, Array<{
        traceId: string;
        value: string;
        score: number;
      }>> = {};
      
      for (const classification of classifications) {
        if (!categoryGroups[classification.category]) {
          categoryGroups[classification.category] = [];
        }
        
        categoryGroups[classification.category].push({
          traceId: classification.traceId,
          value: classification.value,
          score: classification.score
        });
      }
      
      // Calculate category statistics
      const categoryStats = Object.entries(categoryGroups).map(([category, items]) => ({
        category,
        count: items.length,
        percentage: items.length / classifications.length,
        avgScore: items.reduce((sum, item) => sum + item.score, 0) / items.length
      }));
      
      // Sort by count (descending)
      categoryStats.sort((a, b) => b.count - a.count);
      
      return {
        attributeKey,
        classifications,
        categoryGroups,
        categoryStats,
        summary: {
          totalAttributes: attributeValues.length,
          classifiedAttributes: classifications.length,
          categoryCount: Object.keys(categoryGroups).length
        },
        message: `Classified ${classifications.length} values of attribute ${attributeKey}`
      };
    } catch (error: any) {
      logger.error('[TraceAttributeAnalysis] Error classifying trace attributes', { error, attributeKey });
      return { 
        classifications: [], 
        error: error.message || String(error),
        message: `Failed to classify attribute ${attributeKey}`
      };
    }
  }
}
