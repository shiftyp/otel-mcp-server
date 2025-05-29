import { logger } from '../../../utils/logger.js';

/**
 * Trace anomaly detection using OpenSearch's neural network capabilities
 */
export class TraceAnomalyDetection {
  /**
   * Detect anomalies in trace patterns using OpenSearch's neural network-based anomaly detection
   * @param client The OpenSearch client to use for requests
   * @param traceData Array of trace data points
   * @param options Configuration options
   */
  public static async detectAnomalies(
    client: any,
    traceData: Array<{
      traceId: string;
      serviceName: string;
      operationName: string;
      duration: number;
      timestamp: string;
      status: string;
      attributes?: Record<string, any>;
    }>,
    options: {
      sensitivity?: number;
      windowSize?: number;
      features?: string[];
    } = {}
  ): Promise<any> {
    logger.info('[TraceAnomalyDetection] Detecting anomalies in traces', { 
      dataPoints: traceData.length, 
      options 
    });
    
    try {
      const sensitivity = options.sensitivity || 0.7;
      const windowSize = options.windowSize || 10;
      const features = options.features || ['duration'];
      
      // Group traces by service and operation
      const groupedTraces: Record<string, any[]> = {};
      
      for (const trace of traceData) {
        const key = `${trace.serviceName}:${trace.operationName}`;
        if (!groupedTraces[key]) {
          groupedTraces[key] = [];
        }
        groupedTraces[key].push(trace);
      }
      
      // Process each group separately
      const results: Record<string, any> = {};
      
      for (const [key, traces] of Object.entries(groupedTraces)) {
        // Skip groups with too few traces
        if (traces.length < windowSize * 2) {
          continue;
        }
        
        // Sort by timestamp
        traces.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        
        // Extract feature vectors
        const featureVectors: number[][] = [];
        
        for (const trace of traces) {
          const vector: number[] = [];
          
          // Add requested features to vector
          for (const feature of features) {
            if (feature === 'duration') {
              vector.push(trace.duration);
            } else if (feature === 'status' && trace.status) {
              // Convert status to numeric (0 = OK, 1 = ERROR)
              vector.push(trace.status === 'ERROR' ? 1 : 0);
            } else if (trace.attributes && trace.attributes[feature] !== undefined) {
              // Add custom attribute if available
              const value = trace.attributes[feature];
              vector.push(typeof value === 'number' ? value : 0);
            } else {
              // Default to 0 if feature not available
              vector.push(0);
            }
          }
          
          featureVectors.push(vector);
        }
        
        // Use OpenSearch's neural network-based anomaly detection
        // This uses the Random Cut Forest algorithm under the hood
        const adEndpoint = '/_plugins/_ml/ad';
        
        // Create a temporary detector
        const detectorConfig = {
          name: `trace_anomaly_detector_${Date.now()}`,
          description: "Temporary detector for trace anomaly detection",
          time_field: "timestamp",
          indices: ["traces-*"],
          feature_attributes: features.map(feature => ({
            feature_name: feature,
            feature_enabled: true,
            aggregation_query: {
              [feature === 'duration' ? 'avg' : 'value_count']: {
                field: feature === 'duration' ? 'duration' : (feature === 'status' ? 'status.code' : feature)
              }
            }
          })),
          detection_interval: {
            period: {
              interval: 1,
              unit: "MINUTES"
            }
          }
        };
        
        // Create the detector
        const createDetectorResponse = await client.request('POST', adEndpoint, detectorConfig);
        const detectorId = createDetectorResponse.detector_id;
        
        // Use the Neural Network API directly for real-time detection
        const nnEndpoint = '/_plugins/_ml/neural';
        const nnRequest = {
          algorithm: 'rcf', // Random Cut Forest
          parameters: {
            num_trees: 50,
            sample_size: Math.min(256, Math.max(50, Math.floor(featureVectors.length * 0.1))),
            anomaly_score_threshold: sensitivity,
            time_decay: 0.1,
            output_after: windowSize
          },
          input_data: {
            feature_vectors: featureVectors
          }
        };
        
        const nnResponse = await client.request('POST', nnEndpoint, nnRequest);
        
        // Clean up - delete the temporary detector
        await client.request('DELETE', `${adEndpoint}/${detectorId}`);
        
        // Process the results
        const anomalies: any[] = [];
        
        if (nnResponse.anomaly_results) {
          for (let i = 0; i < nnResponse.anomaly_results.length; i++) {
            const result = nnResponse.anomaly_results[i];
            
            if (result.anomaly_score >= sensitivity) {
              anomalies.push({
                traceId: traces[i].traceId,
                serviceName: traces[i].serviceName,
                operationName: traces[i].operationName,
                timestamp: traces[i].timestamp,
                duration: traces[i].duration,
                status: traces[i].status,
                anomalyScore: result.anomaly_score,
                confidence: result.confidence || (1 - (1 / result.anomaly_score))
              });
            }
          }
        }
        
        // Sort anomalies by score (descending)
        anomalies.sort((a, b) => b.anomalyScore - a.anomalyScore);
        
        results[key] = {
          serviceName: traces[0].serviceName,
          operationName: traces[0].operationName,
          anomalies,
          anomalyCount: anomalies.length,
          totalTraces: traces.length,
          anomalyPercentage: traces.length > 0 
            ? (anomalies.length / traces.length) * 100 
            : 0
        };
      }
      
      // Aggregate results
      const allAnomalies = Object.values(results).flatMap(r => r.anomalies);
      allAnomalies.sort((a, b) => b.anomalyScore - a.anomalyScore);
      
      return {
        serviceOperationResults: results,
        anomalies: allAnomalies,
        totalAnomalies: allAnomalies.length,
        totalTraces: traceData.length,
        anomalyPercentage: traceData.length > 0 
          ? (allAnomalies.length / traceData.length) * 100 
          : 0,
        message: allAnomalies.length > 0 
          ? `Found ${allAnomalies.length} anomalous traces` 
          : 'No anomalies detected'
      };
    } catch (error) {
      logger.error('[TraceAnomalyDetection] Error detecting anomalies in traces', { error });
      return { 
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to detect anomalies in traces'
      };
    }
  }
  
