import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { logger } from '../../utils/logger.js';
import { SpanAnomalyOptions, SpanAnomaly } from './types.js';

/**
 * Handles detection of anomalies in span durations
 */
export class SpanAnomalyDetector {
  constructor(private esAdapter: ElasticsearchAdapter) {}

  /**
   * Main method to detect anomalies in span durations
   */
  async detectAnomalies(
    startTime: string, 
    endTime: string, 
    serviceOrServices?: string | string[], 
    operation?: string, 
    options: SpanAnomalyOptions = {}
  ): Promise<any> {
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
      
      // Add operation filter if provided
      if (operation) {
        must.push({ term: { 'name': operation } });
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
      
      // First, use schema information to identify the correct field names
      let spanIdField = 'spanId';
      let traceIdField = 'traceId';
      let nameField = 'name';
      let serviceFields = ['Resource.service.name', 'resource.attributes.service.name', 'service.name'];
      let durationField = 'duration';
      let timestampField = '@timestamp';
      
      try {
        // Use the field schemas API to get field information
        const indexPattern = 'traces*,*traces*,span*,*span*';
        const fieldInfos = await import('../../adapters/fieldSchemas.js')
          .then(module => module.getFieldStats(this.esAdapter, indexPattern));
        
        if (fieldInfos && fieldInfos.length > 0) {
          logger.info(`[Span Anomaly] Found ${fieldInfos.length} fields from schema`);
          
          // Find the correct field names based on schema
          for (const field of fieldInfos) {
            const fieldLower = field.name.toLowerCase();
            
            // Identify span ID field
            if (fieldLower.includes('spanid') || fieldLower.includes('span_id') || fieldLower.includes('span.id')) {
              spanIdField = field.name;
            }
            
            // Identify trace ID field
            if (fieldLower.includes('traceid') || fieldLower.includes('trace_id') || fieldLower.includes('trace.id')) {
              traceIdField = field.name;
            }
            
            // Identify name field
            if (fieldLower === 'name' || fieldLower.includes('operation') || fieldLower.includes('span.name')) {
              nameField = field.name;
            }
            
            // Identify service name fields
            if (fieldLower.includes('service') && fieldLower.includes('name')) {
              serviceFields.push(field.name);
            }
            
            // Identify duration field
            if (fieldLower.includes('duration') || fieldLower.includes('elapsed') || fieldLower.includes('time')) {
              if (field.type === 'long' || field.type === 'integer' || 
                  field.type === 'float' || field.type === 'double' || 
                  field.type === 'number') {
                durationField = field.name;
              }
            }
            
            // Identify timestamp field
            if (fieldLower.includes('timestamp') || fieldLower.includes('time') && fieldLower.includes('start')) {
              timestampField = field.name;
            }
          }
        }
      } catch (error) {
        logger.warn('[Span Anomaly] Error getting field schema, using default field names', { error });
      }
      
      // Query for spans with the identified field names
      const spanQuery = {
        size: 10000, // Get a large sample of spans
        query: { bool: { must } },
        _source: [
          spanIdField,
          traceIdField,
          nameField,
          ...new Set(serviceFields),
          durationField,
          timestampField
        ]
      };
      
      const spanResp = await this.esAdapter.queryTraces(spanQuery);
      const spans = spanResp.hits?.hits || [];
      
      if (spans.length === 0) {
        return { message: 'No spans found for the specified time range and services' };
      }
      
      logger.info(`[Span Anomaly] Found ${spans.length} spans for anomaly detection`);
      
      // Normalize span data using the identified field names
      const normalizedSpans = spans.map((hit: any) => {
        const source = hit._source || {};
        
        // Extract service name by trying all possible service fields
        let serviceName = 'unknown';
        for (const serviceField of serviceFields) {
          // Handle dot notation fields
          if (serviceField.includes('.')) {
            const parts = serviceField.split('.');
            let value = source;
            let valid = true;
            
            for (const part of parts) {
              if (value && typeof value === 'object') {
                value = value[part];
              } else {
                valid = false;
                break;
              }
            }
            
            if (valid && value) {
              serviceName = value;
              break;
            }
          } else if (source[serviceField]) {
            serviceName = source[serviceField];
            break;
          }
        }
        
        return {
          spanId: source[spanIdField] || '',
          traceId: source[traceIdField] || '',
          name: source[nameField] || 'unknown',
          service: serviceName,
          duration: source[durationField] || 0,
          timestamp: source[timestampField] || new Date().toISOString()
        };
      }).filter((span: any) => span.duration > 0); // Filter out spans with no duration
      
      if (normalizedSpans.length === 0) {
        return { message: 'No spans with valid duration found' };
      }
      
      // Group spans by operation if requested
      let spanGroups: any = {};
      let results: any = {};
      
      if (groupByOperation) {
        spanGroups = normalizedSpans.reduce((groups: any, span: any) => {
          const key = span.name;
          if (!groups[key]) {
            groups[key] = [];
          }
          groups[key].push(span);
          return groups;
        }, {});
        
        // Analyze each operation group
        const operationResults: any = {};
        
        for (const [operation, spans] of Object.entries(spanGroups)) {
          const anomalies = this.detectAnomaliesInSpanGroup(
            spans as any[], 
            { 
              absoluteThreshold, 
              zScoreThreshold, 
              percentileThreshold, 
              iqrMultiplier 
            }
          );
          
          if (anomalies.length > 0) {
            operationResults[operation] = {
              operation,
              totalSpans: (spans as any[]).length,
              anomalies: anomalies.slice(0, maxResults),
              totalAnomalies: anomalies.length
            };
          }
        }
        
        results = {
          groupByOperation: true,
          operations: operationResults,
          totalOperationsWithAnomalies: Object.keys(operationResults).length
        };
      } else {
        // Analyze all spans together
        const anomalies = this.detectAnomaliesInSpanGroup(
          normalizedSpans, 
          { 
            absoluteThreshold, 
            zScoreThreshold, 
            percentileThreshold, 
            iqrMultiplier 
          }
        );
        
        results = {
          groupByOperation: false,
          totalSpans: normalizedSpans.length,
          anomalies: anomalies.slice(0, maxResults),
          totalAnomalies: anomalies.length
        };
      }
      
      // Group by service if multiple services were provided
      if (Array.isArray(serviceOrServices) && serviceOrServices.length > 1) {
        // Group anomalies by service
        const groupedByService: { [key: string]: any[] } = {};
        
        // Initialize groups for each requested service
        serviceOrServices.forEach(svc => {
          groupedByService[svc] = [];
        });
        
        // Add unknown service group
        groupedByService['unknown'] = [];
        
        // Group all anomalies by service
        if (results.groupByOperation) {
          // For operation-grouped results
          Object.values(results.operations).forEach((opResult: any) => {
            opResult.anomalies.forEach((anomaly: SpanAnomaly) => {
              const service = anomaly.service || 'unknown';
              if (groupedByService[service]) {
                groupedByService[service].push(anomaly);
              } else {
                groupedByService['unknown'].push(anomaly);
              }
            });
          });
        } else {
          // For non-grouped results
          results.anomalies.forEach((anomaly: SpanAnomaly) => {
            const service = anomaly.service || 'unknown';
            if (groupedByService[service]) {
              groupedByService[service].push(anomaly);
            } else {
              groupedByService['unknown'].push(anomaly);
            }
          });
        }
        
        // Add service grouping to results
        results.serviceGroups = Object.entries(groupedByService).reduce((acc: any, [service, anomalies]) => {
          if ((anomalies as any[]).length > 0) {
            acc[service] = {
              service,
              anomalies,
              totalAnomalies: (anomalies as any[]).length
            };
          }
          return acc;
        }, {});
      }
      
      return results;
    } catch (error) {
      logger.error('[Span Anomaly] Error detecting anomalies', { error });
      return { error: 'Error detecting span anomalies', details: String(error) };
    }
  }

