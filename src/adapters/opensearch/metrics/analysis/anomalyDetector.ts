import { logger } from '../../../../utils/logger.js';
import { MetricsAdapterCore, TimeSeriesPoint } from '../metricCore.js';

/**
 * Anomaly detection configuration
 */
export interface AnomalyDetectionConfig {
  method?: 'zscore' | 'mad' | 'isolation' | 'percentile';
  sensitivity?: number; // 0-1, higher = more sensitive
  windowSize?: number; // For moving window calculations
  seasonality?: {
    enabled: boolean;
    period?: string; // '1d', '1w', etc.
  };
}

/**
 * Detected anomaly
 */
export interface Anomaly {
  timestamp: string;
  value: number;
  score: number; // 0-1, higher = more anomalous
  type: 'spike' | 'dip' | 'pattern' | 'level_shift';
  metadata: {
    expected?: number;
    stdDev?: number;
    percentile?: number;
    context?: string;
  };
}

/**
 * Anomaly detection result
 */
export interface AnomalyDetectionResult {
  anomalies: Anomaly[];
  statistics: {
    totalPoints: number;
    anomalyCount: number;
    anomalyRate: number;
    meanValue: number;
    stdDev: number;
  };
  thresholds: {
    upper: number;
    lower: number;
  };
}

/**
 * Clean, focused anomaly detection for metrics
 */
export class MetricAnomalyDetector {
  private readonly defaultConfig: Required<AnomalyDetectionConfig>;

  constructor(
    private readonly adapter: MetricsAdapterCore,
    config: AnomalyDetectionConfig = {}
  ) {
    this.defaultConfig = {
      method: config.method || 'zscore',
      sensitivity: config.sensitivity ?? 0.95,
      windowSize: config.windowSize || 30,
      seasonality: config.seasonality || { enabled: false }
    };
  }