  /**
   * Detect service health anomalies using multivariate analysis
   * @param client The OpenSearch client to use for requests
   * @param serviceData Array of service metrics
   * @param options Configuration options
   */
  public static async detectServiceHealthAnomalies(
    client: any,
    serviceData: Array<{
      serviceName: string;
      timestamp: string;
      errorRate: number;
      latency: number;
      throughput: number;
      saturation?: number;
    }>,
    options: {
      sensitivity?: number;
      features?: Array<'errorRate' | 'latency' | 'throughput' | 'saturation'>;
    } = {}
  ): Promise<any> {
    logger.info('[TraceAnomalyDetection] Detecting service health anomalies', { 
      dataPoints: serviceData.length, 
      options 
    });
    
    try {
      const sensitivity = options.sensitivity || 0.7;
      const features = options.features || ['errorRate', 'latency', 'throughput'];
      
      // Group data by service
      const groupedData: Record<string, any[]> = {};
      
      for (const data of serviceData) {
        if (!groupedData[data.serviceName]) {
          groupedData[data.serviceName] = [];
        }
        groupedData[data.serviceName].push(data);
      }
      
      // Process each service separately
      const results: Record<string, any> = {};
      
      for (const [serviceName, dataPoints] of Object.entries(groupedData)) {
        // Skip services with too few data points
        if (dataPoints.length < 10) {
          continue;
        }
        
        // Sort by timestamp
        dataPoints.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        
        // Extract feature vectors
        const featureVectors: number[][] = [];
        
        for (const point of dataPoints) {
          const vector: number[] = [];
          
          // Add requested features to vector
          for (const feature of features) {
            vector.push(point[feature] || 0);
          }
          
          featureVectors.push(vector);
        }
        
        // Use OpenSearch's multivariate anomaly detection
        const mvadEndpoint = '/_plugins/_ml/ad/multivariate';
        const mvadRequest = {
          parameters: {
            method: 'pca', // Principal Component Analysis
            sensitivity: sensitivity,
            training_data_size: Math.floor(featureVectors.length * 0.7) // Use 70% for training
          },
          input_data: {
            feature_vectors: featureVectors
          }
        };
        
        const mvadResponse = await client.request('POST', mvadEndpoint, mvadRequest);
        
        // Process the results
        const anomalies: any[] = [];
        
        if (mvadResponse.anomaly_results) {
          for (let i = 0; i < mvadResponse.anomaly_results.length; i++) {
            const result = mvadResponse.anomaly_results[i];
            
            if (result.anomaly_score >= sensitivity) {
              anomalies.push({
                serviceName,
                timestamp: dataPoints[i].timestamp,
                errorRate: dataPoints[i].errorRate,
                latency: dataPoints[i].latency,
                throughput: dataPoints[i].throughput,
                saturation: dataPoints[i].saturation,
                anomalyScore: result.anomaly_score,
                featureContributions: result.feature_contributions || {},
                confidence: result.confidence || (1 - (1 / result.anomaly_score))
              });
            }
          }
        }
        
        // Sort anomalies by score (descending)
        anomalies.sort((a, b) => b.anomalyScore - a.anomalyScore);
        
        results[serviceName] = {
          serviceName,
          anomalies,
          anomalyCount: anomalies.length,
          totalDataPoints: dataPoints.length,
          anomalyPercentage: dataPoints.length > 0 
            ? (anomalies.length / dataPoints.length) * 100 
            : 0
        };
      }
      
      // Aggregate results
      const allAnomalies = Object.values(results).flatMap(r => r.anomalies);
      allAnomalies.sort((a, b) => b.anomalyScore - a.anomalyScore);
      
      return {
        serviceResults: results,
        anomalies: allAnomalies,
        totalAnomalies: allAnomalies.length,
        totalDataPoints: serviceData.length,
        anomalyPercentage: serviceData.length > 0 
          ? (allAnomalies.length / serviceData.length) * 100 
          : 0,
        message: allAnomalies.length > 0 
          ? `Found ${allAnomalies.length} service health anomalies` 
          : 'No service health anomalies detected'
      };
    } catch (error) {
      logger.error('[TraceAnomalyDetection] Error detecting service health anomalies', { error });
      return { 
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to detect service health anomalies'
      };
    }
  }
}
