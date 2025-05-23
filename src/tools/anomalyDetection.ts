import { ElasticsearchAdapter } from '../adapters/elasticsearch/index.js';

/**
 * Tool for basic anomaly detection over OTEL metrics and traces.
 * Uses statistical thresholding (mean + N*stddev) for anomaly detection on metrics.
 */
export class AnomalyDetectionTool {
  private esAdapter: ElasticsearchAdapter;

  constructor(esAdapter: ElasticsearchAdapter) {
    this.esAdapter = esAdapter;
  }

  /**
   * Detect anomalies in a metric for a service and time window using a flexible hybrid approach.
   * Combines multiple detection strategies:
   * 1. Absolute threshold detection
   * 2. Statistical outlier detection (Z-score)
   * 3. Percentile-based detection
   * 4. IQR (Interquartile Range) detection
   * 5. Rate of change detection (sudden spikes/drops)
   * 
   * @param startTime ISO8601 start
   * @param endTime ISO8601 end
   * @param metricField Metric field to analyze (e.g., 'metric.value')
   * @param serviceOrServices Optional service name or array of service names
   * @param options Optional configuration parameters
   * @returns Array of anomaly buckets with detection information
   */
  async detectMetricAnomalies(
    startTime: string, 
    endTime: string, 
    metricField?: string,
    serviceOrServices?: string | string[], 
    options: {
      absoluteThreshold?: number;     // Absolute value threshold
      zScoreThreshold?: number;       // Z-score threshold (default: 3)
      percentileThreshold?: number;   // Percentile threshold (default: 95)
      iqrMultiplier?: number;         // IQR multiplier for outlier detection (default: 1.5)
      changeThreshold?: number;       // Rate of change threshold as percentage (default: 50)
      interval?: string;              // Time interval for buckets (default: '1m')
      maxResults?: number;            // Maximum number of results to return (default: 100)
    } = {}
  ) {
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
        // First, get a sample of metrics to identify fields
        const sampleQuery = {
          size: 100,
          query: { bool: { must } },
          _source: ['*']
        };
        
        const sampleResp = await this.esAdapter.queryMetrics(sampleQuery);
        const samples = sampleResp.hits?.hits || [];
        
        if (samples.length === 0) {
          return { message: 'No metrics found for the specified time range and services' };
        }
        
        // Identify potential metric fields (numerical fields)
        const potentialMetricFields = new Set<string>();
        samples.forEach((hit: any) => {
          const source = hit._source || {};
          Object.entries(source).forEach(([key, value]) => {
            // Look for numeric fields that might be metrics
            if (typeof value === 'number' && 
                !key.includes('timestamp') && 
                !key.includes('id') && 
                !key.includes('time')) {
              potentialMetricFields.add(key);
            }
            
            // Also check nested objects for numeric fields
            if (typeof value === 'object' && value !== null) {
              Object.entries(value as object).forEach(([nestedKey, nestedValue]) => {
                const fullKey = `${key}.${nestedKey}`;
                if (typeof nestedValue === 'number' && 
                    !fullKey.includes('timestamp') && 
                    !fullKey.includes('id') && 
                    !fullKey.includes('time')) {
                  potentialMetricFields.add(fullKey);
                }
              });
            }
          });
        });
        
        // If no potential metric fields found, return empty result
        if (potentialMetricFields.size === 0) {
          return { message: 'No numeric metric fields found in the data' };
        }
        
        // Analyze each potential metric field for anomalies
        const allFieldAnomalies: any[] = [];
        
        for (const field of potentialMetricFields) {
          // Create a query for this specific field
          const fieldAggQuery = {
            size: 0,
            query: { bool: { must: [...must, { exists: { field } }] } },
            aggs: {
              timeseries: {
                date_histogram: {
                  field: '@timestamp',
                  fixed_interval: interval,
                  min_doc_count: 1
                },
                aggs: {
                  value_stats: { stats: { field } },
                  value_extended_stats: { extended_stats: { field } }
                }
              }
            }
          };
          
          // Execute the query for this field
          const fieldResp = await this.esAdapter.queryMetrics(fieldAggQuery);
          const fieldBuckets = fieldResp.aggregations?.timeseries?.buckets || [];
          
          if (fieldBuckets.length > 0) {
            // Process this field's data (similar to the main processing below)
            // ... [processing code would be duplicated here]
            
            // For simplicity, we'll call this method recursively with the specific field
            const fieldAnomalies = await this.detectMetricAnomalies(
              startTime,
              endTime,
              field,
              serviceOrServices,
              options
            );
            
            // Add field name to each anomaly and collect
            if (Array.isArray(fieldAnomalies)) {
              fieldAnomalies.forEach((anomaly: any) => {
                anomaly.metric_field = field;
                allFieldAnomalies.push(anomaly);
              });
            }
          }
        }
        
        // Sort all anomalies by severity and limit results
        const sortedAnomalies = allFieldAnomalies
          .sort((a: any, b: any) => Math.abs(b.z_score) - Math.abs(a.z_score))
          .slice(0, maxResults);
        
        // Group by metric field
        const groupedByField: { [key: string]: any[] } = {};
        sortedAnomalies.forEach((anomaly: any) => {
          const field = anomaly.metric_field || 'unknown';
          if (!groupedByField[field]) {
            groupedByField[field] = [];
          }
          groupedByField[field].push(anomaly);
        });
        
        return {
          grouped_by_metric_field: true,
          metric_fields: groupedByField,
          total_anomalies: sortedAnomalies.length
        };
      }
      
