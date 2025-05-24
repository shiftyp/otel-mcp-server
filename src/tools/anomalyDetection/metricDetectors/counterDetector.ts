import { MetricAnomaly, MetricAnomalyOptions } from '../types.js';
import { logger } from '../../../utils/logger.js';
import { calculateStatistics } from './utils.js';

/**
 * Detector for counter metrics (generally increasing but can reset)
 */
export class CounterAnomalyDetector {
  /**
   * Detect anomalies in regular counter metrics (that can reset)
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
      logger.warn(`[Counter Anomaly] Not enough data points for counter anomaly detection: ${metricField}`);
      return { anomalies: [], stats: { count: 0 } };
    }

    // Identify counter resets
    const resets: { index: number; fromValue: number; toValue: number }[] = [];
    for (let i = 1; i < values.length; i++) {
      if (values[i] < values[i-1] * 0.5) { // Significant drop indicates a reset
        resets.push({ index: i, fromValue: values[i-1], toValue: values[i] });
      }
    }

    // Calculate rate of change between consecutive data points, accounting for resets
    const rateOfChange: number[] = [];
    const rateTimestamps: string[] = [];
    
    for (let i = 1; i < values.length; i++) {
      // Skip rate calculation at reset points
      if (resets.some(reset => reset.index === i)) {
        continue;
      }
      
      const timeDiff = new Date(timestamps[i]).getTime() - new Date(timestamps[i-1]).getTime();
      const timeDiffSeconds = timeDiff / 1000;
      
      if (timeDiffSeconds > 0) {
        const valueDiff = values[i] - values[i-1];
        const rate = valueDiff / timeDiffSeconds; // Rate per second
        rateOfChange.push(rate);
        rateTimestamps.push(timestamps[i]);
      }
    }

    // Calculate statistics on the rate of change
    const stats = calculateStatistics(rateOfChange);
    const anomalies: MetricAnomaly[] = [];

    // Analyze reset patterns
    if (resets.length > 1) {
      // Calculate time between resets
      const resetIntervals: number[] = [];
      for (let i = 1; i < resets.length; i++) {
        const timeDiff = new Date(timestamps[resets[i].index]).getTime() - 
                         new Date(timestamps[resets[i-1].index]).getTime();
        resetIntervals.push(timeDiff);
      }
      
      // Check for unusual reset intervals
      if (resetIntervals.length > 2) {
        const resetStats = calculateStatistics(resetIntervals);
        const zScoreThreshold = options.zScoreThreshold || 3;
        
        for (let i = 0; i < resetIntervals.length; i++) {
          const zScore = (resetIntervals[i] - resetStats.mean) / resetStats.stdDev;
          if (Math.abs(zScore) > zScoreThreshold) {
            const resetIndex = resets[i+1].index;
            anomalies.push({
              timestamp: timestamps[resetIndex],
              value: resetIntervals[i],
              expectedValue: resetStats.mean,
              deviation: zScore,
              detectionMethod: 'reset-interval',
              metricField,
              zScore,
              threshold: zScoreThreshold,
              type: 'reset-interval',
              field: metricField,
              message: `Unusual time between counter resets: ${(resetIntervals[i] / (1000 * 60)).toFixed(2)} minutes (z-score: ${zScore.toFixed(2)})`
            });
          }
        }
      }
    }

    // Detect unusual acceleration or deceleration (similar to monotonic counters)
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

    // Add anomalies for each reset (informational)
    resets.forEach(reset => {
      anomalies.push({
        timestamp: timestamps[reset.index],
        value: reset.toValue,
        expectedValue: reset.fromValue,
        deviation: -1, // -100% (full reset)
        detectionMethod: 'counter-reset',
        metricField,
        threshold: 0,
        type: 'counter-reset',
        field: metricField,
        message: `Counter reset from ${reset.fromValue.toFixed(2)} to ${reset.toValue.toFixed(2)}`
      });
    });

    return { 
      anomalies, 
      stats: {
        ...stats,
        resets: {
          count: resets.length,
          locations: resets.map(r => ({ timestamp: timestamps[r.index], fromValue: r.fromValue, toValue: r.toValue }))
        },
        originalValues: {
          min: Math.min(...values),
          max: Math.max(...values),
          count: values.length
        }
      } 
    };
  }
}
