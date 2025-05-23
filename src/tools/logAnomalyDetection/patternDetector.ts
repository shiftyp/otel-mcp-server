import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { logger } from '../../utils/logger.js';
import { LogAnomalyOptions, PatternAnomaly } from './types.js';

/**
 * Detector for pattern-based anomalies in logs
 * Identifies unusual error patterns and message content
 */
export class PatternDetector {
  // Default error patterns to detect
  private defaultPatterns = [
    'error', 'exception', 'fail', 'failed', 'failure', 'fatal',
    'crash', 'critical', 'warn', 'warning', 'timeout', 'timed out',
    'unavailable', 'unable to', 'cannot', 'not found', 'undefined',
    'null', 'NaN', 'segmentation fault', 'core dumped',
    'out of memory', 'stack trace', 'deadlock', 'race condition',
    'invalid', 'unauthorized', 'forbidden', 'denied', 'rejected'
  ];

  constructor(private esAdapter: ElasticsearchAdapter) {}

  /**
   * Detect pattern-based anomalies in logs
   */
  async detectAnomalies(
    startTime: string, 
    endTime: string, 
    serviceOrServices?: string | string[],
    options: LogAnomalyOptions = {}
  ): Promise<PatternAnomaly[]> {
    logger.info('[PatternDetector] Detecting pattern anomalies', { startTime, endTime });
    
    try {
      const {
        interval = '1h',
        spikeThreshold = 3,
        lookbackWindow = '7d',
        patternKeywords = [],
        includeDefaultPatterns = true
      } = options;
      
      // Combine custom patterns with defaults if requested
      const patterns = includeDefaultPatterns 
        ? [...this.defaultPatterns, ...patternKeywords]
        : patternKeywords;
        
      if (patterns.length === 0) {
        logger.warn('[PatternDetector] No patterns specified for detection');
        return [];
      }
      
      // Calculate baseline period
      const baselineStart = this.calculateBaselineStart(startTime, lookbackWindow);
      
      // Build query conditions
      const must: any[] = [
        { range: { '@timestamp': { gte: baselineStart, lte: endTime } } }
      ];
      
      // Add service filter if provided
      if (serviceOrServices) {
        this.addServiceFilter(must, serviceOrServices);
      }
      
      // Create pattern queries
      const patternQueries = patterns.map(pattern => ({
        query_string: {
          query: `message:*${pattern}*`,
          analyze_wildcard: true
        }
      }));
      
      // Query for pattern frequency over time
      const aggQuery = {
        size: 0,
        query: {
          bool: {
            must,
            should: patternQueries,
            minimum_should_match: 1
          }
        },
        aggs: {
          patterns: {
            filters: {
              filters: patterns.reduce((acc: Record<string, any>, pattern) => {
                acc[pattern] = {
                  query_string: {
                    query: `message:*${pattern}*`,
                    analyze_wildcard: true
                  }
                };
                return acc;
              }, {})
            },
            aggs: {
              over_time: {
                date_histogram: {
                  field: '@timestamp',
                  fixed_interval: interval
                }
              }
            }
          }
        }
      };
      
      const aggResp = await this.esAdapter.queryLogs(aggQuery);
      const patternBuckets = aggResp.aggregations?.patterns?.buckets || {};
      
      if (Object.keys(patternBuckets).length === 0) {
        logger.warn('[PatternDetector] No pattern matches found');
        return [];
      }
      
      // Process each pattern
      const anomalies: PatternAnomaly[] = [];
      
      for (const [pattern, bucket] of Object.entries(patternBuckets)) {
        const timeBuckets = bucket.over_time?.buckets || [];
        
        if (timeBuckets.length === 0) continue;
        
        // Separate baseline and analysis periods
        const baselineCutoff = new Date(startTime).getTime();
        const baselineBuckets = timeBuckets.filter((b: any) => new Date(b.key_as_string).getTime() < baselineCutoff);
        const analysisBuckets = timeBuckets.filter((b: any) => new Date(b.key_as_string).getTime() >= baselineCutoff);
        
        if (baselineBuckets.length === 0) continue;
        
        // Calculate baseline statistics
        const baselineCounts = baselineBuckets.map((b: any) => b.doc_count);
        const baselineMean = this.calculateMean(baselineCounts);
        const baselineStdDev = this.calculateStdDev(baselineCounts, baselineMean);
        
        // Detect anomalies for this pattern
        for (const bucket of analysisBuckets) {
          const count = bucket.doc_count;
          const timestamp = bucket.key_as_string;
          
          // Skip if no occurrences
          if (count === 0) continue;
          
          // Calculate Z-score
          const zScore = baselineStdDev > 0 ? (count - baselineMean) / baselineStdDev : 0;
          
          // Check if count exceeds threshold
          if (Math.abs(zScore) > spikeThreshold || count > baselineMean * spikeThreshold) {
            // Get examples of this pattern for context
            const examplesQuery = {
              size: 5,
              query: {
                bool: {
                  must: [
                    { range: { '@timestamp': { 
                      gte: timestamp, 
                      lt: this.getNextIntervalTimestamp(timestamp, interval) 
                    } } },
                    { query_string: {
                      query: `message:*${pattern}*`,
                      analyze_wildcard: true
                    } }
                  ]
                }
              },
              _source: ['message', 'level', 'service', 'service.name']
            };
            
            // Add service filter if provided
            if (serviceOrServices) {
              this.addServiceFilter(examplesQuery.query.bool.must, serviceOrServices);
            }
            
            const examplesResp = await this.esAdapter.queryLogs(examplesQuery);
            const examples = examplesResp.hits?.hits || [];
            
            // Extract example messages and dominant log level
            const exampleMessages = examples.map((hit: any) => hit._source.message || '').filter(Boolean);
            const logLevels = examples.map((hit: any) => hit._source.level || hit._source['log.level']).filter(Boolean);
            const services = examples.map((hit: any) => hit._source.service?.name || hit._source['service.name']).filter(Boolean);
            
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
            
            anomalies.push({
              timestamp,
              pattern,
              count,
              level: dominantLevel,
              service: dominantService,
              examples: exampleMessages,
              score: Math.abs(zScore) * (dominantLevel === 'error' || dominantLevel === 'fatal' ? 1.5 : 1)
            });
          }
        }
      }
      
      // Sort anomalies by score (descending)
      return anomalies.sort((a, b) => b.score - a.score);
    } catch (error) {
      logger.error('[PatternDetector] Error detecting pattern anomalies', { error });
      return [];
    }
  }
  
