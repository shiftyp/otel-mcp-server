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
    logger.info('[FrequencyDetector] Detecting frequency anomalies', { startTime, endTime, options });
    
    try {
      const {
        interval = '30m',  // Default to 30-minute intervals
        spikeThreshold = 0.5,  // Lower threshold to detect more subtle anomalies
        lookbackWindow = '14d'  // Longer lookback to establish a better baseline
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
      
      // Determine if we're using a calendar interval (day, week, month, year) or fixed interval
      const isCalendarInterval = interval.endsWith('d') || interval.endsWith('w') || 
                                interval.endsWith('M') || interval.endsWith('y');
      
      // Create the aggregation query with the appropriate interval type
      const aggQuery = {
        size: 0,
        query: { bool: { must } },
        aggs: {
          time_buckets: {
            date_histogram: {
              field: '@timestamp',
              // Use calendar_interval for day/week/month/year, fixed_interval for hour/minute
              [isCalendarInterval ? 'calendar_interval' : 'fixed_interval']: interval
            }
          },
          log_levels: {
            terms: {
              field: 'SeverityText',
              size: 10
            }
          },
          services: {
            terms: {
              field: 'Resource.service.name',
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
        logger.warn('[FrequencyDetector] No baseline data available for the specified interval');
        return [];
      }
      
      // Calculate baseline statistics
      const baselineCounts = baselineBuckets.map((b: any) => b.doc_count);
      const baselineMean = this.calculateMean(baselineCounts);
      const baselineStdDev = this.calculateStdDev(baselineCounts, baselineMean);
      
      // Detect anomalies based on thresholds
      const anomalies: FrequencyAnomaly[] = [];
      
      // Check for both spikes and drops
      for (const bucket of analysisBuckets) {
        const count = bucket.doc_count;
        const timestamp = bucket.key_as_string;
        const date = new Date(timestamp);
        
        // Calculate z-score for this interval
        const zScore = (count - baselineMean) / (baselineStdDev || 1);
        const absZScore = Math.abs(zScore);
        
        // Detect both spikes and drops
        if (absZScore > spikeThreshold) {
          // Get additional context for this time period
          const contextQuery = {
            size: 0,
            query: {
              bool: {
                must: [
                  { range: { '@timestamp': { 
                    gte: timestamp, 
                    lt: isCalendarInterval ? 
                        this.getNextCalendarIntervalTimestamp(timestamp, interval) :
                        this.getNextIntervalTimestamp(timestamp, interval) 
                  } } }
                ]
              }
            },
            aggs: {
              log_levels: {
                terms: {
                  field: 'SeverityText',
                  size: 10
                }
              },
              services: {
                terms: {
                  field: 'Resource.service.name',
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
          
          const anomalyType = zScore > 0 ? 'spike' : 'drop';
          const deviation = Math.max(1.0, absZScore);
          
          // Format the message based on the interval type
          let message = '';
          if (interval.endsWith('d')) {
            message = `Daily log ${anomalyType}: ${count} logs on ${date.toDateString()} (expected ~${Math.round(baselineMean)}), z-score: ${zScore.toFixed(2)}`;
          } else if (interval.endsWith('w')) {
            message = `Weekly log ${anomalyType}: ${count} logs for week of ${date.toDateString()} (expected ~${Math.round(baselineMean)}), z-score: ${zScore.toFixed(2)}`;
          } else if (interval.endsWith('M')) {
            message = `Monthly log ${anomalyType}: ${count} logs for ${date.toLocaleString('default', { month: 'long', year: 'numeric' })} (expected ~${Math.round(baselineMean)}), z-score: ${zScore.toFixed(2)}`;
          } else {
            message = `Log frequency ${anomalyType}: ${count} logs at ${date.toLocaleString()} (expected ~${Math.round(baselineMean)}), z-score: ${zScore.toFixed(2)}`;
          }
          
          anomalies.push({
            timestamp,
            count,
            expectedCount: baselineMean,
            deviation: deviation,
            level: dominantLevel,
            service: dominantService,
            score: deviation,
            detectionMethod: 'z-score',
            type: anomalyType,
            message
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
   * Calculate the next calendar interval timestamp (day, week, month, year)
   */
  private getNextCalendarIntervalTimestamp(timestamp: string, interval: string): string {
    const date = new Date(timestamp);
    const unit = interval.slice(-1);
    const value = parseInt(interval.slice(0, -1)) || 1;
    
    switch (unit) {
      case 'd':
        date.setDate(date.getDate() + value);
        break;
      case 'w':
        date.setDate(date.getDate() + (value * 7));
        break;
      case 'M':
        date.setMonth(date.getMonth() + value);
        break;
      case 'y':
        date.setFullYear(date.getFullYear() + value);
        break;
      default:
        // Default to 1 day
        date.setDate(date.getDate() + 1);
    }
    
    return date.toISOString();
  }
  
  /**
   * Calculate the next day's timestamp
   */
  private getNextDayTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    date.setDate(date.getDate() + 1);
    return date.toISOString();
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
      
      // For each service, create terms for the verified field names
      serviceOrServices.forEach(service => {
        if (service && service.trim() !== '') {
          // Based on our verification, Resource.service.name is the primary field
          serviceTerms.push({ term: { 'Resource.service.name': service } });
          // Include Attributes.otelServiceName as a fallback
          serviceTerms.push({ term: { 'Attributes.otelServiceName': service } });
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
            // Based on our verification, Resource.service.name is the primary field
            { term: { 'Resource.service.name': service } },
            // Include Attributes.otelServiceName as a fallback
            { term: { 'Attributes.otelServiceName': service } }
          ],
          minimum_should_match: 1
        }
      });
    }
  }
}
