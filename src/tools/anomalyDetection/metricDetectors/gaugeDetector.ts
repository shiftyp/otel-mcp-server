import { MetricAnomaly, MetricAnomalyOptions } from '../types.js';
import { logger } from '../../../utils/logger.js';
import { calculateStatistics } from './utils.js';

/**
 * Detector for gauge metrics (metrics that can go up and down freely)
 */
export class GaugeAnomalyDetector {
  /**
   * Detect anomalies in gauge metrics using statistical methods
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
      logger.warn(`[Gauge Anomaly] Not enough data points for gauge anomaly detection: ${metricField}`);
      return { anomalies: [], stats: { count: 0 } };
    }

    // Calculate statistics
    const stats = calculateStatistics(values);
    const anomalies: MetricAnomaly[] = [];

    // Z-score based detection
    const zScoreThreshold = options.zScoreThreshold || 3;
    for (let i = 0; i < values.length; i++) {
      const zScore = (values[i] - stats.mean) / stats.stdDev;
      if (Math.abs(zScore) > zScoreThreshold) {
        anomalies.push({
          timestamp: timestamps[i],
          value: values[i],
          expectedValue: stats.mean,
          deviation: zScore,
          detectionMethod: 'z-score',
          metricField,
          zScore,
          threshold: zScoreThreshold,
          type: 'z-score',
          field: metricField,
          message: `Z-score of ${zScore.toFixed(2)} exceeds threshold of ${zScoreThreshold}`
        });
      }
    }

    // Percentile based detection
    const percentileThreshold = options.percentileThreshold || 95;
    const percentileValue = stats[`p${percentileThreshold}`];
    for (let i = 0; i < values.length; i++) {
      if (values[i] > percentileValue) {
        anomalies.push({
          timestamp: timestamps[i],
          value: values[i],
          expectedValue: percentileValue,
          deviation: (values[i] - percentileValue) / percentileValue,
          detectionMethod: 'percentile',
          metricField,
          percentile: percentileThreshold,
          threshold: percentileThreshold,
          type: 'percentile',
          field: metricField,
          message: `Value ${values[i].toFixed(2)} exceeds ${percentileThreshold}th percentile (${percentileValue.toFixed(2)})`
        });
      }
    }

    // IQR based detection
    const iqrMultiplier = options.iqrMultiplier || 1.5;
    const lowerBound = stats.q1 - iqrMultiplier * stats.iqr;
    const upperBound = stats.q3 + iqrMultiplier * stats.iqr;
    for (let i = 0; i < values.length; i++) {
      if (values[i] < lowerBound || values[i] > upperBound) {
        anomalies.push({
          timestamp: timestamps[i],
          value: values[i],
          expectedValue: values[i] < lowerBound ? lowerBound : upperBound,
          deviation: values[i] < lowerBound ? (lowerBound - values[i]) / stats.iqr : (values[i] - upperBound) / stats.iqr,
          detectionMethod: 'iqr',
          metricField,
          threshold: iqrMultiplier,
          type: 'iqr',
          field: metricField,
          message: `Value ${values[i].toFixed(2)} is outside IQR bounds [${lowerBound.toFixed(2)}, ${upperBound.toFixed(2)}]`
        });
      }
    }

    // Rate of change detection
    const changeThreshold = options.changeThreshold || 0.5; // 50% change
    for (let i = 1; i < values.length; i++) {
      const prevValue = values[i - 1];
      const currentValue = values[i];
      if (prevValue !== 0) {
        const changeRate = Math.abs((currentValue - prevValue) / prevValue);
        if (changeRate > changeThreshold) {
          anomalies.push({
            timestamp: timestamps[i],
            value: currentValue,
            expectedValue: prevValue,
            deviation: changeRate,
            detectionMethod: 'change-rate',
            metricField,
            changeRate,
            threshold: changeThreshold,
            type: 'change-rate',
            field: metricField,
            message: `Change rate of ${(changeRate * 100).toFixed(2)}% exceeds threshold of ${(changeThreshold * 100).toFixed(2)}%`
          });
        }
      }
    }

    return { anomalies, stats };
  }
}
