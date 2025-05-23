import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { logger } from '../../utils/logger.js';
import { MetricAnomalyOptions, MetricAnomaly } from './types.js';

/**
 * Handles detection of anomalies in metrics data
 */
export class MetricAnomalyDetector {
  constructor(private esAdapter: ElasticsearchAdapter) {}

  /**
   * Find potential metric fields by examining sample data
   */
  private async findPotentialMetricFields(must: any[]): Promise<Set<string>> {
    // First, get a sample of metrics to identify fields
    const sampleQuery = {
      size: 100,
      query: { bool: { must } },
      _source: ['*']
    };
    
    const potentialMetricFields = new Set<string>();
    
    try {
      const sampleResp = await this.esAdapter.queryMetrics(sampleQuery);
      const samples = sampleResp.hits?.hits || [];
      
      if (samples.length === 0) {
        logger.warn('[Metric Anomaly] No metrics found in the specified time range');
        return potentialMetricFields;
      }
      
      logger.info(`[Metric Anomaly] Found ${samples.length} metric samples for field detection`);
      
      // Process each sample to find numeric fields
      samples.forEach((hit: any) => {
        const source = hit._source || {};
        this.findNumericFields(source, '', potentialMetricFields);
      });
      
      logger.info(`[Metric Anomaly] Found ${potentialMetricFields.size} potential metric fields`);
    } catch (error) {
      logger.error('[Metric Anomaly] Error in metric field detection', { error });
    }
    
    return potentialMetricFields;
  }
  
