import { logger } from '../../../utils/logger.js';

/**
 * NLP analysis for logs using OpenSearch's ML capabilities
 */
export class LogNLPAnalysis {
  /**
   * Analyze log sentiment using OpenSearch's NLP capabilities
   * @param client The OpenSearch client to use for requests
   * @param logs Array of log messages to analyze
   */
  public static async analyzeSentiment(
    client: any,
    logs: Array<{
      id: string;
      timestamp: string;
      message: string;
      service?: string;
      level?: string;
    }>
  ): Promise<any> {
    logger.info('[LogNLPAnalysis] Analyzing log sentiment', { 
      logCount: logs.length 
    });
    
    try {
      // Use OpenSearch's NLP sentiment analysis
      const nlpEndpoint = '/_plugins/_ml/nlp/sentiment';
      
      // Process in batches to avoid overwhelming the API
      const batchSize = 50;
      const results: Array<{
        id: string;
        timestamp: string;
        message: string;
        service?: string;
        level?: string;
        sentiment: string;
        sentimentScore: number;
      }> = [];
      
      for (let i = 0; i < logs.length; i += batchSize) {
        const batch = logs.slice(i, i + batchSize);
        const batchRequests = batch.map(log => ({
          text: log.message
        }));
        
        const batchResults = await Promise.all(
          batchRequests.map(req => client.request('POST', nlpEndpoint, req))
        );
        
        for (let j = 0; j < batchResults.length; j++) {
          const result = batchResults[j];
          const logIndex = i + j;
          
          if (logIndex < logs.length) {
            results.push({
              ...logs[logIndex],
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
      
      // Calculate sentiment statistics by service
      const serviceStats: Record<string, {
        positive: number;
        negative: number;
        neutral: number;
        total: number;
        negativityRatio: number;
      }> = {};
      
      for (const result of results) {
        const service = result.service || 'unknown';
        
        if (!serviceStats[service]) {
          serviceStats[service] = {
            positive: 0,
            negative: 0,
            neutral: 0,
            total: 0,
            negativityRatio: 0
          };
        }
        
        serviceStats[service][result.sentiment as keyof typeof serviceStats[typeof service]]++;
        serviceStats[service].total++;
      }
      
      // Calculate negativity ratios
      for (const [service, stats] of Object.entries(serviceStats)) {
        stats.negativityRatio = stats.total > 0 ? stats.negative / stats.total : 0;
      }
      
      // Sort services by negativity ratio (descending)
      const sortedServices = Object.entries(serviceStats)
        .sort(([, a], [, b]) => b.negativityRatio - a.negativityRatio)
        .map(([service, stats]) => ({
          service,
          ...stats
        }));
      
      return {
        results,
        sentimentGroups,
        serviceStats: sortedServices,
        summary: {
          positive: sentimentGroups.positive.length,
          negative: sentimentGroups.negative.length,
          neutral: sentimentGroups.neutral.length,
          total: results.length,
          negativityRatio: results.length > 0 ? sentimentGroups.negative.length / results.length : 0
        },
        message: `Analyzed sentiment for ${results.length} log messages`
      };
    } catch (error) {
      logger.error('[LogNLPAnalysis] Error analyzing log sentiment', { error });
      return { 
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to analyze log sentiment'
      };
    }
  }
  
  /**
   * Extract named entities from log messages using OpenSearch's NLP capabilities
   * @param client The OpenSearch client to use for requests
   * @param logs Array of log messages to analyze
   */
  public static async extractEntities(
    client: any,
    logs: Array<{
      id: string;
      timestamp: string;
      message: string;
      service?: string;
      level?: string;
    }>
  ): Promise<any> {
    logger.info('[LogNLPAnalysis] Extracting entities from logs', { 
      logCount: logs.length 
    });
    
    try {
      // Use OpenSearch's NLP entity recognition
      const nerEndpoint = '/_plugins/_ml/nlp/ner';
      
      // Process in batches to avoid overwhelming the API
      const batchSize = 50;
      const results: Array<{
        id: string;
        timestamp: string;
        message: string;
        service?: string;
        level?: string;
        entities: Array<{
          text: string;
          type: string;
          score: number;
          beginOffset: number;
          endOffset: number;
        }>;
      }> = [];
      
      for (let i = 0; i < logs.length; i += batchSize) {
        const batch = logs.slice(i, i + batchSize);
        const batchRequests = batch.map(log => ({
          text: log.message,
          model_id: 'dslim/bert-base-NER' // Standard NER model
        }));
        
        const batchResults = await Promise.all(
          batchRequests.map(req => client.request('POST', nerEndpoint, req))
        );
        
        for (let j = 0; j < batchResults.length; j++) {
          const result = batchResults[j];
          const logIndex = i + j;
          
          if (logIndex < logs.length) {
            results.push({
              ...logs[logIndex],
              entities: result.entities || []
            });
          }
        }
      }
      
      // Extract all unique entities
      const entityTypes = new Set<string>();
      const entityMap: Record<string, Set<string>> = {};
      
      for (const result of results) {
        for (const entity of result.entities) {
          entityTypes.add(entity.type);
          
          if (!entityMap[entity.type]) {
            entityMap[entity.type] = new Set<string>();
          }
          
          entityMap[entity.type].add(entity.text);
        }
      }
      
      // Convert entity maps to arrays
      const entities: Record<string, string[]> = {};
      for (const [type, values] of Object.entries(entityMap)) {
        entities[type] = Array.from(values);
      }
      
      // Count entities by type
      const entityCounts: Record<string, number> = {};
      for (const type of entityTypes) {
        entityCounts[type] = entityMap[type].size;
      }
      
      return {
        results,
        entities,
        entityCounts,
        entityTypes: Array.from(entityTypes),
        summary: {
          processedLogs: results.length,
          totalEntities: Object.values(entityCounts).reduce((sum, count) => sum + count, 0),
          uniqueEntityTypes: entityTypes.size
        },
        message: `Extracted entities from ${results.length} log messages`
      };
    } catch (error) {
      logger.error('[LogNLPAnalysis] Error extracting entities from logs', { error });
      return { 
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to extract entities from logs'
      };
    }
  }
  
  /**
   * Classify log messages into categories using OpenSearch's NLP capabilities
   * @param client The OpenSearch client to use for requests
   * @param logs Array of log messages to classify
   * @param categories Optional array of categories to classify into
   */
  public static async classifyLogs(
    client: any,
    logs: Array<{
      id: string;
      timestamp: string;
      message: string;
      service?: string;
      level?: string;
    }>,
    categories?: string[]
  ): Promise<any> {
    logger.info('[LogNLPAnalysis] Classifying logs', { 
      logCount: logs.length,
      categories 
    });
    
    try {
      // Default categories if not provided
      const defaultCategories = [
        'error',
        'warning',
        'info',
        'configuration',
        'security',
        'performance',
        'database',
        'network',
        'authentication',
        'authorization'
      ];
      
      const targetCategories = categories || defaultCategories;
      
      // Use OpenSearch's NLP text classification
      const classificationEndpoint = '/_plugins/_ml/nlp/classification';
      
      // Process in batches to avoid overwhelming the API
      const batchSize = 50;
      const results: Array<{
        id: string;
        timestamp: string;
        message: string;
        service?: string;
        level?: string;
        category: string;
        confidence: number;
      }> = [];
      
      for (let i = 0; i < logs.length; i += batchSize) {
        const batch = logs.slice(i, i + batchSize);
        
        // For each log, classify against all categories
        for (const log of batch) {
          // Create a request for each category
          const categoryScores: Record<string, number> = {};
          
          for (const category of targetCategories) {
            const classificationRequest = {
              text: log.message,
              labels: [category],
              model_id: 'distilbert-base-uncased' // Standard classification model
            };
            
            try {
              const response = await client.request('POST', classificationEndpoint, classificationRequest);
              if (response.classifications && response.classifications.length > 0) {
                categoryScores[category] = response.classifications[0].confidence || 0;
              } else {
                categoryScores[category] = 0;
              }
            } catch (error) {
              logger.warn('[LogNLPAnalysis] Error classifying log', { 
                error, 
                category,
                logId: log.id 
              });
              categoryScores[category] = 0;
            }
          }
          
          // Find the category with the highest confidence
          let bestCategory = targetCategories[0];
          let bestConfidence = categoryScores[bestCategory];
          
          for (const [category, confidence] of Object.entries(categoryScores)) {
            if (confidence > bestConfidence) {
              bestCategory = category;
              bestConfidence = confidence;
            }
          }
          
          results.push({
            ...log,
            category: bestCategory,
            confidence: bestConfidence
          });
        }
      }
      
      // Group by category
      const categoryGroups: Record<string, any[]> = {};
      for (const category of targetCategories) {
        categoryGroups[category] = [];
      }
      
      for (const result of results) {
        categoryGroups[result.category].push(result);
      }
      
      // Calculate category statistics by service
      const serviceStats: Record<string, Record<string, number>> = {};
      
      for (const result of results) {
        const service = result.service || 'unknown';
        
        if (!serviceStats[service]) {
          serviceStats[service] = {};
          for (const category of targetCategories) {
            serviceStats[service][category] = 0;
          }
          serviceStats[service].total = 0;
        }
        
        serviceStats[service][result.category]++;
        serviceStats[service].total++;
      }
      
      return {
        results,
        categoryGroups,
        serviceStats,
        categories: targetCategories,
        summary: {
          processedLogs: results.length,
          categoryCounts: Object.fromEntries(
            targetCategories.map(category => [
              category, 
              categoryGroups[category].length
            ])
          ),
          topCategory: targetCategories.reduce(
            (top, category) => categoryGroups[category].length > categoryGroups[top].length ? category : top,
            targetCategories[0]
          )
        },
        message: `Classified ${results.length} log messages into ${targetCategories.length} categories`
      };
    } catch (error) {
      logger.error('[LogNLPAnalysis] Error classifying logs', { error });
      return { 
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to classify logs'
      };
    }
  }
}
