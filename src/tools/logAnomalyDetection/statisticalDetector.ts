import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { logger } from '../../utils/logger.js';
import { LogAnomalyOptions, StatisticalAnomaly } from './types.js';

/**
 * Detector for statistical anomalies in logs
 * Identifies unusual field values using statistical methods
 */
export class StatisticalDetector {
  // Common numeric fields to analyze
  private commonNumericFields = [
    'duration', 'latency', 'responseTime', 'bytes', 'size',
    'count', 'value', 'memory', 'cpu', 'disk', 'network',
    'statusCode', 'status', 'code', 'retries', 'attempts'
  ];

  constructor(private esAdapter: ElasticsearchAdapter) {}

  /**
   * Detect statistical anomalies in logs
   */
  async detectAnomalies(
    startTime: string, 
    endTime: string, 
    serviceOrServices?: string | string[],
    options: LogAnomalyOptions = {}
  ): Promise<StatisticalAnomaly[]> {
    logger.info('[StatisticalDetector] Detecting statistical anomalies', { startTime, endTime });
    
    try {
      const {
        zScoreThreshold = 3,
        percentileThreshold = 95,
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
      
      // First, identify numeric fields in the logs
      const numericFields = await this.identifyNumericFields(must);
      
      if (numericFields.length === 0) {
        logger.warn('[StatisticalDetector] No numeric fields found for analysis');
        return [];
      }
      
      logger.info(`[StatisticalDetector] Analyzing ${numericFields.length} numeric fields`);
      
      // Analyze each numeric field
      const anomalies: StatisticalAnomaly[] = [];
      
      for (const field of numericFields) {
        // Get statistics for this field
        const statsQuery = {
          size: 0,
          query: { bool: { must } },
          aggs: {
            baseline_stats: {
              filter: {
                range: { '@timestamp': { gte: baselineStart, lt: startTime } }
              },
              aggs: {
                field_stats: {
                  stats: { field }
                },
                percentiles: {
                  percentiles: {
                    field,
                    percents: [percentileThreshold]
                  }
                }
              }
            },
            analysis_stats: {
              filter: {
                range: { '@timestamp': { gte: startTime, lte: endTime } }
              },
              aggs: {
                field_stats: {
                  stats: { field }
                }
              }
            }
          }
        };
        
        const statsResp = await this.esAdapter.queryLogs(statsQuery);
        const baselineStats = statsResp.aggregations?.baseline_stats?.field_stats;
        const baselinePercentile = statsResp.aggregations?.baseline_stats?.percentiles?.values?.[`${percentileThreshold}.0`];
        const analysisStats = statsResp.aggregations?.analysis_stats?.field_stats;
        
        if (!baselineStats || !analysisStats) continue;
        
        // Skip fields with insufficient data
        if (baselineStats.count < 10 || analysisStats.count < 5) continue;
        
        const baselineMean = baselineStats.avg;
        const baselineStdDev = baselineStats.std_deviation;
        const analysisMean = analysisStats.avg;
        
        // Skip fields with zero standard deviation
        if (baselineStdDev === 0) continue;
        
        // Calculate Z-score
        const zScore = (analysisMean - baselineMean) / baselineStdDev;
        
        // Check if field value exceeds threshold
        if (Math.abs(zScore) > zScoreThreshold || 
            (baselinePercentile && analysisMean > baselinePercentile)) {
          
          // Get examples of logs with extreme values
          const examplesQuery = {
            size: 5,
            query: {
              bool: {
                must: [
                  { range: { '@timestamp': { gte: startTime, lte: endTime } } },
                  { range: { [field]: { 
                    [zScore > 0 ? 'gte' : 'lte']: zScore > 0 
                      ? baselineMean + (zScoreThreshold * baselineStdDev)
                      : baselineMean - (zScoreThreshold * baselineStdDev)
                  } } }
                ]
              }
            },
            _source: ['message', 'level', 'service', 'service.name', field],
            sort: [{ [field]: zScore > 0 ? 'desc' : 'asc' }]
          };
          
          // Add service filter if provided
          if (serviceOrServices) {
            this.addServiceFilter(examplesQuery.query.bool.must, serviceOrServices);
          }
          
          const examplesResp = await this.esAdapter.queryLogs(examplesQuery);
          const examples = examplesResp.hits?.hits || [];
          
          if (examples.length === 0) continue;
          
          // Extract service information
          const services = examples.map((hit: any) => hit._source.service?.name || hit._source['service.name']).filter(Boolean);
          
          const serviceCounts: Record<string, number> = {};
          services.forEach((service: string) => {
            serviceCounts[service] = (serviceCounts[service] || 0) + 1;
          });
          
          const dominantService = Object.entries(serviceCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([service]) => service)[0];
          
          // Create anomaly
          anomalies.push({
            timestamp: new Date(startTime).toISOString(),
            field,
            value: analysisMean,
            expectedValue: baselineMean,
            deviation: analysisMean - baselineMean,
            zScore,
            percentile: baselinePercentile ? percentileThreshold : undefined,
            service: dominantService,
            score: Math.abs(zScore)
          });
        }
      }
      
      // Sort anomalies by score (descending)
      return anomalies.sort((a, b) => b.score - a.score);
    } catch (error) {
      logger.error('[StatisticalDetector] Error detecting statistical anomalies', { error });
      return [];
    }
  }
  
  /**
   * Identify numeric fields in the logs
   */
  private async identifyNumericFields(must: any[]): Promise<string[]> {
    try {
      // First try to get field mappings
      const mappingsQuery = {
        size: 0,
        query: { bool: { must } },
        aggs: {
          sample: {
            top_hits: {
              size: 10,
              _source: ['*']
            }
          }
        }
      };
      
      const mappingsResp = await this.esAdapter.queryLogs(mappingsQuery);
      const samples = mappingsResp.aggregations?.sample?.hits?.hits || [];
      
      if (samples.length === 0) {
        return [];
      }
      
      // Extract fields from samples
      const fields = new Set<string>();
      const numericFields = new Set<string>();
      
      // Process each sample to find fields
      samples.forEach((hit: any) => {
        const source = hit._source || {};
        this.extractFields('', source, fields);
      });
      
      // Check each field to see if it's numeric
      for (const field of fields) {
        // Skip common non-numeric fields
        if (field.includes('timestamp') || 
            field.includes('message') || 
            field.includes('level') || 
            field.includes('service')) {
          continue;
        }
        
        // Check if field is likely numeric based on common patterns
        if (this.commonNumericFields.some(pattern => 
          field.toLowerCase().includes(pattern.toLowerCase()))) {
          numericFields.add(field);
          continue;
        }
        
        // Verify by checking a sample
        const sampleQuery = {
          size: 1,
          query: { 
            bool: { 
              must: [
                ...must,
                { exists: { field } }
              ] 
            } 
          },
          _source: [field]
        };
        
        const sampleResp = await this.esAdapter.queryLogs(sampleQuery);
        const sample = sampleResp.hits?.hits?.[0]?._source;
        
        if (sample) {
          const value = this.getNestedValue(sample, field);
          if (typeof value === 'number') {
            numericFields.add(field);
          }
        }
      }
      
      return Array.from(numericFields);
    } catch (error) {
      logger.error('[StatisticalDetector] Error identifying numeric fields', { error });
      return [];
    }
  }
  
  /**
   * Extract fields from an object recursively
   */
  private extractFields(prefix: string, obj: any, fields: Set<string>): void {
    if (!obj || typeof obj !== 'object') return;
    
    Object.entries(obj).forEach(([key, value]) => {
      const fieldName = prefix ? `${prefix}.${key}` : key;
      fields.add(fieldName);
      
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.extractFields(fieldName, value, fields);
      }
    });
  }
  
  /**
   * Get a nested value from an object using a dotted path
   */
  private getNestedValue(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;
    
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = current[part];
    }
    
    return current;
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
