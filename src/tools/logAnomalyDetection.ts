import { ElasticsearchAdapter } from '../adapters/elasticsearch/index.js';
import { logger } from '../utils/logger.js';

/**
 * Tool for detecting anomalies in logs using a hybrid approach that combines
 * multiple detection strategies without requiring ML models.
 */
export class LogAnomalyDetectionTool {
  private esAdapter: ElasticsearchAdapter;

  constructor(esAdapter: ElasticsearchAdapter) {
    this.esAdapter = esAdapter;
  }

  /**
   * Detect anomalies in logs using a flexible hybrid approach.
   * Combines multiple detection strategies:
   * 1. Frequency-based detection (sudden spikes or drops)
   * 2. Pattern-based detection (error patterns, severity changes)
   * 3. Statistical outlier detection (unusual field values)
   * 4. Clustering and cardinality analysis
   * 
   * @param startTime ISO8601 start time
   * @param endTime ISO8601 end time
   * @param serviceOrServices Optional service name or array of service names
   * @param options Optional configuration parameters
   * @returns Array of anomalous logs with detection information or grouped results
   */
  async detectLogAnomalies(
    startTime: string, 
    endTime: string, 
    serviceOrServices?: string | string[],
    options: {
      methods?: ('frequency' | 'pattern' | 'statistical' | 'clustering')[],
      lookbackWindow?: string,    // e.g., "7d" for 7-day baseline
      interval?: string,          // e.g., "1h" for hourly buckets
      spikeThreshold?: number,    // e.g., 3x normal frequency
      patternKeywords?: string[], // Custom error patterns
      includeDefaultPatterns?: boolean,
      zScoreThreshold?: number,   // For statistical detection
      percentileThreshold?: number,
      cardinalityThreshold?: number,
      maxResults?: number
    } = {}
  ) {
    logger.info('[LogAnomalyDetectionTool] Detecting log anomalies', { 
      startTime, 
      endTime, 
      serviceOrServices,
      options 
    });

    // Set default options
    const methods = options.methods || ['frequency', 'pattern', 'statistical', 'clustering'];
    const lookbackWindow = options.lookbackWindow || '7d';
    const interval = options.interval || '1h';
    const spikeThreshold = options.spikeThreshold || 3;
    const includeDefaultPatterns = options.includeDefaultPatterns !== false;
    const zScoreThreshold = options.zScoreThreshold || 3;
    const percentileThreshold = options.percentileThreshold || 95;
    const cardinalityThreshold = options.cardinalityThreshold || 2;
    const maxResults = options.maxResults || 100;

    // Default error patterns
    const defaultPatterns = [
      'error', 'exception', 'fail', 'failed', 'failure', 'timeout', 'timed out',
      'unavailable', 'fatal', 'critical', 'crash', 'unexpected', 'denied',
      'refused', 'rejected', 'unauthorized', 'forbidden', 'exceeded'
    ];

    // Combine default and custom patterns
    const patternKeywords = [...(includeDefaultPatterns ? defaultPatterns : []), 
                            ...(options.patternKeywords || [])];

    // Store all anomalies from different detection methods
    const allAnomalies: any[] = [];
    
    // Convert service parameter to array for consistent handling
    const services = serviceOrServices 
      ? (Array.isArray(serviceOrServices) ? serviceOrServices : [serviceOrServices]) 
      : undefined;

    // Build the base query
    const baseQuery: any = {
      bool: {
        must: [
          { range: { '@timestamp': { gte: startTime, lte: endTime } } }
        ]
      }
    };

    // Add service filter if provided
    if (services && services.length > 0) {
      baseQuery.bool.filter = [{
        bool: {
          should: [
            { terms: { 'resource.service.name': services } },
            { terms: { 'Resource.service.name': services } },
            { terms: { 'service.name': services } }
          ],
          minimum_should_match: 1
        }
      }];
    }

    // 1. Frequency-based detection
    if (methods.includes('frequency')) {
      try {
        const frequencyAnomalies = await this.detectFrequencyAnomalies(
          startTime, endTime, baseQuery, lookbackWindow, interval, spikeThreshold
        );
        allAnomalies.push(...frequencyAnomalies);
      } catch (error) {
        logger.error('[LogAnomalyDetectionTool] Error in frequency detection', { error });
      }
    }

    // 2. Pattern-based detection
    if (methods.includes('pattern')) {
      try {
        const patternAnomalies = await this.detectPatternAnomalies(
          baseQuery, patternKeywords
        );
        allAnomalies.push(...patternAnomalies);
      } catch (error) {
        logger.error('[LogAnomalyDetectionTool] Error in pattern detection', { error });
      }
    }

    // 3. Statistical detection
    if (methods.includes('statistical')) {
      try {
        const statisticalAnomalies = await this.detectStatisticalAnomalies(
          baseQuery, zScoreThreshold, percentileThreshold
        );
        allAnomalies.push(...statisticalAnomalies);
      } catch (error) {
        logger.error('[LogAnomalyDetectionTool] Error in statistical detection', { error });
      }
    }

    // 4. Clustering and cardinality analysis
    if (methods.includes('clustering')) {
      try {
        const clusteringAnomalies = await this.detectClusteringAnomalies(
          startTime, endTime, baseQuery, cardinalityThreshold
        );
        allAnomalies.push(...clusteringAnomalies);
      } catch (error) {
        logger.error('[LogAnomalyDetectionTool] Error in clustering detection', { error });
      }
    }

    // Sort anomalies by confidence score and limit results
    const sortedAnomalies = allAnomalies
      .sort((a, b) => b.confidence_score - a.confidence_score)
      .slice(0, maxResults);

    // Group by service if multiple services were specified
    if (services && services.length > 1) {
      // Group anomalies by service
      const groupedByService: { [key: string]: any[] } = {};
      let totalAnomalies = 0;

      sortedAnomalies.forEach(anomaly => {
        const service = anomaly.service || 'unknown';
        if (!groupedByService[service]) {
          groupedByService[service] = [];
        }
        groupedByService[service].push(anomaly);
        totalAnomalies++;
      });

      return {
        grouped_by_service: true,
        services: groupedByService,
        total_anomalies: totalAnomalies,
        detection_methods: methods
      };
    }

    // Return flat list for single service
    return sortedAnomalies;
  }