      // If a specific metric field is provided, proceed with normal analysis
      const aggQuery = {
        size: 0,
        query: { bool: { must } },
        aggs: {
          timeseries: {
            date_histogram: {
              field: '@timestamp',
              fixed_interval: interval,
              min_doc_count: 1
            },
            aggs: {
              value_stats: { stats: { field: metricField } },
              value_extended_stats: { extended_stats: { field: metricField } }
            }
          }
        }
      };
      
      const resp = await this.esAdapter.queryMetrics(aggQuery);
      const buckets = resp.aggregations?.timeseries?.buckets || [];
      
      if (buckets.length === 0) {
        return [];
      }
      
      // 2. Extract and normalize metric values
      const normalizedBuckets = buckets.map((bucket: any, index: number) => {
        // Get previous bucket for rate of change calculation
        const prevBucket = index > 0 ? buckets[index - 1] : null;
        
        // Calculate rate of change if previous bucket exists
        let changePercent = null;
        if (prevBucket && typeof bucket.value_stats.avg === 'number' && typeof prevBucket.value_stats.avg === 'number') {
          // Avoid division by zero
          if (prevBucket.value_stats.avg !== 0) {
            changePercent = ((bucket.value_stats.avg - prevBucket.value_stats.avg) / Math.abs(prevBucket.value_stats.avg)) * 100;
          } else if (bucket.value_stats.avg !== 0) {
            // If previous was zero and current is not, it's an infinite increase (cap at 1000%)
            changePercent = 1000;
          }
        }
        
        return {
          timestamp: bucket.key_as_string,
          timestampEpoch: bucket.key,
          value: bucket.value_stats.avg,
          min: bucket.value_stats.min,
          max: bucket.value_stats.max,
          count: bucket.value_stats.count,
          sum: bucket.value_stats.sum,
          changePercent
        };
      }).filter((b: any) => typeof b.value === 'number');
      
      if (normalizedBuckets.length === 0) {
        return [];
      }
      
      // 3. Calculate statistics for anomaly detection
      const values = normalizedBuckets.map((b: any) => b.value);
      
      // Basic statistics
      const mean = values.reduce((a: number, b: number) => a + b, 0) / values.length;
      const variance = values.reduce((a: number, b: number) => a + Math.pow(b - mean, 2), 0) / values.length;
      const stddev = Math.sqrt(variance);
      
      // Sort values for percentile and IQR calculations
      const sortedValues = [...values].sort((a, b) => a - b);
      
      // Calculate percentiles
      const p95Index = Math.floor(sortedValues.length * 0.95);
      const p95Value = sortedValues[p95Index];
      const p99Index = Math.floor(sortedValues.length * 0.99);
      const p99Value = sortedValues[p99Index];
      
      // Calculate percentile threshold based on user input
      const percentileIndex = Math.floor(sortedValues.length * (percentileThreshold / 100));
      const percentileThresholdValue = sortedValues[percentileIndex];
      
      // Calculate IQR (Interquartile Range)
      const q1Index = Math.floor(sortedValues.length * 0.25);
      const q3Index = Math.floor(sortedValues.length * 0.75);
      const q1 = sortedValues[q1Index];
      const q3 = sortedValues[q3Index];
      const iqr = q3 - q1;
      const iqrThreshold = q3 + (iqrMultiplier * iqr);
      
      // Calculate Z-score threshold
      const zScoreThresholdValue = mean + (zScoreThreshold * stddev);
      
