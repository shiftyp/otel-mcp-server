import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { logger } from '../../utils/logger.js';
import { LogAnomalyOptions, ClusteringAnomaly } from './types.js';

/**
 * Detector for clustering-based anomalies in logs
 * Identifies unusual clusters and cardinality changes
 */
export class ClusteringDetector {
  constructor(private esAdapter: ElasticsearchAdapter) {}

  /**
   * Detect clustering-based anomalies in logs
   */
  async detectAnomalies(
    startTime: string, 
    endTime: string, 
    serviceOrServices?: string | string[],
    options: LogAnomalyOptions = {}
  ): Promise<ClusteringAnomaly[]> {
    logger.info('[ClusteringDetector] Detecting clustering anomalies', { startTime, endTime });
    
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
      
      // Identify fields to analyze for cardinality
      const cardinalityFields = [
        'service.name',
        'level',
        'host.name',
        'container.id',
        'kubernetes.pod.name',
        'kubernetes.namespace',
        'http.method',
        'http.status_code',
        'db.operation',
        'error.type'
      ];
      
      // Analyze cardinality changes
      const anomalies: ClusteringAnomaly[] = [];
      
      for (const field of cardinalityFields) {
        // Query for cardinality over time
        const cardinalityQuery = {
          size: 0,
          query: { bool: { must } },
          aggs: {
            time_buckets: {
              date_histogram: {
                field: '@timestamp',
                fixed_interval: interval
              },
              aggs: {
                distinct_values: {
                  cardinality: {
                    field
                  }
                },
                top_values: {
                  terms: {
                    field,
                    size: 10
                  }
                }
              }
            }
          }
        };
        
        const cardinalityResp = await this.esAdapter.queryLogs(cardinalityQuery);
        const buckets = cardinalityResp.aggregations?.time_buckets?.buckets || [];
        
        if (buckets.length === 0) continue;
        
        // Separate baseline and analysis periods
        const baselineCutoff = new Date(startTime).getTime();
        const baselineBuckets = buckets.filter((b: any) => new Date(b.key_as_string).getTime() < baselineCutoff);
        const analysisBuckets = buckets.filter((b: any) => new Date(b.key_as_string).getTime() >= baselineCutoff);
        
        if (baselineBuckets.length === 0) continue;
        
        // Calculate baseline statistics
        const baselineCardinalities = baselineBuckets.map((b: any) => b.distinct_values?.value || 0);
        const baselineMean = this.calculateMean(baselineCardinalities);
        const baselineStdDev = this.calculateStdDev(baselineCardinalities, baselineMean);
        
        // Detect anomalies for this field
        for (const bucket of analysisBuckets) {
          const cardinality = bucket.distinct_values?.value || 0;
          const timestamp = bucket.key_as_string;
          const topValues = bucket.top_values?.buckets || [];
          
          // Skip if no values
          if (cardinality === 0) continue;
          
          // Calculate deviation
          const deviation = cardinality - baselineMean;
          const zScore = baselineStdDev > 0 ? deviation / baselineStdDev : 0;
          
          // Check if cardinality exceeds threshold
          if (Math.abs(zScore) > cardinalityThreshold) {
            // Get examples of logs for this time period
            // Define query with proper typing to allow both range and term queries
            const examplesQuery: {
              size: number;
              query: {
                bool: {
                  must: Array<{range?: any; term?: any}>;
                }
              };
              _source: string[];
            } = {
              size: 5,
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
              _source: ['message', 'level', 'service', 'service.name', field]
            };
            
            // Add service filter if provided
            if (serviceOrServices) {
              this.addServiceFilter(examplesQuery.query.bool.must, serviceOrServices);
            }
            
            // Add filter for the most frequent value if available
            if (topValues.length > 0) {
              examplesQuery.query.bool.must.push({
                term: { [field]: topValues[0].key }
              });
            }
            
            const examplesResp = await this.esAdapter.queryLogs(examplesQuery);
            const examples = examplesResp.hits?.hits || [];
            
            // Extract example messages and service information
            const exampleMessages = examples.map((hit: any) => hit._source.message || '').filter(Boolean);
            const services = examples.map((hit: any) => hit._source.service?.name || hit._source['service.name']).filter(Boolean);
            
            const serviceCounts: Record<string, number> = {};
            services.forEach((service: string) => {
              serviceCounts[service] = (serviceCounts[service] || 0) + 1;
            });
            
            const dominantService = Object.entries(serviceCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([service]) => service)[0];
            
            // Create cluster name based on field and top value
            const clusterName = topValues.length > 0
              ? `${field}=${topValues[0].key}`
              : field;
            
            anomalies.push({
              timestamp,
              cluster: clusterName,
              size: cardinality,
              expectedSize: baselineMean,
              deviation,
              service: dominantService,
              examples: exampleMessages,
              score: Math.abs(zScore)
            });
          }
        }
      }
      
      // Sort anomalies by score (descending)
      return anomalies.sort((a, b) => b.score - a.score);
    } catch (error) {
      logger.error('[ClusteringDetector] Error detecting clustering anomalies', { error });
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
