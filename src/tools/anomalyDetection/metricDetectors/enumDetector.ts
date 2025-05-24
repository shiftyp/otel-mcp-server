import { MetricAnomaly, MetricAnomalyOptions } from '../types.js';
import { logger } from '../../../utils/logger.js';

/**
 * Detector for enum metrics (metrics with a limited set of discrete values)
 */
export class EnumAnomalyDetector {
  /**
   * Detect anomalies in enum metrics
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
      logger.warn(`[Enum Anomaly] Not enough data points for enum anomaly detection: ${metricField}`);
      return { anomalies: [], stats: { count: 0 } };
    }

    // Analyze the distribution of values
    const uniqueValues = new Set(values);
    const valueCounts: Record<number, number> = {};
    const valueTransitions: Record<string, number> = {};
    
    // Count occurrences of each value
    values.forEach(val => {
      valueCounts[val] = (valueCounts[val] || 0) + 1;
    });
    
    // Count transitions between values
    for (let i = 1; i < values.length; i++) {
      const transition = `${values[i-1]}->${values[i]}`;
      valueTransitions[transition] = (valueTransitions[transition] || 0) + 1;
    }
    
    // Calculate frequency of each value
    const valueFrequencies: Record<number, number> = {};
    Object.entries(valueCounts).forEach(([val, count]) => {
      valueFrequencies[Number(val)] = count / values.length;
    });
    
    // Find rare values (values that occur less than 5% of the time)
    const rareValues = Object.entries(valueFrequencies)
      .filter(([_, freq]) => freq < 0.05)
      .map(([val, _]) => Number(val));
    
    const anomalies: MetricAnomaly[] = [];
    
    // Detect occurrences of rare values
    for (let i = 0; i < values.length; i++) {
      if (rareValues.includes(values[i])) {
        anomalies.push({
          timestamp: timestamps[i],
          value: values[i],
          expectedValue: 0, // Using 0 instead of null to avoid type issues
          deviation: 0,
          detectionMethod: 'rare-value',
          metricField,
          threshold: 0.05,
          type: 'rare-value',
          field: metricField,
          message: `Rare value ${values[i]} detected (frequency: ${(valueFrequencies[values[i]] * 100).toFixed(2)}%)`
        });
      }
    }
    
    // Detect unusual transitions between values
    const transitionFrequencies: Record<string, number> = {};
    Object.entries(valueTransitions).forEach(([transition, count]) => {
      transitionFrequencies[transition] = count / (values.length - 1);
    });
    
    const rareTransitions = Object.entries(transitionFrequencies)
      .filter(([_, freq]) => freq < 0.03) // Transitions that occur less than 3% of the time
      .map(([transition, _]) => transition);
    
    for (let i = 1; i < values.length; i++) {
      const transition = `${values[i-1]}->${values[i]}`;
      if (rareTransitions.includes(transition)) {
        anomalies.push({
          timestamp: timestamps[i],
          value: values[i],
          expectedValue: values[i-1],
          deviation: 0,
          detectionMethod: 'rare-transition',
          metricField,
          threshold: 0.03,
          type: 'rare-transition',
          field: metricField,
          message: `Rare transition from ${values[i-1]} to ${values[i]} detected (frequency: ${(transitionFrequencies[transition] * 100).toFixed(2)}%)`
        });
      }
    }
    
    return { 
      anomalies, 
      stats: {
        uniqueValues: Array.from(uniqueValues),
        valueCounts,
        valueFrequencies,
        transitionCounts: valueTransitions,
        transitionFrequencies,
        count: values.length
      } 
    };
  }
}