  /**
   * Detect anomalies in a metric over a time range
   */
  public async detectAnomalies(
    metricName: string,
    timeRange: { from: string; to: string },
    config: AnomalyDetectionConfig = {}
  ): Promise<AnomalyDetectionResult> {
    const cfg = { ...this.defaultConfig, ...config };
    
    logger.info('[MetricAnomalyDetector] Detecting anomalies', {
      metric: metricName,
      timeRange,
      config: cfg
    });

    // Fetch metric data
    const timeSeries = await this.fetchTimeSeries(metricName, timeRange);
    
    if (timeSeries.length < cfg.windowSize) {
      logger.warn('[MetricAnomalyDetector] Insufficient data points', {
        required: cfg.windowSize,
        actual: timeSeries.length
      });
      return this.emptyResult();
    }

    // Remove seasonality if enabled
    const deseasonalized = cfg.seasonality.enabled 
      ? await this.removeSeasonality(timeSeries, cfg.seasonality.period!)
      : timeSeries;

    // Detect anomalies based on method
    let anomalies: Anomaly[];
    switch (cfg.method) {
      case 'zscore':
        anomalies = this.detectWithZScore(deseasonalized, cfg);
        break;
      case 'mad':
        anomalies = this.detectWithMAD(deseasonalized, cfg);
        break;
      case 'isolation':
        anomalies = this.detectWithIsolation(deseasonalized, cfg);
        break;
      case 'percentile':
        anomalies = this.detectWithPercentile(deseasonalized, cfg);
        break;
      default:
        anomalies = this.detectWithZScore(deseasonalized, cfg);
    }

    // Calculate statistics
    const values = timeSeries.map(p => p.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    // Calculate thresholds for visualization
    const zScore = this.getZScoreForSensitivity(cfg.sensitivity);
    const thresholds = {
      upper: mean + zScore * stdDev,
      lower: mean - zScore * stdDev
    };

    return {
      anomalies,
      statistics: {
        totalPoints: timeSeries.length,
        anomalyCount: anomalies.length,
        anomalyRate: anomalies.length / timeSeries.length,
        meanValue: mean,
        stdDev
      },
      thresholds
    };
  }

  /**
   * Compare anomaly patterns between two time periods
   */
  public async compareAnomalyPatterns(
    metricName: string,
    period1: { from: string; to: string },
    period2: { from: string; to: string },
    config: AnomalyDetectionConfig = {}
  ): Promise<{
    period1: AnomalyDetectionResult;
    period2: AnomalyDetectionResult;
    comparison: {
      anomalyRateChange: number;
      commonPatterns: string[];
      newAnomalyTypes: string[];
      significantChange: boolean;
    };
  }> {
    const [result1, result2] = await Promise.all([
      this.detectAnomalies(metricName, period1, config),
      this.detectAnomalies(metricName, period2, config)
    ]);

    const types1 = new Set(result1.anomalies.map(a => a.type));
    const types2 = new Set(result2.anomalies.map(a => a.type));
    
    const commonPatterns = Array.from(types1).filter(t => types2.has(t));
    const newAnomalyTypes = Array.from(types2).filter(t => !types1.has(t));
    
    const rateChange = result2.statistics.anomalyRate - result1.statistics.anomalyRate;
    const significantChange = Math.abs(rateChange) > 0.1; // 10% change

    return {
      period1: result1,
      period2: result2,
      comparison: {
        anomalyRateChange: rateChange,
        commonPatterns,
        newAnomalyTypes,
        significantChange
      }
    };
  }

  /**
   * Detect anomalies across multiple metrics
   */
  public async detectMultiMetricAnomalies(
    metrics: string[],
    timeRange: { from: string; to: string },
    config: AnomalyDetectionConfig = {}
  ): Promise<Map<string, AnomalyDetectionResult>> {
    logger.info('[MetricAnomalyDetector] Detecting anomalies for multiple metrics', {
      metricCount: metrics.length,
      timeRange
    });

    const results = await Promise.all(
      metrics.map(async (metric) => ({
        metric,
        result: await this.detectAnomalies(metric, timeRange, config)
      }))
    );

    return new Map(results.map(r => [r.metric, r.result]));
  }

  // Private methods

  private async fetchTimeSeries(
    metricName: string,
    timeRange: { from: string; to: string }
  ): Promise<TimeSeriesPoint[]> {
    const interval = this.calculateInterval(timeRange);
    
    const query = {
      size: 0,
      query: {
        bool: {
          must: [
            {
              range: {
                '@timestamp': {
                  gte: timeRange.from,
                  lte: timeRange.to
                }
              }
            },
            {
              exists: {
                field: metricName
              }
            }
          ]
        }
      },
      aggs: {
        time_series: {
          date_histogram: {
            field: '@timestamp',
            fixed_interval: interval,
            min_doc_count: 0,
            extended_bounds: {
              min: timeRange.from,
              max: timeRange.to
            }
          },
          aggs: {
            value: {
              avg: {
                field: metricName
              }
            }
          }
        }
      }
    };

    const result = await this.adapter.searchMetrics(query);
    
    return result.aggregations.time_series.buckets
      .map((bucket: any) => ({
        timestamp: bucket.key_as_string,
        value: bucket.value.value || 0
      }))
      .filter((point: TimeSeriesPoint) => point.value !== null);
  }

  private calculateInterval(timeRange: { from: string; to: string }): string {
    const start = new Date(timeRange.from).getTime();
    const end = new Date(timeRange.to).getTime();
    const duration = end - start;
    
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    
    if (duration <= hour) return '1m';
    if (duration <= day) return '5m';
    if (duration <= 7 * day) return '1h';
    if (duration <= 30 * day) return '6h';
    return '1d';
  }

  private detectWithZScore(
    timeSeries: TimeSeriesPoint[],
    config: Required<AnomalyDetectionConfig>
  ): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const values = timeSeries.map(p => p.value);
    
    // Calculate statistics
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    if (stdDev === 0) return anomalies;
    
    const threshold = this.getZScoreForSensitivity(config.sensitivity);
    
    timeSeries.forEach((point, index) => {
      const zScore = Math.abs((point.value - mean) / stdDev);
      
      if (zScore > threshold) {
        anomalies.push({
          timestamp: point.timestamp,
          value: point.value,
          score: Math.min(zScore / (threshold * 2), 1),
          type: point.value > mean ? 'spike' : 'dip',
          metadata: {
            expected: mean,
            stdDev,
            context: `Z-score: ${zScore.toFixed(2)}`
          }
        });
      }
    });
    
    return anomalies;
  }

  private detectWithMAD(
    timeSeries: TimeSeriesPoint[],
    config: Required<AnomalyDetectionConfig>
  ): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const values = timeSeries.map(p => p.value);
    
    // Calculate median
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    
    // Calculate MAD (Median Absolute Deviation)
    const deviations = values.map(v => Math.abs(v - median));
    const madSorted = [...deviations].sort((a, b) => a - b);
    const mad = madSorted[Math.floor(madSorted.length / 2)];
    
    if (mad === 0) return anomalies;
    
    const threshold = this.getMADThreshold(config.sensitivity);
    
    timeSeries.forEach((point) => {
      const modifiedZScore = 0.6745 * (point.value - median) / mad;
      
      if (Math.abs(modifiedZScore) > threshold) {
        anomalies.push({
          timestamp: point.timestamp,
          value: point.value,
          score: Math.min(Math.abs(modifiedZScore) / (threshold * 2), 1),
          type: point.value > median ? 'spike' : 'dip',
          metadata: {
            expected: median,
            context: `Modified Z-score: ${modifiedZScore.toFixed(2)}`
          }
        });
      }
    });
    