  /**
   * Detect frequency-based anomalies in logs
   */
  private async detectFrequencyAnomalies(
    startTime: string,
    endTime: string,
    baseQuery: any,
    lookbackWindow: string,
    interval: string,
    spikeThreshold: number
  ): Promise<any[]> {
    // Calculate the lookback period start time
    const lookbackStart = new Date(new Date(startTime).getTime() - this.parseDuration(lookbackWindow)).toISOString();
    
    // Create a query for the baseline period
    const baselineQuery = {
      ...baseQuery,
      bool: {
        ...baseQuery.bool,
        must: [
          { range: { '@timestamp': { gte: lookbackStart, lt: startTime } } }
        ]
      }
    };

    // Get frequency distribution for the baseline period
    const baselineAgg = {
      size: 0,
      query: baselineQuery,
      aggs: {
        timeseries: {
          date_histogram: {
            field: '@timestamp',
            fixed_interval: interval,
            min_doc_count: 0
          }
        }
      }
    };

    const baselineResp = await this.esAdapter.queryLogs(baselineAgg);
    const baselineBuckets = baselineResp.aggregations?.timeseries?.buckets || [];
    
    // Calculate baseline statistics
    let baselineTotal = 0;
    let baselineIntervals = 0;
    
    baselineBuckets.forEach((bucket: any) => {
      baselineTotal += bucket.doc_count;
      baselineIntervals++;
    });
    
    // Calculate average logs per interval in baseline
    const baselineAvg = baselineIntervals > 0 ? baselineTotal / baselineIntervals : 0;
    
    // Get frequency distribution for the current period
    const currentAgg = {
      size: 0,
      query: baseQuery,
      aggs: {
        timeseries: {
          date_histogram: {
            field: '@timestamp',
            fixed_interval: interval,
            min_doc_count: 0
          },
          aggs: {
            significant_terms: {
              significant_terms: {
                field: 'message.keyword',
                size: 10
              }
            }
          }
        }
      }
    };
    
    const currentResp = await this.esAdapter.queryLogs(currentAgg);
    const currentBuckets = currentResp.aggregations?.timeseries?.buckets || [];
    
    // Detect anomalies
    const anomalies: any[] = [];
    
    currentBuckets.forEach((bucket: any) => {
      const timestamp = bucket.key_as_string;
      const count = bucket.doc_count;
      
      // Skip intervals with no logs
      if (count === 0) return;
      
      // Calculate ratio compared to baseline
      const ratio = baselineAvg > 0 ? count / baselineAvg : 0;
      
      // Check if this interval is anomalous
      if (ratio >= spikeThreshold) {
        // Get significant terms for this interval if available
        const significantTerms = bucket.significant_terms?.buckets || [];
        const topTerms = significantTerms.map((term: any) => ({
          term: term.key,
          count: term.doc_count,
          score: term.score
        }));
        
        anomalies.push({
          timestamp,
          count,
          baseline_avg: baselineAvg,
          ratio,
          detection_method: 'frequency',
          anomaly_type: 'spike',
          significant_terms: topTerms,
          confidence_score: ratio / spikeThreshold,
          service: this.extractServiceFromBucket(bucket)
        });
      }
    });
    
    return anomalies;
  }