      // Get absolute threshold if provided, otherwise use mean as default
      const absoluteThreshold = options.absoluteThreshold !== undefined ? options.absoluteThreshold : mean;
      
      // 4. Apply multiple anomaly detection strategies
      const allAnomalies = normalizedBuckets.map((bucket: any) => {
        // Track which detection methods flagged this bucket
        const detectionMethods = [];
        
        // 1. Absolute threshold detection
        if (bucket.value > absoluteThreshold) {
          detectionMethods.push('absolute');
        }
        
        // 2. Z-score detection
        const zScore = (bucket.value - mean) / stddev;
        if (zScore > zScoreThreshold) {
          detectionMethods.push('zscore');
        }
        
        // 3. Percentile detection
        if (bucket.value > percentileThresholdValue) {
          detectionMethods.push('percentile');
        }
        
        // 4. IQR detection
        if (bucket.value > iqrThreshold) {
          detectionMethods.push('iqr');
        }
        
        // 5. Rate of change detection
        if (bucket.changePercent !== null && Math.abs(bucket.changePercent) > changeThreshold) {
          detectionMethods.push('change_rate');
        }
        
        return {
          ...bucket,
          detectionMethods,
          isAnomaly: detectionMethods.length > 0,
          z_score: zScore,
          percentile_rank: bucket.value >= p99Value ? 99 : 
                          bucket.value >= p95Value ? 95 : 
                          null
        };
      });
      
      // 5. Filter anomalies and add global statistics
      const anomalies = allAnomalies
        .filter((a: any) => a.isAnomaly)
        .map((anomaly: any) => ({
          timestamp: anomaly.timestamp,
          value: anomaly.value,
          detection_methods: anomaly.detectionMethods,
          z_score: anomaly.z_score,
          percentile_rank: anomaly.percentile_rank,
          change_percent: anomaly.changePercent,
          stats: {
            mean,
            stddev,
            p95: p95Value,
            p99: p99Value,
            q1,
            q3,
            iqr,
            iqrThreshold,
            zScoreThreshold: zScoreThresholdValue,
            percentileThreshold: percentileThresholdValue,
            absoluteThreshold,
            changeThreshold
          }
        }));
      
      // 6. Sort by severity (highest z-score first) and limit results
      const sortedAnomalies = anomalies
        .sort((a: any, b: any) => Math.abs(b.z_score) - Math.abs(a.z_score))
        .slice(0, maxResults);
      
      // 7. Group by service if multiple services were requested
      if (Array.isArray(serviceOrServices) && serviceOrServices.length > 1) {
        // Group anomalies by service
        const groupedByService: { [key: string]: any[] } = {};
        
        // Initialize groups for each requested service
        if (Array.isArray(serviceOrServices)) {
          serviceOrServices.forEach(svc => {
            if (svc && svc.trim() !== '') {
              groupedByService[svc] = [];
            }
          });
        }
        
        // Add anomalies to their respective service groups
        sortedAnomalies.forEach((anomaly: any) => {
          // The service name might be in different fields depending on the data source
          const serviceName = anomaly.service || 'unknown';
          if (!groupedByService[serviceName]) {
            groupedByService[serviceName] = [];
          }
          groupedByService[serviceName].push(anomaly);
        });
        
        return {
          grouped_by_service: true,
          services: groupedByService,
          total_anomalies: sortedAnomalies.length
        };
      }
      
