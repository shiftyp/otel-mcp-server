import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { logger } from '../../utils/logger.js';
import { LogAnomalyOptions, FrequencyAnomaly } from './types.js';

/**
 * Detector for frequency-based anomalies in logs
 * Identifies sudden spikes or drops in log volume
 */
export class FrequencyDetector {
  constructor(private esAdapter: ElasticsearchAdapter) {}

  /**
   * Detect frequency-based anomalies in logs
   */
  async detectAnomalies(
    startTime: string, 
    endTime: string, 
    serviceOrServices?: string | string[],
    options: LogAnomalyOptions = {}
  ): Promise<FrequencyAnomaly[]> {
    logger.info('[FrequencyDetector] Detecting frequency anomalies', { startTime, endTime });
    
    try {
      const {
        interval = '1h',
        spikeThreshold = 3,
        lookbackWindow = '7d'
      } = options;
      
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
      
      // Query for log frequency over time
      const aggQuery = {
        size: 0,
        query: { bool: { must } },
        aggs: {
          time_buckets: {
            date_histogram: {
              field: '@timestamp',
              fixed_interval: interval
            }
          },
          // Also aggregate by log level for additional context
          log_levels: {
            terms: {
              field: 'level',
              size: 10
            }
          }
        }
      };
      
      const aggResp = await this.esAdapter.queryLogs(aggQuery);
      const buckets = aggResp.aggregations?.time_buckets?.buckets || [];
      
      if (buckets.length === 0) {
        logger.warn('[FrequencyDetector] No logs found for the specified time range');
        return [];
      }
      
      // Separate baseline and analysis periods
      const baselineCutoff = new Date(startTime).getTime();
      const baselineBuckets = buckets.filter((b: any) => new Date(b.key_as_string).getTime() < baselineCutoff);
      const analysisBuckets = buckets.filter((b: any) => new Date(b.key_as_string).getTime() >= baselineCutoff);
      
      if (baselineBuckets.length === 0) {
        logger.warn('[FrequencyDetector] No baseline data available');
        return [];
      }
      
      // Calculate baseline statistics
      const baselineCounts = baselineBuckets.map((b: any) => b.doc_count);
      const baselineMean = this.calculateMean(baselineCounts);
      const baselineStdDev = this.calculateStdDev(baselineCounts, baselineMean);
      
      // Detect anomalies
      const anomalies: FrequencyAnomaly[] = [];
      
      for (const bucket of analysisBuckets) {
        const count = bucket.doc_count;
        const timestamp = bucket.key_as_string;
        
        // Calculate Z-score
        const zScore = baselineStdDev > 0 ? (count - baselineMean) / baselineStdDev : 0;
        
        // Check if count exceeds threshold
        if (Math.abs(zScore) > spikeThreshold || count > baselineMean * spikeThreshold) {
          // Get additional context for this time period
          const contextQuery = {
            size: 0,
            query: {
              bool: {
                must: [
                  { range: { '@timestamp': { 
                    gte: timestamp, 
                    lt: this.getNextIntervalTimestamp(timestamp, interval) 
                  } } }
                ]
              }
            },
            aggs: {
              log_levels: {
                terms: {
                  field: 'level',
                  size: 10
                }
              },
              services: {
                terms: {
                  field: 'service.name',
                  size: 10
                }
              }
            }
          };
          
          // Add service filter if provided
          if (serviceOrServices) {
            this.addServiceFilter(contextQuery.query.bool.must, serviceOrServices);
          }
          
          const contextResp = await this.esAdapter.queryLogs(contextQuery);
          const logLevels = contextResp.aggregations?.log_levels?.buckets || [];
          const services = contextResp.aggregations?.services?.buckets || [];
          
          // Find dominant log level and service
          const dominantLevel = logLevels.length > 0 ? logLevels[0].key : undefined;
          const dominantService = services.length > 0 ? services[0].key : undefined;
          
          anomalies.push({
            timestamp,
            count,
            expectedCount: baselineMean,
            deviation: count - baselineMean,
            level: dominantLevel,
            service: dominantService,
            score: Math.abs(zScore)
          });
        }
      }
      
      // Sort anomalies by score (descending)
      return anomalies.sort((a, b) => b.score - a.score);
    } catch (error) {
      logger.error('[FrequencyDetector] Error detecting frequency anomalies', { error });
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