  /**
   * Detect pattern-based anomalies in logs
   */
  private async detectPatternAnomalies(
    baseQuery: any,
    patternKeywords: string[]
  ): Promise<any[]> {
    // Create pattern queries
    const patternQueries = patternKeywords.map(keyword => ({
      multi_match: {
        query: keyword,
        fields: [
          // Primary OpenTelemetry fields
          'body^3', 
          // Alternative fields
          'Body^3',
          'message^3',
          'exception.message^2',
          'error.message^2',
          'log.message',
          'attributes.*',
          'Resource.*'
        ],
        type: 'best_fields',
        operator: 'or'
      }
    }));
    
    // Create a query with pattern filters
    const patternQuery = {
      size: 100,
      query: {
        bool: {
          must: [
            baseQuery,
            {
              bool: {
                should: patternQueries,
                minimum_should_match: 1
              }
            }
          ]
        }
      },
      sort: [
        { '@timestamp': { order: 'desc' } }
      ]
    };
    
    // Execute the query
    const response = await this.esAdapter.queryLogs(patternQuery);
    const hits = response.hits?.hits || [];
    
    // Process results
    const anomalies: any[] = [];
    
    hits.forEach((hit: any) => {
      const source = hit._source || {};
      const message = source.body || source.Body || source.message || '';
      const timestamp = source['@timestamp'] || '';
      const level = source.severity || source.level || '';
      const serviceName = source.resource?.service?.name || 
                         source.Resource?.service?.name || 
                         source['Resource.service.name'] || 
                         source.service?.name || 
                         source['service.name'] || 'unknown';
      
      // Determine which patterns matched
      const matchedPatterns = patternKeywords.filter(pattern => 
        message.toLowerCase().includes(pattern.toLowerCase())
      );
      
      // Calculate confidence score based on number of matched patterns and severity
      let confidenceScore = matchedPatterns.length / patternKeywords.length;
      
      // Boost confidence for higher severity levels
      if (['error', 'err', 'fatal', 'critical', 'crit', 'alert', 'emerg'].some(
          sev => level.toLowerCase().includes(sev))) {
        confidenceScore *= 1.5;
      }
      
      anomalies.push({
        timestamp,
        message,
        level,
        matched_patterns: matchedPatterns,
        detection_method: 'pattern',
        confidence_score: Math.min(confidenceScore, 1),
        service: serviceName,
        _source: source
      });
    });
    
    return anomalies;
  }