  /**
   * Calculate the start time for the baseline period
   */
  private calculateBaselineStart(startTime: string, lookbackWindow: string): string {
    const start = new Date(startTime);
    const lookbackUnit = lookbackWindow.slice(-1);
    const lookbackValue = parseInt(lookbackWindow.slice(0, -1));
    
    switch (lookbackUnit) {
      case 'd':
        start.setDate(start.getDate() - lookbackValue);
        break;
      case 'h':
        start.setHours(start.getHours() - lookbackValue);
        break;
      case 'm':
        start.setMinutes(start.getMinutes() - lookbackValue);
        break;
      default:
        // Default to 7 days
        start.setDate(start.getDate() - 7);
    }
    
    return start.toISOString();
  }
  
  /**
   * Calculate the next timestamp based on the interval
   */
  private getNextIntervalTimestamp(timestamp: string, interval: string): string {
    const date = new Date(timestamp);
    const intervalUnit = interval.slice(-1);
    const intervalValue = parseInt(interval.slice(0, -1));
    
    switch (intervalUnit) {
      case 'd':
        date.setDate(date.getDate() + intervalValue);
        break;
      case 'h':
        date.setHours(date.getHours() + intervalValue);
        break;
      case 'm':
        date.setMinutes(date.getMinutes() + intervalValue);
        break;
      default:
        // Default to 1 hour
        date.setHours(date.getHours() + 1);
    }
    
    return date.toISOString();
  }
  
  /**
   * Calculate mean of an array of numbers
   */
  private calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }
  
  /**
   * Calculate standard deviation of an array of numbers
   */
  private calculateStdDev(values: number[], mean: number): number {
    if (values.length <= 1) return 0;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / (values.length - 1);
    return Math.sqrt(variance);
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
