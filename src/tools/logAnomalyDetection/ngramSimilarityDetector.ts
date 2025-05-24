import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { logger } from '../../utils/logger.js';
import { LogAnomalyOptions } from './types.js';

/**
 * Interface for n-gram similarity anomalies in logs
 */
export interface NgramSimilarityAnomaly {
  timestamp: string;
  pattern: string;
  similarMessages: number;
  examples: string[];
  service?: string;
  level?: string;
  score: number;
}

/**
 * Detector for n-gram similarity-based anomalies in logs
 * Identifies groups of similar but not identical log messages that might indicate issues
 */
export class NgramSimilarityDetector {
  constructor(private esAdapter: ElasticsearchAdapter) {}

  /**
   * Detect n-gram similarity-based anomalies in logs
   */
  async detectAnomalies(
    startTime: string, 
    endTime: string, 
    serviceOrServices?: string | string[],
    options: LogAnomalyOptions = {}
  ): Promise<NgramSimilarityAnomaly[]> {
    logger.info('[NgramSimilarityDetector] Detecting n-gram similarity anomalies', { startTime, endTime });
    
    try {
      const {
        interval = '1h',
        spikeThreshold = 3,
        maxResults = 100,
        significancePValue = 0.05
      } = options;
      
      // Build query conditions
      const must: any[] = [
        { range: { '@timestamp': { gte: startTime, lte: endTime } } }
      ];
      
      // Add service filter if provided
      if (serviceOrServices) {
        this.addServiceFilter(must, serviceOrServices);
      }
      
      // First, get the most frequent terms in the message field
      // This helps us identify potential patterns to analyze
      const termsQuery = {
        size: 0,
        query: { bool: { must } },
        aggs: {
          message_terms: {
            significant_terms: {
              field: "Body.keyword",
              size: 20,
              min_doc_count: 5
            }
          }
        }
      };
      
      const termsResp = await this.esAdapter.queryLogs(termsQuery);
      const significantTerms = termsResp.aggregations?.message_terms?.buckets || [];
      
      if (significantTerms.length === 0) {
        logger.warn('[NgramSimilarityDetector] No significant terms found');
        return [];
      }
      
      const anomalies: NgramSimilarityAnomaly[] = [];
      
      // For each significant term, find similar messages using n-gram analysis
      for (const termBucket of significantTerms) {
        const term = termBucket.key;
        
        // Skip very short terms
        if (typeof term !== 'string' || term.length < 5) continue;
        
        // Skip terms that aren't statistically significant based on p-value
        if (termBucket.doc_count / termsResp.hits?.total?.value < significancePValue) continue;
        
        // Use fuzzy matching to find similar messages
        const fuzzyQuery = {
          size: maxResults > 100 ? 100 : maxResults,
          query: {
            bool: {
              must: [
                ...must,
                {
                  match: {
                    "Body": {
                      query: term,
                      fuzziness: "AUTO",
                      operator: "and"
                    }
                  }
                }
              ]
            }
          },
          _source: ["Body", "level", "Resource.service.name", "@timestamp"]
        };
        
        const fuzzyResp = await this.esAdapter.queryLogs(fuzzyQuery);
        const similarMessages = fuzzyResp.hits?.hits || [];
        
        if (similarMessages.length < 5) continue; // Skip if not enough similar messages
        
        // Extract messages and metadata
        const messages = similarMessages.map((hit: any) => hit._source.Body || '').filter(Boolean);
        const logLevels = similarMessages.map((hit: any) => 
          hit._source.level || hit._source['log.level']
        ).filter(Boolean);
        const services = similarMessages.map((hit: any) => 
          hit._source.Resource?.service?.name || hit._source['service.name']
        ).filter(Boolean);
        const timestamps = similarMessages.map((hit: any) => hit._source['@timestamp']).filter(Boolean);
        
        // Find dominant log level and service
        const levelCounts: Record<string, number> = {};
        logLevels.forEach((level: string) => {
          levelCounts[level] = (levelCounts[level] || 0) + 1;
        });
        
        const dominantLevel = Object.entries(levelCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([level]) => level)[0];
          
        const serviceCounts: Record<string, number> = {};
        services.forEach((service: string) => {
          serviceCounts[service] = (serviceCounts[service] || 0) + 1;
        });
        
        const dominantService = Object.entries(serviceCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([service]) => service)[0];
        
        // Calculate score based on number of similar messages and log level
        const score = similarMessages.length * 
          (dominantLevel === 'error' || dominantLevel === 'fatal' ? 1.5 : 
           dominantLevel === 'warn' || dominantLevel === 'warning' ? 1.2 : 1);
        
        // Get the most recent timestamp
        const latestTimestamp = timestamps.sort().pop() || endTime;
        
        // Add to anomalies
        anomalies.push({
          timestamp: latestTimestamp,
          pattern: term,
          similarMessages: similarMessages.length,
          examples: messages.slice(0, 5), // Include up to 5 example messages
          service: dominantService,
          level: dominantLevel,
          score
        });
      }
      
      // Sort anomalies by score (descending)
      return anomalies.sort((a, b) => b.score - a.score);
    } catch (error) {
      logger.error('[NgramSimilarityDetector] Error detecting n-gram similarity anomalies', { error });
      return [];
    }
  }
  
  /**
   * Add service filter to the query
   */
  private addServiceFilter(must: any[], serviceOrServices: string | string[]): void {
    if (Array.isArray(serviceOrServices) && serviceOrServices.length > 0) {
      // Handle array of services
      const serviceTerms: any[] = [];
      
      // For each service, create terms for all possible field names
      serviceOrServices.forEach(service => {
        if (service && service.trim() !== '') {
          serviceTerms.push({ term: { 'service.name': service } });
          serviceTerms.push({ term: { 'service': service } });
          serviceTerms.push({ term: { 'Resource.service.name': service } });
          serviceTerms.push({ term: { 'resource.attributes.service.name': service } });
        }
      });
      
      if (serviceTerms.length > 0) {
        must.push({
          bool: {
            should: serviceTerms,
            minimum_should_match: 1
          }
        });
      }
    } else if (typeof serviceOrServices === 'string' && serviceOrServices.trim() !== '') {
      // Handle single service
      const service = serviceOrServices;
      must.push({
        bool: {
          should: [
            { term: { 'service.name': service } },
            { term: { 'service': service } },
            { term: { 'Resource.service.name': service } },
            { term: { 'resource.attributes.service.name': service } }
          ],
          minimum_should_match: 1
        }
      });
    }
  }
}