  /**
   * Detect statistical anomalies in logs
   */
  private async detectStatisticalAnomalies(
    baseQuery: any,
    zScoreThreshold: number,
    percentileThreshold: number
  ): Promise<any[]> {
    // First, identify numeric fields in logs
    const sampleQuery = {
      size: 100,
      query: baseQuery,
      _source: ['*']
    };
    
    const sampleResp = await this.esAdapter.queryLogs(sampleQuery);
    const samples = sampleResp.hits?.hits || [];
    
    if (samples.length === 0) {
      return [];
    }
    
    // Identify potential numeric fields
    const numericFields = new Set<string>();
    
    // Helper function to recursively find numeric fields
    const findNumericFields = (obj: any, path = '') => {
      if (!obj || typeof obj !== 'object') return;
      
      Object.entries(obj).forEach(([key, value]) => {
        const currentPath = path ? `${path}.${key}` : key;
        
        // Skip timestamp fields
        if (currentPath.includes('timestamp') || currentPath.includes('time')) {
          return;
        }
        
        if (typeof value === 'number') {
          numericFields.add(currentPath);
        } else if (typeof value === 'object' && value !== null) {
          findNumericFields(value, currentPath);
        }
      });
    };
    
    // Process each sample
    samples.forEach((hit: any) => {
      findNumericFields(hit._source);
    });
    
    // Analyze each numeric field
    const anomalies: any[] = [];
    
    for (const field of numericFields) {
      // Skip fields that are likely not relevant for anomaly detection
      if (field.includes('offset') || field.includes('count') || field.includes('index')) {
        continue;
      }
      
      // Get statistics for this field
      const statsQuery = {
        size: 0,
        query: baseQuery,
        aggs: {
          field_stats: {
            stats: { field },
            extended_stats: { field }
          }
        }
      };
      
      const statsResp = await this.esAdapter.queryLogs(statsQuery);
      const stats = statsResp.aggregations?.field_stats;
      
      if (!stats || stats.count === 0) {
        continue;
      }
      
      // Calculate thresholds
      const mean = stats.avg;
      const stdDev = stats.std_deviation;
      const upperZScoreThreshold = mean + (zScoreThreshold * stdDev);
      const lowerZScoreThreshold = mean - (zScoreThreshold * stdDev);
      
      // Get percentile values
      const percentileQuery = {
        size: 0,
        query: baseQuery,
        aggs: {
          percentiles: {
            percentiles: {
              field,
              percents: [percentileThreshold, 100 - percentileThreshold]
            }
          }
        }
      };
      
      const percentileResp = await this.esAdapter.queryLogs(percentileQuery);
      const percentiles = percentileResp.aggregations?.percentiles?.values || {};
      
      const upperPercentileThreshold = percentiles[percentileThreshold.toString()];
      const lowerPercentileThreshold = percentiles[(100 - percentileThreshold).toString()];
      
      // Find logs with anomalous values
      const anomalyQuery = {
        size: 100,
        query: {
          bool: {
            must: [
              baseQuery,
              {
                bool: {
                  should: [
                    { range: { [field]: { gt: upperZScoreThreshold } } },
                    { range: { [field]: { lt: lowerZScoreThreshold } } },
                    { range: { [field]: { gt: upperPercentileThreshold } } },
                    { range: { [field]: { lt: lowerPercentileThreshold } } }
                  ],
                  minimum_should_match: 1
                }
              }
            ]
          }
        },
        sort: [
          { '@timestamp': { order: 'desc' } }
        ]
      };
      
      const anomalyResp = await this.esAdapter.queryLogs(anomalyQuery);
      const anomalyHits = anomalyResp.hits?.hits || [];
      
      // Process anomalous logs
      anomalyHits.forEach((hit: any) => {
        const source = hit._source || {};
        const value = this.getNestedValue(source, field);
        const timestamp = source['@timestamp'] || '';
        const message = source.body || source.Body || source.message || '';
        const serviceName = source.resource?.service?.name || 
                           source.Resource?.service?.name || 
                           source['Resource.service.name'] || 
                           source.service?.name || 
                           source['service.name'] || 'unknown';
        
        // Calculate z-score
        const zScore = stdDev !== 0 ? Math.abs((value - mean) / stdDev) : 0;
        
        // Determine which threshold was exceeded
        const detectionMethods: string[] = [];
        if (value > upperZScoreThreshold || value < lowerZScoreThreshold) {
          detectionMethods.push('zscore');
        }
        if (value > upperPercentileThreshold || value < lowerPercentileThreshold) {
          detectionMethods.push('percentile');
        }
        
        // Calculate confidence score based on how far the value is from normal
        const confidenceScore = Math.min(zScore / zScoreThreshold, 1);
        
        anomalies.push({
          timestamp,
          message,
          field,
          value,
          mean,
          std_dev: stdDev,
          z_score: zScore,
          detection_method: 'statistical',
          detection_methods: detectionMethods,
          confidence_score: confidenceScore,
          service: serviceName,
          _source: source
        });
      });
    }
    
    return anomalies;
  }

