import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { logger } from '../../utils/logger.js';
import { MetricAnomalyOptions, MetricAnomaly } from './types.js';
import { MetricType } from '../otelMetrics.js';
import { GaugeAnomalyDetector } from './metricDetectors/gaugeDetector.js';
import { CounterAnomalyDetector } from './metricDetectors/counterDetector.js';
import { MonotonicCounterAnomalyDetector } from './metricDetectors/monotonicCounterDetector.js';
import { EnumAnomalyDetector } from './metricDetectors/enumDetector.js';

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
      
      logger.info(`[Metric Anomaly] Identified ${potentialMetricFields.size} potential metric fields`);
      return potentialMetricFields;
    } catch (error) {
      logger.error('[Metric Anomaly] Error finding potential metric fields', { error });
      return potentialMetricFields;
    }
  }

  /**
   * Recursively find numeric fields in an object
   */
  private findNumericFields(obj: any, prefix: string, fields: Set<string>): void {
    if (!obj || typeof obj !== 'object') return;
    
    for (const key in obj) {
      const value = obj[key];
      const fieldName = prefix ? `${prefix}.${key}` : key;
      
      if (typeof value === 'number') {
        fields.add(fieldName);
      } else if (Array.isArray(value)) {
        // Check if array contains numbers
        if (value.length > 0 && typeof value[0] === 'number') {
          fields.add(fieldName);
        } else {
          // Try to process array elements if they are objects
          value.forEach((item, index) => {
            if (item && typeof item === 'object') {
              this.findNumericFields(item, `${fieldName}[${index}]`, fields);
            }
          });
        }
      } else if (value && typeof value === 'object') {
        this.findNumericFields(value, fieldName, fields);
      }
    }
  }

  /**
   * Detect the type of a metric based on its behavior in a time series
   * @param metricField The metric field to analyze
   * @param timeSeriesData Time series data for the metric
   * @returns The detected metric type
   */
  private async detectMetricType(
    metricField: string,
    timeSeriesData: any[]
  ): Promise<MetricType> {
    try {
      if (timeSeriesData.length < 5) {
        logger.warn(`[Metric Anomaly] Not enough data points to determine metric type for: ${metricField}`);
        return MetricType.UNKNOWN;
      }

      // Extract values
      const values = timeSeriesData
        .map((bucket: any) => bucket.metric_value?.avg)
        .filter((value: any) => value !== null && value !== undefined);

      if (values.length < 5) {
        return MetricType.UNKNOWN;
      }

      // Check if it's an enum (limited set of discrete values)
      const uniqueValues = new Set(values);
      if (uniqueValues.size <= 10 && uniqueValues.size / values.length < 0.2) {
        return MetricType.ENUM;
      }

      // Check if it's a monotonic counter (always increasing or staying the same)
      let isMonotonic = true;
      for (let i = 1; i < values.length; i++) {
        if (values[i] < values[i-1]) {
          isMonotonic = false;
          break;
        }
      }

      if (isMonotonic) {
        return MetricType.MONOTONIC_COUNTER;
      }

      // Check if it's a counter (generally increasing but can reset)
      let increasingCount = 0;
      let decreasingCount = 0;
      let significantDrops = 0;

      for (let i = 1; i < values.length; i++) {
        const diff = values[i] - values[i-1];
        if (diff > 0) {
          increasingCount++;
        } else if (diff < 0) {
          decreasingCount++;
          // Check for significant drops (potential counter resets)
          if (values[i] < values[i-1] * 0.5) {
            significantDrops++;
          }
        }
      }

      // If mostly increasing with some significant drops, likely a counter
      if (increasingCount > decreasingCount * 2 && significantDrops > 0) {
        return MetricType.COUNTER;
      }

      // Default to gauge (can go up and down freely)
      return MetricType.GAUGE;
    } catch (error) {
      logger.error(`[Metric Anomaly] Error detecting metric type for ${metricField}:`, error);
      return MetricType.UNKNOWN;
    }
  }

  /**
   * Main method to detect anomalies in metrics
   * @param startTime ISO8601 start time
   * @param endTime ISO8601 end time
   * @param metricField Required specific metric field to analyze
   * @param metricType Required metric type to use for detection
   * @param serviceOrServices Optional service name or array of services
   * @param options Optional configuration parameters
   * @returns Detected anomalies and statistics
   */
  async detectAnomalies(
    startTime: string, 
    endTime: string, 
    metricField: string,
    metricType: MetricType,
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
      
      // Add metric field filter (now required)
      must.push({ exists: { field: metricField } });
      
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
          
          let potentialMetricFields: string[] = [];
          
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
            const fieldsSet = new Set<string>();
            numericFields.forEach((field: any) => fieldsSet.add(field.name));
            
            // If no potential metric fields found, try the fallback approach
            if (fieldsSet.size === 0) {
              logger.info('[Metric Anomaly] No numeric fields found from schema, using fallback approach');
              const fields = await this.findPotentialMetricFields(must);
              fields.forEach(field => fieldsSet.add(field));
            }
            
            potentialMetricFields = Array.from(fieldsSet);
          } else {
            // If no fields found from schema, use the fallback approach
            logger.info('[Metric Anomaly] No fields found from schema, using fallback approach');
            const fieldsSet = await this.findPotentialMetricFields(must);
            potentialMetricFields = Array.from(fieldsSet);
          }
          
          // If no potential metric fields found, return empty result
          if (potentialMetricFields.length === 0) {
            return { message: 'No numeric metric fields found in the data', anomalies: [] };
          }
          
          // Process each potential metric field and collect anomalies
          logger.info(`[Metric Anomaly] Processing ${potentialMetricFields.length} potential metric fields`);
          
          // Limit to a reasonable number of fields to avoid excessive processing
          const fieldsToProcess = potentialMetricFields.slice(0, 5);
          
          // Process each field and collect anomalies
          const allAnomalies: MetricAnomaly[] = [];
          const fieldResults: any = {};
          
          for (const field of fieldsToProcess) {
            try {
              logger.info(`[Metric Anomaly] Processing field: ${field}`);
              const result = await this.detectAnomalies(startTime, endTime, field, MetricType.GAUGE, serviceOrServices, options);
              
              if (result.anomalies && result.anomalies.length > 0) {
                allAnomalies.push(...result.anomalies);
                fieldResults[field] = {
                  anomalyCount: result.anomalies.length,
                  metricType: result.metricType
                };
              }
            } catch (error) {
              logger.error(`[Metric Anomaly] Error processing field: ${field}`, { error });
            }
          }
          
          // Sort all anomalies by deviation (descending) and limit to maxResults
          const sortedAnomalies = allAnomalies
            .sort((a, b) => (b.deviation || 0) - (a.deviation || 0))
            .slice(0, maxResults);
          
          return {
            anomalies: sortedAnomalies,
            processedFields: fieldResults,
            potentialFields: potentialMetricFields
          };
          
        } catch (error) {
          logger.error('[Metric Anomaly] Error identifying metric fields', { error });
          return { message: 'Error identifying metric fields', error: String(error), anomalies: [] };
        }
      }
      
      // 2. Query for the metric data with aggregations
      const query = {
        size: 0,
        query: {
          bool: { must }
        },
        aggs: {
          time_buckets: {
            date_histogram: {
              field: '@timestamp',
              fixed_interval: interval
            },
            aggs: {
              metric_value: {
                stats: {
                  field: metricField
                }
              }
            }
          },
          stats: {
            stats: {
              field: metricField
            }
          },
          percentiles: {
            percentiles: {
              field: metricField,
              percents: [25, 50, 75, 90, 95, 99]
            }
          }
        }
      };
      
      const aggResp = await this.esAdapter.queryMetrics(query);
      const buckets = aggResp.aggregations?.time_buckets?.buckets || [];
      const stats = aggResp.aggregations?.stats || {};
      const percentiles = aggResp.aggregations?.percentiles?.values || {};
      
      if (buckets.length === 0) {
        return { message: `No data found for metric field: ${metricField}` };
      }
      
      // Use the provided metric type or default to GAUGE
      const detectedMetricType = metricType || MetricType.GAUGE;
      logger.info(`[Metric Anomaly] Using metric type: ${detectedMetricType} for field: ${metricField}`);
      
      // Use the appropriate specialized detection method based on the metric type
      let result: { anomalies: MetricAnomaly[]; stats: any };
      
      switch (detectedMetricType) {
        case MetricType.GAUGE:
          logger.info(`[Metric Anomaly] Using gauge anomaly detection for: ${metricField}`);
          result = await GaugeAnomalyDetector.detectAnomalies(metricField, buckets, options);
          break;
          
        case MetricType.MONOTONIC_COUNTER:
          logger.info(`[Metric Anomaly] Using monotonic counter anomaly detection for: ${metricField}`);
          result = await MonotonicCounterAnomalyDetector.detectAnomalies(metricField, buckets, options);
          break;
          
        case MetricType.COUNTER:
          logger.info(`[Metric Anomaly] Using counter anomaly detection for: ${metricField}`);
          result = await CounterAnomalyDetector.detectAnomalies(metricField, buckets, options);
          break;
          
        case MetricType.ENUM:
          logger.info(`[Metric Anomaly] Using enum anomaly detection for: ${metricField}`);
          result = await EnumAnomalyDetector.detectAnomalies(metricField, buckets, options);
          break;
          
        default:
          // Fall back to gauge anomaly detection for unknown types
          logger.info(`[Metric Anomaly] Using default gauge anomaly detection for: ${metricField} (unknown type)`);
          result = await GaugeAnomalyDetector.detectAnomalies(metricField, buckets, options);
          break;
      }
      
      // Get the anomalies and stats from the specialized detection method
      const anomalies = result.anomalies;
      const detectionStats = result.stats;
      
      // Add metric type information to the statistics
      const enhancedStats = {
        ...stats,
        ...detectionStats,
        metricType: detectedMetricType,
        percentiles,
        q1: percentiles['25.0'] || 0,
        q3: percentiles['75.0'] || 0,
        iqr: (percentiles['75.0'] || 0) - (percentiles['25.0'] || 0),
        iqrLower: (percentiles['25.0'] || 0) - (iqrMultiplier * ((percentiles['75.0'] || 0) - (percentiles['25.0'] || 0))),
        iqrUpper: (percentiles['75.0'] || 0) + (iqrMultiplier * ((percentiles['75.0'] || 0) - (percentiles['25.0'] || 0))),
        zScoreLower: (stats.avg || 0) - (zScoreThreshold * (stats.std_deviation || 0)),
        zScoreUpper: (stats.avg || 0) + (zScoreThreshold * (stats.std_deviation || 0)),
        percentileThresholdValue: percentiles[`${percentileThreshold}.0`] || 0
      };
      
      // Sort anomalies by deviation (descending) and limit to maxResults
      const sortedAnomalies = anomalies
        .sort((a, b) => (b.deviation || 0) - (a.deviation || 0))
        .slice(0, maxResults);
      
      return {
        anomalies: sortedAnomalies,
        stats: enhancedStats,
        metricType: detectedMetricType,
        service: typeof serviceOrServices === 'string' ? serviceOrServices : undefined,
        metricField
      };
    } catch (error: any) {
      logger.error('[Metric Anomaly] Error detecting anomalies', { error: error.message || String(error) });
      return { error: error.message || String(error) };
    }
  }
}
