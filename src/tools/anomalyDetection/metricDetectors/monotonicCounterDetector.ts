import { MetricAnomaly, MetricAnomalyOptions } from '../types.js';
import { logger } from '../../../utils/logger.js';
import { calculateStatistics } from './utils.js';

/**
 * Detector for monotonic counter metrics (always increasing or staying the same)
 */
export class MonotonicCounterAnomalyDetector {
  /**
   * Detect anomalies in monotonic counter metrics
   * @param metricField The metric field to analyze
   * @param timeSeriesData Time series data for the metric
   * @param options Anomaly detection options
   * @returns Detected anomalies and statistics
   */
  static async detectAnomalies(
    metricField: string,
    timeSeriesData: any[],
    options: MetricAnomalyOptions
  ): Promise<{ anomalies: MetricAnomaly[]; stats: any }> {
    // Extract values and timestamps
    const values: number[] = [];
    const timestamps: string[] = [];
    const buckets = timeSeriesData;

    buckets.forEach((bucket: any) => {
      const value = bucket.metric_value?.avg;
      if (value !== null && value !== undefined) {
        values.push(value);
        timestamps.push(bucket.key_as_string);
      }
    });

    if (values.length < 5) {
      logger.warn(`[Monotonic Counter Anomaly] Not enough data points for monotonic counter anomaly detection: ${metricField}`);
      return { anomalies: [], stats: { count: 0 } };
    }

    // For monotonic counters, we're more interested in the rate of change than absolute values
    const rateOfChange: number[] = [];
    const rateTimestamps: string[] = [];
    
    // Calculate rate of change between consecutive data points
    for (let i = 1; i < values.length; i++) {
      const timeDiff = new Date(timestamps[i]).getTime() - new Date(timestamps[i-1]).getTime();
      const timeDiffSeconds = timeDiff / 1000;
      
      // Only calculate rate if time difference is positive
      if (timeDiffSeconds > 0) {
        const valueDiff = values[i] - values[i-1];
        const rate = valueDiff / timeDiffSeconds; // Rate per second
        rateOfChange.push(rate);
        rateTimestamps.push(timestamps[i]);
      }
    }

    if (rateOfChange.length < 3) {
      logger.warn(`[Monotonic Counter Anomaly] Not enough rate data points for monotonic counter anomaly detection: ${metricField}`);
      return { anomalies: [], stats: { count: 0 } };
    }

    // Calculate statistics on the rate of change
    const stats = calculateStatistics(rateOfChange);
    const anomalies: MetricAnomaly[] = [];

    // Detect plateaus (periods where the counter stops increasing)
    for (let i = 0; i < rateOfChange.length; i++) {
      if (rateOfChange[i] === 0 && values[i+1] > 1) { // Only consider plateaus for non-trivial counters
        // Calculate a meaningful deviation value - use 1.0 as a minimum to ensure it's detected
        const deviation = Math.max(1.0, stats.mean > 0 ? Math.abs(stats.mean - rateOfChange[i]) / stats.mean : 1.0);
        
        anomalies.push({
          timestamp: rateTimestamps[i],
          value: values[i+1], // Use the actual counter value instead of rate
          expectedValue: values[i+1] + (stats.mean * 60), // Expected value after 1 minute at mean rate
          deviation: deviation, // Meaningful deviation value
          detectionMethod: 'plateau',
          metricField,
          threshold: 0,
          type: 'plateau',
          field: metricField,
          message: `Counter has plateaued (stopped increasing) at value ${values[i+1].toFixed(2)}`
        });
      }
    }

    // Detect unusual acceleration or deceleration
    const zScoreThreshold = options.zScoreThreshold || 3;
    for (let i = 0; i < rateOfChange.length; i++) {
      const zScore = (rateOfChange[i] - stats.mean) / stats.stdDev;
      if (Math.abs(zScore) > zScoreThreshold) {
        anomalies.push({
          timestamp: rateTimestamps[i],
          value: rateOfChange[i],
          expectedValue: stats.mean,
          deviation: zScore,
          detectionMethod: 'rate-z-score',
          metricField,
          zScore,
          threshold: zScoreThreshold,
          type: 'rate-change',
          field: metricField,
          message: `Rate of change (${rateOfChange[i].toFixed(2)}/s) has z-score of ${zScore.toFixed(2)}, exceeding threshold of ${zScoreThreshold}`
        });
      }
    }

    // Detect percentile-based anomalies in rate of change
    const percentileThreshold = options.percentileThreshold || 95;
    const percentileValue = stats[`p${percentileThreshold}`];
    for (let i = 0; i < rateOfChange.length; i++) {
      if (rateOfChange[i] > percentileValue) {
        anomalies.push({
          timestamp: rateTimestamps[i],
          value: rateOfChange[i],
          expectedValue: percentileValue,
          deviation: (rateOfChange[i] - percentileValue) / percentileValue,
          detectionMethod: 'rate-percentile',
          metricField,
          percentile: percentileThreshold,
          threshold: percentileThreshold,
          type: 'rate-percentile',
          field: metricField,
          message: `Rate of change (${rateOfChange[i].toFixed(2)}/s) exceeds ${percentileThreshold}th percentile (${percentileValue.toFixed(2)}/s)`
        });
      }
    }

    return { 
      anomalies, 
      stats: {
        ...stats,
        originalValues: {
          min: Math.min(...values),
          max: Math.max(...values),
          count: values.length
        }
      } 
    };
  }
}