      // Return flat list if not grouping by service
      return sortedAnomalies;
    } catch (error: any) {
      console.error('Error detecting metric anomalies:', error);
      return [];
    }
  }

  /**
   * Detect anomalies in span durations using a flexible hybrid approach.
   * Combines multiple detection strategies:
   * 1. Absolute threshold detection
   * 2. Statistical outlier detection (Z-score)
   * 3. Percentile-based detection
   * 4. IQR (Interquartile Range) detection
   * 
   * If no operation is specified, will analyze all operations and group results by operation.
   * 
   * @param startTime ISO8601 start
   * @param endTime ISO8601 end
   * @param serviceOrServices Optional service name or array of service names
   * @param operation Optional operation name to filter by
   * @param options Optional configuration parameters
   * @returns Array of anomalous spans with detection information or grouped results
   */
  async detectSpanDurationAnomalies(
    startTime: string, 
    endTime: string, 
    serviceOrServices?: string | string[], 
    operation?: string, 
    options: {
      absoluteThreshold?: number;   // Absolute duration threshold in nanoseconds
      zScoreThreshold?: number;     // Z-score threshold (default: 3)
      percentileThreshold?: number; // Percentile threshold (default: 95)
      iqrMultiplier?: number;       // IQR multiplier for outlier detection (default: 1.5)
      maxResults?: number;          // Maximum number of results to return (default: 100)
      groupByOperation?: boolean;   // Whether to analyze each operation separately (default: true)
    } = {}
  ) {
    try {
      // Set default options
      const {
        absoluteThreshold = 1000000, // 1ms in nanoseconds
        zScoreThreshold = 3,
        percentileThreshold = 95,
        iqrMultiplier = 1.5,
        maxResults = 100,
        groupByOperation = true
      } = options;
      
      // 1. Query for spans matching the service and time window
      const must: any[] = [
        { range: { '@timestamp': { gte: startTime, lte: endTime } } }
      ];
      
      // Add service filter if provided - support both single service and array of services
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
      
      // Add operation filter if provided
      if (operation) {
        must.push({
          bool: {
            should: [
              { term: { 'Name': operation } },
              { term: { 'name': operation } }
            ],
            minimum_should_match: 1
          }
        });
      }
      
      // Add filter to ensure Duration field exists
      must.push({
        bool: {
          should: [
            { exists: { field: 'Duration' } },
            { exists: { field: 'duration' } }
          ],
          minimum_should_match: 1
        }
      });
      
      // Query for spans with duration information
      const query = {
        size: 10000, // Get a large sample size for better statistical analysis
        query: { bool: { must } },
        _source: [
          'SpanId', 'span_id', 'span.id',
          'TraceId', 'trace_id', 'trace.id',
          'Duration', 'duration',
          'Name', 'name',
          'Kind', 'kind', 'span.kind',
          'Resource.service.name', 'resource.attributes.service.name', 'service.name',
          '@timestamp',
          'Status', 'status', 'TraceStatus',
          'ParentSpanId', 'parent_span_id', 'parent.span.id',
          'Attributes', 'attributes'
        ],
        sort: [
          { 'Duration': { order: 'desc', missing: '_last' } },
          { 'duration': { order: 'desc', missing: '_last' } }
        ]
      };
      
      const resp = await this.esAdapter.queryTraces(query);
      const spans = resp.hits?.hits?.map((h: any) => h._source) || [];
      
      if (spans.length === 0) {
        return [];
      }
      
      // 2. Extract and normalize span data
      const normalizedSpans = spans.map((span: any) => {
        // Extract common fields using multiple possible field names
        const duration = span.Duration || span.duration || 0;
        const spanId = span.SpanId || span.span_id || span['span.id'] || '';
        const traceId = span.TraceId || span.trace_id || span['trace.id'] || '';
        const name = span.Name || span.name || 'unknown';
        const kind = span.Kind || span.kind || span['span.kind'] || 'INTERNAL';
        const serviceName = 
          span['Resource.service.name'] || 
          span['resource.attributes.service.name'] || 
          span['service.name'] || 
          'unknown';
        const timestamp = span['@timestamp'] || new Date().toISOString();
        const status = span.Status || span.status || span.TraceStatus || 0;
        const parentSpanId = span.ParentSpanId || span.parent_span_id || span['parent.span.id'] || '';
        
        return {
          span,
          spanId,
          traceId,
          name,
          kind,
          service: serviceName,
          timestamp,
          status,
          parentSpanId,
          duration: typeof duration === 'number' ? duration : parseInt(duration, 10)
        };
      }).filter((item: any) => item.duration > 0);
      
      if (normalizedSpans.length === 0) {
        return [];
      }
      
      // 3. Group spans by operation if requested
      let spanGroups: { [key: string]: any[] } = { 'all': normalizedSpans };
      
      if (groupByOperation) {
        spanGroups = normalizedSpans.reduce((groups: any, span: any) => {
          const key = span.name;
          if (!groups[key]) {
            groups[key] = [];
          }
          groups[key].push(span);
          return groups;
        }, {});
      }
      
      // 4. Apply multiple anomaly detection strategies to each group
      const allAnomalies: any[] = [];
      
      Object.entries(spanGroups).forEach(([groupName, groupSpans]) => {
        // Skip groups with too few spans for statistical analysis
        if (groupSpans.length < 5) {
          return;
        }
        
        // Sort durations for percentile calculation
        const sortedDurations = groupSpans.map((s: any) => s.duration).sort((a: number, b: number) => a - b);
        
        // Calculate statistics
        const mean = sortedDurations.reduce((a: number, b: number) => a + b, 0) / sortedDurations.length;
        const variance = sortedDurations.reduce((a: number, b: number) => a + Math.pow(b - mean, 2), 0) / sortedDurations.length;
        const stddev = Math.sqrt(variance);
        
        // Calculate percentiles
        const p95Index = Math.floor(sortedDurations.length * 0.95);
        const p95Value = sortedDurations[p95Index];
        const p99Index = Math.floor(sortedDurations.length * 0.99);
        const p99Value = sortedDurations[p99Index];
        
        // Calculate IQR (Interquartile Range)
        const q1Index = Math.floor(sortedDurations.length * 0.25);
        const q3Index = Math.floor(sortedDurations.length * 0.75);
        const q1 = sortedDurations[q1Index];
        const q3 = sortedDurations[q3Index];
        const iqr = q3 - q1;
        const iqrThreshold = q3 + (iqrMultiplier * iqr);
        
        // Calculate Z-score threshold
        const zScoreThresholdValue = mean + (zScoreThreshold * stddev);
        
        // Calculate percentile threshold based on user input
        const percentileIndex = Math.floor(sortedDurations.length * (percentileThreshold / 100));
        const percentileThresholdValue = sortedDurations[percentileIndex];
        
        // Apply all detection strategies
        const groupAnomalies = groupSpans.filter((span: any) => {
          // Track which detection methods flagged this span
          const detectionMethods = [];
          
          // 1. Absolute threshold detection
          if (span.duration > absoluteThreshold) {
            detectionMethods.push('absolute');
          }
          
          // 2. Z-score detection
          const zScore = (span.duration - mean) / stddev;
          if (zScore > zScoreThreshold) {
            detectionMethods.push('zscore');
          }
          
          // 3. Percentile detection
          if (span.duration > percentileThresholdValue) {
            detectionMethods.push('percentile');
          }
          
          // 4. IQR detection
          if (span.duration > iqrThreshold) {
            detectionMethods.push('iqr');
          }
          
          // Flag as anomaly if any detection method triggered
          span.detectionMethods = detectionMethods;
          return detectionMethods.length > 0;
        });
        
        // Add group statistics to each anomaly
        groupAnomalies.forEach((anomaly: any) => {
          anomaly.stats = {
            operation: groupName,
            count: groupSpans.length,
            mean,
            stddev,
            p95: p95Value,
            p99: p99Value,
            q1,
            q3,
            iqr,
            iqrThreshold,
            zScoreThreshold: zScoreThresholdValue,
            percentileThreshold: percentileThresholdValue,
            absoluteThreshold
          };
        });
        
        allAnomalies.push(...groupAnomalies);
      });
      
      // 5. Sort anomalies by duration (descending) and limit results
      const sortedAnomalies = allAnomalies
        .sort((a: any, b: any) => b.duration - a.duration)
        .slice(0, maxResults)
        .map((anomaly: any) => {
          // Format the final anomaly object
          return {
            span_id: anomaly.spanId,
            trace_id: anomaly.traceId,
            operation: anomaly.name,
            service: anomaly.service,
            timestamp: anomaly.timestamp,
            duration: anomaly.duration,
            duration_ms: anomaly.duration / 1000000, // Convert to milliseconds for readability
            detection_methods: anomaly.detectionMethods,
            z_score: (anomaly.duration - anomaly.stats.mean) / anomaly.stats.stddev,
            percentile_rank: anomaly.duration >= anomaly.stats.p99 ? 99 : 
                            anomaly.duration >= anomaly.stats.p95 ? 95 : 
                            null,
            stats: anomaly.stats
          };
        });
      
      // 6. Group by service if multiple services were requested
      if (Array.isArray(serviceOrServices) && serviceOrServices.length > 1) {
        // Group anomalies by service
        const groupedByService: { [key: string]: any[] } = {};
        
        // Initialize groups for each requested service
        if (Array.isArray(serviceOrServices)) {
          serviceOrServices.forEach(svc => {
            if (svc && svc.trim() !== '') {
              groupedByService[svc] = [];
            }
          });
        }
        
        // Add anomalies to their respective service groups
        sortedAnomalies.forEach((anomaly: any) => {
          const serviceName = anomaly.service || 'unknown';
          if (!groupedByService[serviceName]) {
            groupedByService[serviceName] = [];
          }
          groupedByService[serviceName].push(anomaly);
        });
        
        return {
          grouped_by_service: true,
          services: groupedByService,
          total_anomalies: sortedAnomalies.length
        };
      }
      
      // Return flat list if not grouping by service
      return sortedAnomalies;
    } catch (error: any) {
      console.error('Error detecting span duration anomalies:', error);
      return [];
    }
  }
}