    return anomalies;
  }

  private detectWithIsolation(
    timeSeries: TimeSeriesPoint[],
    config: Required<AnomalyDetectionConfig>
  ): Anomaly[] {
    // Simplified isolation forest approach
    const anomalies: Anomaly[] = [];
    const windowSize = config.windowSize;
    
    for (let i = windowSize; i < timeSeries.length - windowSize; i++) {
      const window = timeSeries.slice(i - windowSize, i + windowSize + 1);
      const currentValue = timeSeries[i].value;
      
      // Calculate isolation score based on how different the point is from its neighbors
      const distances = window.map(p => Math.abs(p.value - currentValue));
      const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
      const maxDistance = Math.max(...distances);
      
      const isolationScore = avgDistance / (maxDistance || 1);
      
      if (isolationScore > (1 - config.sensitivity)) {
        anomalies.push({
          timestamp: timeSeries[i].timestamp,
          value: currentValue,
          score: isolationScore,
          type: 'pattern',
          metadata: {
            context: `Isolation score: ${isolationScore.toFixed(2)}`
          }
        });
      }
    }
    
    return anomalies;
  }

  private detectWithPercentile(
    timeSeries: TimeSeriesPoint[],
    config: Required<AnomalyDetectionConfig>
  ): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const values = timeSeries.map(p => p.value);
    const sorted = [...values].sort((a, b) => a - b);
    
    const lowerPercentile = (1 - config.sensitivity) / 2;
    const upperPercentile = 1 - lowerPercentile;
    
    const lowerThreshold = this.getPercentile(sorted, lowerPercentile * 100);
    const upperThreshold = this.getPercentile(sorted, upperPercentile * 100);
    
    timeSeries.forEach((point) => {
      if (point.value < lowerThreshold || point.value > upperThreshold) {
        const percentile = sorted.findIndex(v => v >= point.value) / sorted.length;
        
        anomalies.push({
          timestamp: point.timestamp,
          value: point.value,
          score: point.value > upperThreshold 
            ? (percentile - upperPercentile) / (1 - upperPercentile)
            : (lowerPercentile - percentile) / lowerPercentile,
          type: point.value > upperThreshold ? 'spike' : 'dip',
          metadata: {
            percentile: percentile * 100,
            context: `${(percentile * 100).toFixed(1)}th percentile`
          }
        });
      }
    });
    
    return anomalies;
  }

  private async removeSeasonality(
    timeSeries: TimeSeriesPoint[],
    period: string
  ): Promise<TimeSeriesPoint[]> {
    // Simple deseasonalization - in production, use proper time series decomposition
    const periodMs = this.parsePeriod(period);
    
    return timeSeries.map((point, index) => {
      const timestamp = new Date(point.timestamp).getTime();
      const seasonalIndex = Math.floor((timestamp % periodMs) / periodMs * 100);
      
      // Calculate seasonal average for this index
      const seasonalPoints = timeSeries.filter((p, i) => {
        const t = new Date(p.timestamp).getTime();
        return Math.floor((t % periodMs) / periodMs * 100) === seasonalIndex;
      });
      
      const seasonalAvg = seasonalPoints.reduce((sum, p) => sum + p.value, 0) / seasonalPoints.length;
      
      return {
        timestamp: point.timestamp,
        value: point.value - seasonalAvg + timeSeries.reduce((sum, p) => sum + p.value, 0) / timeSeries.length
      };
    });
  }

  private parsePeriod(period: string): number {
    const match = period.match(/^(\d+)([hdwm])$/);
    if (!match) return 24 * 60 * 60 * 1000; // Default 1 day
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      case 'w': return value * 7 * 24 * 60 * 60 * 1000;
      case 'm': return value * 30 * 24 * 60 * 60 * 1000;
      default: return 24 * 60 * 60 * 1000;
    }
  }

  private getZScoreForSensitivity(sensitivity: number): number {
    // Convert sensitivity (0-1) to z-score threshold
    // Higher sensitivity = lower threshold = more anomalies
    return 3 - (sensitivity * 2); // Range: 1-3
  }

  private getMADThreshold(sensitivity: number): number {
    // Convert sensitivity to MAD threshold
    return 3.5 - (sensitivity * 2); // Range: 1.5-3.5
  }

  private getPercentile(sorted: number[], percentile: number): number {
    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    
    if (lower === upper) {
      return sorted[lower];
    }
    
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  private emptyResult(): AnomalyDetectionResult {
    return {
      anomalies: [],
      statistics: {
        totalPoints: 0,
        anomalyCount: 0,
        anomalyRate: 0,
        meanValue: 0,
        stdDev: 0
      },
      thresholds: {
        upper: 0,
        lower: 0
      }
    };
  }
}