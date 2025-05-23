import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { logger } from '../../utils/logger.js';
import { FrequencyDetector } from './frequencyDetector.js';
import { PatternDetector } from './patternDetector.js';
import { StatisticalDetector } from './statisticalDetector.js';
import { ClusteringDetector } from './clusteringDetector.js';
import { LogAnomalyOptions } from './types.js';

/**
 * Tool for detecting anomalies in logs using a hybrid approach that combines
 * multiple detection strategies without requiring ML models.
 */
export class LogAnomalyDetectionTool {
  private frequencyDetector: FrequencyDetector;
  private patternDetector: PatternDetector;
  private statisticalDetector: StatisticalDetector;
  private clusteringDetector: ClusteringDetector;

  constructor(private esAdapter: ElasticsearchAdapter) {
    this.frequencyDetector = new FrequencyDetector(esAdapter);
    this.patternDetector = new PatternDetector(esAdapter);
    this.statisticalDetector = new StatisticalDetector(esAdapter);
    this.clusteringDetector = new ClusteringDetector(esAdapter);
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
    options: LogAnomalyOptions = {}
  ) {
    logger.info('[LogAnomalyDetectionTool] Detecting log anomalies', { 
      startTime, 
      endTime, 
      serviceOrServices,
      options 
    });

    // Default methods if not specified
    const methods = options.methods || ['frequency', 'pattern', 'statistical', 'clustering'];
    const results: any = { anomalies: [] };
    
    try {
      // Run each detection method in parallel
      const detectionPromises = [];
      
      if (methods.includes('frequency')) {
        detectionPromises.push(
          this.frequencyDetector.detectAnomalies(startTime, endTime, serviceOrServices, options)
            .then(anomalies => {
              results.frequencyAnomalies = anomalies;
              results.anomalies.push(...anomalies);
            })
        );
      }
      
      if (methods.includes('pattern')) {
        detectionPromises.push(
          this.patternDetector.detectAnomalies(startTime, endTime, serviceOrServices, options)
            .then(anomalies => {
              results.patternAnomalies = anomalies;
              results.anomalies.push(...anomalies);
            })
        );
      }
      
      if (methods.includes('statistical')) {
        detectionPromises.push(
          this.statisticalDetector.detectAnomalies(startTime, endTime, serviceOrServices, options)
            .then(anomalies => {
              results.statisticalAnomalies = anomalies;
              results.anomalies.push(...anomalies);
            })
        );
      }
      
      if (methods.includes('clustering')) {
        detectionPromises.push(
          this.clusteringDetector.detectAnomalies(startTime, endTime, serviceOrServices, options)
            .then(anomalies => {
              results.clusteringAnomalies = anomalies;
              results.anomalies.push(...anomalies);
            })
        );
      }
      
      // Wait for all detection methods to complete
      await Promise.all(detectionPromises);
      
      // Sort anomalies by score (descending)
      results.anomalies.sort((a: any, b: any) => b.score - a.score);
      
      // Limit results if maxResults is specified
      if (options.maxResults && results.anomalies.length > options.maxResults) {
        results.anomalies = results.anomalies.slice(0, options.maxResults);
      }
      
      results.totalAnomalies = results.anomalies.length;
      
      return results;
    } catch (error) {
      logger.error('[LogAnomalyDetectionTool] Error detecting log anomalies', { error });
      return { error: 'Error detecting log anomalies', details: String(error) };
    }
  }
}

// Re-export the types and detectors for external use
export * from './types.js';
export * from './frequencyDetector.js';
export * from './patternDetector.js';
export * from './statisticalDetector.js';
export * from './clusteringDetector.js';