  /**
   * Detect anomalies in a group of spans using multiple detection methods
   */
  private detectAnomaliesInSpanGroup(
    spans: any[], 
    options: {
      absoluteThreshold: number,
      zScoreThreshold: number,
      percentileThreshold: number,
      iqrMultiplier: number
    }
  ): SpanAnomaly[] {
    const { 
      absoluteThreshold, 
      zScoreThreshold, 
      percentileThreshold, 
      iqrMultiplier 
    } = options;
    
    // Calculate statistics
    const durations = spans.map(span => span.duration);
    const sum = durations.reduce((a, b) => a + b, 0);
    const mean = sum / durations.length;
    
    // Calculate standard deviation
    const squaredDiffs = durations.map(d => Math.pow(d - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;
    const stdDev = Math.sqrt(avgSquaredDiff);
    
    // Calculate percentiles
    const sortedDurations = [...durations].sort((a, b) => a - b);
    const p25Index = Math.floor(sortedDurations.length * 0.25);
    const p50Index = Math.floor(sortedDurations.length * 0.5);
    const p75Index = Math.floor(sortedDurations.length * 0.75);
    const p95Index = Math.floor(sortedDurations.length * 0.95);
    
    const q1 = sortedDurations[p25Index];
    const median = sortedDurations[p50Index];
    const q3 = sortedDurations[p75Index];
    const p95 = sortedDurations[p95Index];
    
    // Calculate IQR thresholds
    const iqr = q3 - q1;
    const iqrLower = q1 - (iqrMultiplier * iqr);
    const iqrUpper = q3 + (iqrMultiplier * iqr);
    
    // Calculate Z-score thresholds
    const zScoreLower = mean - (zScoreThreshold * stdDev);
    const zScoreUpper = mean + (zScoreThreshold * stdDev);
    
    // Detect anomalies
    const anomalies: SpanAnomaly[] = [];
    
    spans.forEach(span => {
      const duration = span.duration;
      
      // Store anomaly detection results
      const anomalyInfo: SpanAnomaly = {
        spanId: span.spanId,
        traceId: span.traceId,
        name: span.name,
        service: span.service,
        duration,
        timestamp: span.timestamp,
        detectionMethod: ''
      };
      
      // 1. Absolute threshold detection
      if (duration > absoluteThreshold) {
        anomalies.push({
          ...anomalyInfo,
          threshold: absoluteThreshold,
          detectionMethod: 'absolute_threshold'
        });
      }
      
      // 2. Z-score detection
      const zScore = stdDev !== 0 ? (duration - mean) / stdDev : 0;
      if (Math.abs(zScore) > zScoreThreshold) {
        anomalies.push({
          ...anomalyInfo,
          zScore,
          expectedDuration: mean,
          deviation: duration - mean,
          threshold: zScoreThreshold,
          detectionMethod: 'z_score'
        });
      }
      
      // 3. Percentile-based detection
      if (duration > p95) {
        anomalies.push({
          ...anomalyInfo,
          percentile: percentileThreshold,
          threshold: p95,
          detectionMethod: 'percentile'
        });
      }
      
      // 4. IQR detection
      if (duration < iqrLower || duration > iqrUpper) {
        anomalies.push({
          ...anomalyInfo,
          expectedDuration: mean,
          deviation: duration - mean,
          threshold: duration > iqrUpper ? iqrUpper : iqrLower,
          detectionMethod: 'iqr'
        });
      }
    });
    
    return anomalies;
  }
}
