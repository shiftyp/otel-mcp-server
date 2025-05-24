import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { logger } from '../../utils/logger.js';
import { LogAnomalyOptions } from './types.js';

/**
 * Interface for cardinality anomalies in logs
 */
export interface CardinalityAnomaly {
  timestamp: string;
  field: string;
  uniqueValues: number;
  expectedValues: number;
  deviation: number;
  service?: string;
  examples: string[];
  score: number;
}

/**
 * Detector for cardinality-based anomalies in logs
 * Identifies unusual increases in the number of unique values for specific fields
 */
export class CardinalityDetector {
  // Fields to monitor for cardinality anomalies
  private defaultCardinalityFields = [
    'Resource.service.name',
    'Attributes.http.status_code',
    'Attributes.error.type',
    'Attributes.exception.type',
    'Attributes.db.statement',
    'Attributes.http.url',
    'Attributes.http.target',
    'Attributes.http.route',
    'Attributes.net.peer.name',
    'Attributes.net.peer.ip'
  ];

  constructor(private esAdapter: ElasticsearchAdapter) {}

  /**
   * Detect cardinality-based anomalies in logs
   */
  async detectAnomalies(
    startTime: string, 
    endTime: string, 
    serviceOrServices?: string | string[],
    options: LogAnomalyOptions = {}
  ): Promise<CardinalityAnomaly[]> {
    logger.info('[CardinalityDetector] Detecting cardinality anomalies', { startTime, endTime });
    
    try {
      const {
        interval = '1h',
        cardinalityThreshold = 2,
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
      
      const anomalies: CardinalityAnomaly[] = [];
      
      // For each field, check for cardinality anomalies
      for (const field of this.defaultCardinalityFields) {
        // Query for field cardinality over time
        const aggQuery = {
          size: 0,
          query: { bool: { must } },
          aggs: {
            time_buckets: {
              date_histogram: {
                field: '@timestamp',
                fixed_interval: interval
              },
              aggs: {
                field_cardinality: {
                  cardinality: {
                    field: field
                  }
                }
              }
            }
          }
        };
        
        const aggResp = await this.esAdapter.queryLogs(aggQuery);
        const buckets = aggResp.aggregations?.time_buckets?.buckets || [];
        
        if (buckets.length === 0) {
          continue;
        }
        
        // Separate baseline and analysis periods
        const baselineCutoff = new Date(startTime).getTime();
        const baselineBuckets = buckets.filter((b: any) => new Date(b.key_as_string).getTime() < baselineCutoff);
        const analysisBuckets = buckets.filter((b: any) => new Date(b.key_as_string).getTime() >= baselineCutoff);
        
        if (baselineBuckets.length === 0) {
          continue;
        }
        
        // Calculate baseline statistics
        const baselineCardinalities = baselineBuckets.map((b: any) => b.field_cardinality?.value || 0);
        const baselineMean = this.calculateMean(baselineCardinalities);
        const baselineStdDev = this.calculateStdDev(baselineCardinalities, baselineMean);
        
        // Detect anomalies
        for (const bucket of analysisBuckets) {
          const cardinality = bucket.field_cardinality?.value || 0;
          const timestamp = bucket.key_as_string;
          
          // Skip if cardinality is very low
          if (cardinality < 3) continue;
          
          // Calculate Z-score
          const zScore = baselineStdDev > 0 ? (cardinality - baselineMean) / baselineStdDev : 0;
          
          // Check if cardinality exceeds threshold
          if (Math.abs(zScore) > 2 || cardinality > baselineMean * cardinalityThreshold) {
            // Get examples of this field's values for context
            const examplesQuery = {
              size: 0,
              query: {
                bool: {
                  must: [
                    { range: { '@timestamp': { 
                      gte: timestamp, 
                      lt: this.getNextIntervalTimestamp(timestamp, interval) 
                    } } },
                    { exists: { field } }
                  ]
                }
              },
              aggs: {
                field_values: {
                  terms: {
                    field: field,
                    size: 10
                  }
                },
                services: {
                  terms: {
                    field: 'Resource.service.name',
                    size: 5
                  }
                }
              }
            };
            
            // Add service filter if provided
            if (serviceOrServices) {
              this.addServiceFilter(examplesQuery.query.bool.must, serviceOrServices);
            }
            
            const examplesResp = await this.esAdapter.queryLogs(examplesQuery);
            const fieldValues = examplesResp.aggregations?.field_values?.buckets || [];
            const services = examplesResp.aggregations?.services?.buckets || [];
            
            // Extract example values and dominant service
            const exampleValues = fieldValues.map((bucket: any) => String(bucket.key));
            const dominantService = services.length > 0 ? String(services[0].key) : undefined;
            
            anomalies.push({
              timestamp,
              field,
              uniqueValues: cardinality,
              expectedValues: baselineMean,
              deviation: cardinality - baselineMean,
              service: dominantService,
              examples: exampleValues,
              score: Math.abs(zScore) * (field.includes('error') || field.includes('exception') ? 1.5 : 1)
            });
          }
        }
      }
      
      // Sort anomalies by score (descending)
      return anomalies.sort((a, b) => b.score - a.score);
    } catch (error) {
      logger.error('[CardinalityDetector] Error detecting cardinality anomalies', { error });
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