  /**
   * Detect clustering and cardinality anomalies in logs
   */
  private async detectClusteringAnomalies(
    startTime: string,
    endTime: string,
    baseQuery: any,
    cardinalityThreshold: number
  ): Promise<any[]> {
    // Calculate the lookback period start time (1 day before the start time)
    const lookbackStart = new Date(new Date(startTime).getTime() - 24 * 60 * 60 * 1000).toISOString();
    
    // Create a query for the baseline period
    const baselineQuery = {
      ...baseQuery,
      bool: {
        ...baseQuery.bool,
        must: [
          { range: { '@timestamp': { gte: lookbackStart, lt: startTime } } }
        ]
      }
    };
    
    // Get cardinality of message field in baseline period
    const baselineCardinalityQuery = {
      size: 0,
      query: baselineQuery,
      aggs: {
        message_cardinality: {
          cardinality: {
            field: 'message.keyword'
          }
        }
      }
    };
    
    const baselineResp = await this.esAdapter.queryLogs(baselineCardinalityQuery);
    const baselineCardinality = baselineResp.aggregations?.message_cardinality?.value || 0;
    
    // Get cardinality of message field in current period
    const currentCardinalityQuery = {
      size: 0,
      query: baseQuery,
      aggs: {
        message_cardinality: {
          cardinality: {
            field: 'message.keyword'
          }
        },
        significant_messages: {
          significant_terms: {
            field: 'message.keyword',
            size: 20
          }
        }
      }
    };
    
    const currentResp = await this.esAdapter.queryLogs(currentCardinalityQuery);
    const currentCardinality = currentResp.aggregations?.message_cardinality?.value || 0;
    const significantMessages = currentResp.aggregations?.significant_messages?.buckets || [];
    
    // Calculate cardinality ratio
    const cardinalityRatio = baselineCardinality > 0 
      ? currentCardinality / baselineCardinality 
      : currentCardinality > 0 ? cardinalityThreshold + 1 : 0;
    
    const anomalies: any[] = [];
    
    // Check if cardinality is anomalous
    if (cardinalityRatio >= cardinalityThreshold || cardinalityRatio <= 1/cardinalityThreshold) {
      // Get examples of the significant messages
      const significantMessageKeys = significantMessages.map((msg: any) => msg.key);
      
      if (significantMessageKeys.length > 0) {
        // Get sample logs for each significant message
        const samplesQuery = {
          size: 10,
          query: {
            bool: {
              must: [
                baseQuery,
                {
                  terms: {
                    'message.keyword': significantMessageKeys
                  }
                }
              ]
            }
          },
          sort: [
            { '@timestamp': { order: 'desc' } }
          ]
        };
        
        const samplesResp = await this.esAdapter.queryLogs(samplesQuery);
        const sampleHits = samplesResp.hits?.hits || [];
        
        // Process sample logs
        sampleHits.forEach((hit: any) => {
          const source = hit._source || {};
          const message = source.body || source.Body || source.message || '';
          const timestamp = source['@timestamp'] || '';
          const serviceName = source.resource?.service?.name || 
                             source.Resource?.service?.name || 
                             source['Resource.service.name'] || 
                             source.service?.name || 
                             source['service.name'] || 'unknown';
          
          // Find the significance score for this message
          const significanceInfo = significantMessages.find((msg: any) => msg.key === message);
          const significanceScore = significanceInfo ? significanceInfo.score : 0;
          
          // Calculate confidence score based on significance and cardinality ratio
          const confidenceScore = Math.min(
            (significanceScore / 10) * Math.abs(Math.log(cardinalityRatio)), 
            1
          );
          
          anomalies.push({
            timestamp,
            message,
            detection_method: 'clustering',
            anomaly_type: cardinalityRatio > 1 ? 'increased_cardinality' : 'decreased_cardinality',
            baseline_cardinality: baselineCardinality,
            current_cardinality: currentCardinality,
            cardinality_ratio: cardinalityRatio,
            significance_score: significanceScore,
            confidence_score: confidenceScore,
            service: serviceName,
            _source: source
          });
        });
      }
    }
    
    return anomalies;
  }

  /**
   * Helper function to extract service name from a bucket
   */
  private extractServiceFromBucket(bucket: any): string {
    // This is a placeholder - in a real implementation, we would
    // need to get the service from the bucket's contents
    return 'unknown';
  }

  /**
   * Helper function to get a nested value from an object
   */
  private getNestedValue(obj: any, path: string): any {
    const keys = path.split('.');
    return keys.reduce((o, key) => (o && o[key] !== undefined) ? o[key] : undefined, obj);
  }

  /**
   * Helper function to parse duration strings like "7d" into milliseconds
   */
  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)([dhms])$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000; // Default to 7 days
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 'd': return value * 24 * 60 * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'm': return value * 60 * 1000;
      case 's': return value * 1000;
      default: return 7 * 24 * 60 * 60 * 1000;
    }
  }
}
