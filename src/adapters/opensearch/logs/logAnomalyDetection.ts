import { logger } from '../../../utils/logger.js';
import { LogsAdapterCore } from './logCore.js';

/**
 * OpenSearch Logs Anomaly Detection Adapter
 * Provides functionality for detecting anomalies in OpenTelemetry logs data using OpenSearch ML capabilities
 */
export class LogsAnomalyDetectionAdapter extends LogsAdapterCore {
  constructor(options: any) {
    super(options);
  }

  /**
   * Detect log anomalies using OpenSearch's Random Cut Forest algorithm
   * This leverages OpenSearch's ML capabilities for anomaly detection
   */
  public async detectLogAnomalies(
    startTime: string, 
    endTime: string, 
    options: {
      service?: string,
      level?: string,
      queryString?: string,
      maxResults?: number,
      minCount?: number
    } = {}
  ): Promise<any> {
    logger.info('[OpenSearch LogsAnomalyDetectionAdapter] Detecting log anomalies', { startTime, endTime, options });
    
    try {
      const indexPattern = 'logs-*';
      const maxResults = options.maxResults || 20;
      const minCount = options.minCount || 2;
      
      // Build the query filters
      const filters = [
        {
          range: {
            "@timestamp": {
              gte: startTime,
              lte: endTime
            }
          }
        }
      ] as any[];
      
      // Add service filter if specified
      if (options.service) {
        filters.push({
          term: {
            "resource.attributes.service.name": options.service
          }
        });
      }
      
      // Add log level filter if specified
      if (options.level) {
        filters.push({
          term: {
            "severity_text": options.level
          }
        });
      }
      
      // Add additional query string if specified
      if (options.queryString) {
        filters.push({
          query_string: {
            query: options.queryString
          }
        });
      }
      
      // First, get the log messages and their counts
      const countQuery = {
        query: {
          bool: {
            filter: filters
          }
        },
        size: 0,
        aggs: {
          message_counts: {
            terms: {
              field: "body.keyword",
              size: 10000,
              min_doc_count: minCount
            }
          }
        }
      };
      
      const countResponse = await this.callRequest('POST', `/${indexPattern}/_search`, countQuery);
      
      if (!countResponse.aggregations?.message_counts?.buckets) {
        return { anomalies: [], message: "No log messages found" };
      }
      
      const messageBuckets = countResponse.aggregations.message_counts.buckets;
      
      // Now use OpenSearch's Random Cut Forest algorithm for anomaly detection
      // This is different from Elasticsearch's approach
      const rcfQuery = {
        query: {
          bool: {
            filter: filters
          }
        },
        size: 0,
        aggs: {
          timeseries: {
            date_histogram: {
              field: "@timestamp",
              fixed_interval: "1m"
            },
            aggs: {
              message_count: {
                value_count: {
                  field: "body.keyword"
                }
              },
              rcf: {
                random_cut_forest: {
                  field: "message_count",
                  shingle_size: 8,
                  sample_size: 256,
                  output_after: 32,
                  time_decay: 0.1,
                  anomaly_score_threshold: 2.0
                }
              }
            }
          }
        }
      };
      
      // Use OpenSearch's anomaly detection plugin API
      const anomalyDetectionEndpoint = "/_plugins/_anomaly_detection/detectors";
      
      // Create a temporary detector for this analysis
      const detectorConfig = {
        name: `log_anomaly_detector_${Date.now()}`,
        description: "Temporary detector for log anomaly detection",
        time_field: "@timestamp",
        indices: [indexPattern],
        feature_attributes: [
          {
            feature_name: "log_count",
            feature_enabled: true,
            aggregation_query: {
              value_count: {
                field: "body.keyword"
              }
            }
          }
        ],
        filter_query: {
          bool: {
            filter: filters
          }
        },
        detection_interval: {
          period: {
            interval: 1,
            unit: "MINUTES"
          }
        },
        window_delay: {
          period: {
            interval: 1,
            unit: "MINUTES"
          }
        }
      };
      
      // Create the detector
      const createDetectorResponse = await this.callRequest('POST', anomalyDetectionEndpoint, detectorConfig);
      const detectorId = createDetectorResponse.detector_id;
      
      // Start the detector
      await this.callRequest('POST', `${anomalyDetectionEndpoint}/${detectorId}/_start`, {});
      
      // Wait for the detector to initialize
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Get the results
      const resultsResponse = await this.callRequest('GET', `${anomalyDetectionEndpoint}/${detectorId}/results?size=${maxResults}`, {});
      
      // Clean up - stop and delete the detector
      await this.callRequest('POST', `${anomalyDetectionEndpoint}/${detectorId}/_stop`, {});
      await this.callRequest('DELETE', `${anomalyDetectionEndpoint}/${detectorId}`, {});
      
      // Process the results
      const anomalies: any[] = [];
      
      if (resultsResponse.anomaly_result && resultsResponse.anomaly_result.anomalies) {
        for (const anomaly of resultsResponse.anomaly_result.anomalies) {
          // Find the corresponding log message
          const matchingBucket = messageBuckets.find((bucket: any) => {
            const timestamp = new Date(anomaly.start_time).getTime();
            const bucketTime = new Date(bucket.key_as_string).getTime();
            return Math.abs(timestamp - bucketTime) < 60000; // Within 1 minute
          });
          
          if (matchingBucket) {
            anomalies.push({
              timestamp: anomaly.start_time,
              message: matchingBucket.key,
              count: matchingBucket.doc_count,
              anomaly_grade: anomaly.anomaly_grade,
              confidence: anomaly.confidence
            });
          }
        }
      }
      
      // Sort anomalies by anomaly grade
      anomalies.sort((a, b) => b.anomaly_grade - a.anomaly_grade);
      
      return {
        anomalies: anomalies.slice(0, maxResults),
        message: anomalies.length > 0 
          ? `Found ${anomalies.length} anomalous log patterns` 
          : "No anomalies detected"
      };
    } catch (error: any) {
      logger.error('[OpenSearch LogsAnomalyDetectionAdapter] Error detecting log anomalies', { error });
      return { 
        anomalies: [], 
        error: error.message || error,
        message: "Failed to detect log anomalies"
      };
    }
  }
}