  /**
   * Recursively find numeric fields in nested objects
   */
  private findNumericFields(obj: any, path: string, potentialMetricFields: Set<string>): void {
    if (!obj || typeof obj !== 'object') return;
    
    Object.entries(obj).forEach(([key, value]) => {
      const fullPath = path ? `${path}.${key}` : key;
      
      // Skip timestamp and ID fields
      if (fullPath.includes('timestamp') || fullPath.includes('id') || fullPath.includes('time')) {
        return;
      }
      
      // If it's a number, add it as a potential metric field
      if (typeof value === 'number') {
        potentialMetricFields.add(fullPath);
      }
      // If it's an object, recursively search it
      else if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.findNumericFields(value, fullPath, potentialMetricFields);
      }
    });
  }

  /**
   * Main method to detect anomalies in metrics
   */
  async detectAnomalies(
    startTime: string, 
    endTime: string, 
    metricField?: string,
    serviceOrServices?: string | string[], 
    options: MetricAnomalyOptions = {}
  ): Promise<any> {
    try {
      // Set default options
      const {
        zScoreThreshold = 3,
        percentileThreshold = 95,
        iqrMultiplier = 1.5,
        changeThreshold = 50,
        interval = '1m',
        maxResults = 100
      } = options;

      // 1. Get time series buckets for the metric
      const must: any[] = [
        { range: { '@timestamp': { gte: startTime, lte: endTime } } }
      ];
      
      // Add metric field filter if provided
      if (metricField) {
        must.push({ exists: { field: metricField } });
      }
      
      // Add service filter - support both single service and array of services
      if (serviceOrServices) {
        if (Array.isArray(serviceOrServices) && serviceOrServices.length > 0) {
          // Handle array of services
          const serviceTerms: any[] = [];
          
          // For each service, create terms for all possible field names
          serviceOrServices.forEach(service => {
            if (service && service.trim() !== '') {
              serviceTerms.push({ term: { 'Resource.service.name': service } });
              serviceTerms.push({ term: { 'resource.attributes.service.name': service } });
              serviceTerms.push({ term: { 'service.name': service } });
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
                { term: { 'Resource.service.name': service } },
                { term: { 'resource.attributes.service.name': service } },
                { term: { 'service.name': service } }
              ],
              minimum_should_match: 1
            }
          });
        }
      }
      
      // If no specific metric field is provided, we need to identify common metric fields
      if (!metricField) {
        logger.info('[Metric Anomaly] No specific metric field provided, identifying potential fields');
        
        try {
          // Try to use the schema to get metric fields
          const metricFields = await this.esAdapter.listMetricFields();
          logger.info(`[Metric Anomaly] Found ${metricFields.length} metric fields from schema`);
          
          // If we found fields from schema, use them
          if (metricFields.length > 0) {
            // Filter to numeric fields only
            const numericFields = metricFields.filter((field: any) => {
              return field.type === 'long' || field.type === 'integer' || 
                     field.type === 'float' || field.type === 'double' || 
                     field.type === 'number';
            });
            
            logger.info(`[Metric Anomaly] Found ${numericFields.length} numeric metric fields`);
            
            // Extract the field names
            const potentialMetricFields = new Set<string>();
            numericFields.forEach((field: any) => potentialMetricFields.add(field.name));
            
            // If no potential metric fields found, try the fallback approach
            if (potentialMetricFields.size === 0) {
              logger.info('[Metric Anomaly] No numeric fields found from schema, using fallback approach');
              const fields = await this.findPotentialMetricFields(must);
              fields.forEach(field => potentialMetricFields.add(field));
            }
            
            // If still no potential metric fields found, return empty result
            if (potentialMetricFields.size === 0) {
              return { message: 'No numeric metric fields found in the data' };
            }
            
            return Array.from(potentialMetricFields);
          } else {
            // If no fields found from schema, use the fallback approach
            logger.info('[Metric Anomaly] No fields found from schema, using fallback approach');
            const potentialMetricFields = await this.findPotentialMetricFields(must);
            
            // If no potential metric fields found, return empty result
            if (potentialMetricFields.size === 0) {
              return { message: 'No numeric metric fields found in the data' };
            }
            
            return Array.from(potentialMetricFields);
          }
        } catch (error) {
          logger.error('[Metric Anomaly] Error getting metric fields from schema', { error });
          
          // Fallback to the direct approach if schema access fails
          const potentialMetricFields = await this.findPotentialMetricFields(must);
          
          // If no potential metric fields found, return empty result
          if (potentialMetricFields.size === 0) {
            return { message: 'No numeric metric fields found in the data' };
          }
          
          return Array.from(potentialMetricFields);
        }
      }
      
      // Analyze the specific metric field for anomalies
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
              metric_value: {
                avg: { field: metricField }
              }
            }
          },
          overall_stats: {
            stats: { field: metricField }
          },
          percentiles: {
            percentiles: {
              field: metricField,
              percents: [25, 50, 75, 95, 99]
            }
          }
        }
      };
      
      const aggResp = await this.esAdapter.queryMetrics(aggQuery);
      const buckets = aggResp.aggregations?.time_buckets?.buckets || [];
      const stats = aggResp.aggregations?.overall_stats || {};
      const percentiles = aggResp.aggregations?.percentiles?.values || {};
      
      if (buckets.length === 0) {
        return { message: `No data found for metric field: ${metricField}` };
      }
      
      // Calculate statistics for anomaly detection
      const mean = stats.avg || 0;
      const stdDev = stats.std_deviation || 0;
      const q1 = percentiles['25.0'] || 0;
      const q3 = percentiles['75.0'] || 0;
      const iqr = q3 - q1;
      const iqrLower = q1 - (iqrMultiplier * iqr);
      const iqrUpper = q3 + (iqrMultiplier * iqr);
      
      // Calculate Z-score thresholds
      const zScoreLower = mean - (zScoreThreshold * stdDev);
      const zScoreUpper = mean + (zScoreThreshold * stdDev);
      
      // Get percentile threshold value
      const percentileThresholdValue = percentiles[`${percentileThreshold}.0`] || 0;
      
      // Prepare for rate of change detection
      let prevValue: number | null = null;
      
      // Detect anomalies in each bucket
      const anomalies: MetricAnomaly[] = [];
      
      buckets.forEach((bucket: any, index: number) => {
        const timestamp = bucket.key_as_string;
        const value = bucket.metric_value?.value;
        
        if (value === null || value === undefined) {
          return; // Skip buckets with no value
        }
        
        // Store anomaly detection results
        const anomalyInfo: any = {
          timestamp,
          value,
          metricField,
          service: typeof serviceOrServices === 'string' ? serviceOrServices : undefined
        };
        
        // 1. Absolute threshold detection
        if (options.absoluteThreshold !== undefined) {
          if (value > options.absoluteThreshold) {
            anomalies.push({
              ...anomalyInfo,
              threshold: options.absoluteThreshold,
              detectionMethod: 'absolute_threshold'
            });
          }
        }
        
        // 2. Z-score detection
        const zScore = stdDev !== 0 ? (value - mean) / stdDev : 0;
        if (Math.abs(zScore) > zScoreThreshold) {
          anomalies.push({
            ...anomalyInfo,
            zScore,
            expectedValue: mean,
            deviation: value - mean,
            threshold: zScoreThreshold,
            detectionMethod: 'z_score'
          });
        }
        
        // 3. Percentile-based detection
        if (value > percentileThresholdValue) {
          anomalies.push({
            ...anomalyInfo,
            percentile: percentileThreshold,
            threshold: percentileThresholdValue,
            detectionMethod: 'percentile'
          });
        }
        
        // 4. IQR detection
        if (value < iqrLower || value > iqrUpper) {
          anomalies.push({
            ...anomalyInfo,
            expectedValue: mean,
            deviation: value - mean,
            threshold: value > iqrUpper ? iqrUpper : iqrLower,
            detectionMethod: 'iqr'
          });
        }
        
        // 5. Rate of change detection
        if (prevValue !== null) {
          const change = prevValue !== 0 ? ((value - prevValue) / Math.abs(prevValue)) * 100 : 0;
          
          if (Math.abs(change) > changeThreshold) {
            anomalies.push({
              ...anomalyInfo,
              changeRate: change,
              threshold: changeThreshold,
              detectionMethod: 'rate_of_change'
            });
          }
        }
        
        prevValue = value;
      });
      
      // Limit the number of results
      const limitedAnomalies = anomalies.slice(0, maxResults);
      
      return {
        metricField,
        service: typeof serviceOrServices === 'string' ? serviceOrServices : undefined,
        totalAnomalies: anomalies.length,
        anomalies: limitedAnomalies,
        stats: {
          mean,
          stdDev,
          min: stats.min,
          max: stats.max,
          count: stats.count,
          q1,
          median: percentiles['50.0'],
          q3,
          p95: percentiles['95.0'],
          p99: percentiles['99.0']
        },
        thresholds: {
          zScoreLower,
          zScoreUpper,
          iqrLower,
          iqrUpper,
          percentileThreshold: percentileThresholdValue,
          absoluteThreshold: options.absoluteThreshold,
          changeThreshold
        }
      };
    } catch (error) {
      logger.error('[Metric Anomaly] Error detecting anomalies', { error });
      return { error: 'Error detecting anomalies', details: String(error) };
    }
  }
}
