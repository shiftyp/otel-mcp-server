import { logger } from '../../../../utils/logger.js';
import { ILogsAdapter } from '../core/interface.js';
import { LogAnalyzer, LogEntry } from './logAnalyzer.js';

/**
 * Time series analysis options
 */
export interface TimeSeriesOptions {
  timeRange?: { from: string; to: string };
  service?: string | string[];
  level?: string | string[];
  interval?: string;
  includeForecasting?: boolean;
  forecastPeriods?: number;
}

/**
 * Time series data point
 */
export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
  metadata?: any;
}

/**
 * Time series analysis result
 */
export interface TimeSeriesAnalysis {
  series: TimeSeriesPoint[];
  trend: {
    direction: 'increasing' | 'decreasing' | 'stable';
    strength: number;
    changeRate: number;
  };
  seasonality: {
    detected: boolean;
    period?: string;
    strength?: number;
  };
  anomalies: Array<{
    timestamp: string;
    value: number;
    expectedValue: number;
    deviation: number;
  }>;
  forecast?: TimeSeriesPoint[];
  statistics: {
    mean: number;
    stdDev: number;
    min: number;
    max: number;
    total: number;
  };
}

/**
 * Clean log time series analysis
 */
export class LogTimeSeriesAnalyzer {
  constructor(
    private readonly adapter: ILogsAdapter,
    private readonly analyzer: LogAnalyzer
  ) {}

  /**
   * Analyze log time series
   */
  public async analyze(
    options: TimeSeriesOptions = {}
  ): Promise<TimeSeriesAnalysis> {
    const interval = options.interval || '5m';
    
    logger.info('[LogTimeSeriesAnalyzer] Analyzing time series', {
      options,
      interval
    });

    try {
      // Fetch time series data
      const series = await this.fetchTimeSeries(options);
      
      if (series.length === 0) {
        return this.createEmptyAnalysis();
      }

      // Calculate basic statistics
      const values = series.map(p => p.value);
      const statistics = this.calculateStatistics(values);

      // Detect trend
      const trend = this.detectTrend(series);

      // Detect seasonality
      const seasonality = this.detectSeasonality(series);

      // Detect anomalies
      const anomalies = this.detectTimeSeriesAnomalies(series);

      // Generate forecast if requested
      let forecast: TimeSeriesPoint[] | undefined;
      if (options.includeForecasting) {
        forecast = this.generateForecast(
          series,
          options.forecastPeriods || 6,
          interval
        );
      }

      return {
        series,
        trend,
        seasonality,
        anomalies,
        forecast,
        statistics
      };
    } catch (error) {
      logger.error('[LogTimeSeriesAnalyzer] Error analyzing time series', { error });
      throw error;
    }
  }

  /**
   * Forecast log volume
   */
  public async forecast(
    metric: string = 'count',
    options: TimeSeriesOptions = {}
  ): Promise<{
    historical: TimeSeriesPoint[];
    forecast: TimeSeriesPoint[];
    confidence: {
      lower: TimeSeriesPoint[];
      upper: TimeSeriesPoint[];
    };
    accuracy: {
      method: string;
      mape: number;
      rmse: number;
    };
  }> {
    const periods = options.forecastPeriods || 12;
    
    logger.info('[LogTimeSeriesAnalyzer] Generating forecast', {
      metric,
      periods,
      options
    });

    try {
      // Get historical data
      const analysis = await this.analyze({
        ...options,
        includeForecasting: false
      });

      const historical = analysis.series;
      
      if (historical.length < 10) {
        throw new Error('Insufficient historical data for forecasting');
      }

      // Generate forecast with different methods
      const simpleMA = this.simpleMovingAverageForecast(historical, periods);
      const linearTrend = this.linearTrendForecast(historical, periods);
      const exponentialSmoothing = this.exponentialSmoothingForecast(historical, periods);

      // Choose best method based on historical accuracy
      const { bestForecast, accuracy } = this.selectBestForecast(
        historical,
        [
          { method: 'SMA', forecast: simpleMA },
          { method: 'Linear', forecast: linearTrend },
          { method: 'Exponential', forecast: exponentialSmoothing }
        ]
      );

      // Generate confidence intervals
      const confidence = this.generateConfidenceIntervals(
        bestForecast,
        analysis.statistics.stdDev
      );

      return {
        historical,
        forecast: bestForecast,
        confidence,
        accuracy
      };
    } catch (error) {
      logger.error('[LogTimeSeriesAnalyzer] Error generating forecast', { error });
      throw error;
    }
  }

  /**
   * Compare time series between different periods or services
   */
  public async compare(
    baseline: TimeSeriesOptions,
    comparison: TimeSeriesOptions,
    options: { alignTimestamps?: boolean } = {}
  ): Promise<{
    baseline: TimeSeriesAnalysis;
    comparison: TimeSeriesAnalysis;
    differences: {
      volumeChange: number;
      trendChange: string;
      anomalyChange: number;
      correlation: number;
    };
    insights: string[];
  }> {
    logger.info('[LogTimeSeriesAnalyzer] Comparing time series');

    try {
      const [baselineAnalysis, comparisonAnalysis] = await Promise.all([
        this.analyze(baseline),
        this.analyze(comparison)
      ]);

      // Calculate differences
      const volumeChange = this.calculateVolumeChange(
        baselineAnalysis.statistics.total,
        comparisonAnalysis.statistics.total
      );

      const trendChange = this.compareTrends(
        baselineAnalysis.trend,
        comparisonAnalysis.trend
      );

      const anomalyChange = comparisonAnalysis.anomalies.length - baselineAnalysis.anomalies.length;

      const correlation = this.calculateCorrelation(
        baselineAnalysis.series,
        comparisonAnalysis.series,
        options.alignTimestamps
      );

      // Generate insights
      const insights = this.generateComparisonInsights(
        baselineAnalysis,
        comparisonAnalysis,
        { volumeChange, trendChange, anomalyChange, correlation }
      );

      return {
        baseline: baselineAnalysis,
        comparison: comparisonAnalysis,
        differences: {
          volumeChange,
          trendChange,
          anomalyChange,
          correlation
        },
        insights
      };
    } catch (error) {
      logger.error('[LogTimeSeriesAnalyzer] Error comparing time series', { error });
      throw error;
    }
  }

  // Private helper methods

  private async fetchTimeSeries(options: TimeSeriesOptions): Promise<TimeSeriesPoint[]> {
    const interval = options.interval || '5m';
    const query: any = {
      size: 0,
      query: { bool: { must: [], filter: [] } },
      aggs: {
        time_buckets: {
          date_histogram: {
            field: '@timestamp',
            fixed_interval: interval,
            min_doc_count: 0
          },
          aggs: {
            log_count: {
              value_count: {
                field: '@timestamp'
              }
            }
          }
        }
      }
    };

    if (options.timeRange) {
      query.query.bool.filter.push({
        range: {
          '@timestamp': {
            gte: options.timeRange.from,
            lte: options.timeRange.to
          }
        }
      });
    }

    if (options.service) {
      const services = Array.isArray(options.service) ? options.service : [options.service];
      query.query.bool.filter.push({
        terms: { 'service.name': services }
      });
    }

    if (options.level) {
      const levels = Array.isArray(options.level) ? options.level : [options.level];
      query.query.bool.filter.push({
        terms: { level: levels.map(l => l.toLowerCase()) }
      });
    }

    const response = await this.adapter.searchLogs(query);
    const buckets = response.aggregations?.time_buckets?.buckets || [];

    return buckets.map((bucket: any) => ({
      timestamp: bucket.key_as_string,
      value: bucket.doc_count,
      metadata: {
        logCount: bucket.log_count?.value || bucket.doc_count
      }
    }));
  }

  private createEmptyAnalysis(): TimeSeriesAnalysis {
    return {
      series: [],
      trend: {
        direction: 'stable',
        strength: 0,
        changeRate: 0
      },
      seasonality: {
        detected: false
      },
      anomalies: [],
      statistics: {
        mean: 0,
        stdDev: 0,
        min: 0,
        max: 0,
        total: 0
      }
    };
  }

  private calculateStatistics(values: number[]): {
    mean: number;
    stdDev: number;
    min: number;
    max: number;
    total: number;
  } {
    if (values.length === 0) {
      return { mean: 0, stdDev: 0, min: 0, max: 0, total: 0 };
    }

    const total = values.reduce((sum, v) => sum + v, 0);
    const mean = total / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    return {
      mean,
      stdDev,
      min: Math.min(...values),
      max: Math.max(...values),
      total
    };
  }

  private detectTrend(series: TimeSeriesPoint[]): {
    direction: 'increasing' | 'decreasing' | 'stable';
    strength: number;
    changeRate: number;
  } {
    if (series.length < 2) {
      return { direction: 'stable', strength: 0, changeRate: 0 };
    }

    // Simple linear regression
    const n = series.length;
    const x = series.map((_, i) => i);
    const y = series.map(p => p.value);

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate R-squared for strength
    const yMean = sumY / n;
    const ssTotal = y.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
    const ssResidual = y.reduce((sum, yi, i) => {
      const predicted = slope * i + intercept;
      return sum + Math.pow(yi - predicted, 2);
    }, 0);
    const rSquared = 1 - (ssResidual / ssTotal);

    // Determine direction and calculate change rate
    const firstValue = series[0].value;
    const lastValue = series[series.length - 1].value;
    const changeRate = firstValue > 0 ? (lastValue - firstValue) / firstValue : 0;

    let direction: 'increasing' | 'decreasing' | 'stable';
    if (Math.abs(slope) < 0.1) {
      direction = 'stable';
    } else {
      direction = slope > 0 ? 'increasing' : 'decreasing';
    }

    return {
      direction,
      strength: Math.max(0, Math.min(1, rSquared)),
      changeRate
    };
  }

  private detectSeasonality(series: TimeSeriesPoint[]): {
    detected: boolean;
    period?: string;
    strength?: number;
  } {
    if (series.length < 24) { // Need at least 24 points for meaningful seasonality
      return { detected: false };
    }

    // Simple autocorrelation approach
    const values = series.map(p => p.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    
    // Check for common periods (hourly, daily patterns)
    const periods = [12, 24, 48]; // 1 hour, 2 hours, 4 hours (assuming 5m intervals)
    let maxCorrelation = 0;
    let bestPeriod = 0;

    for (const period of periods) {
      if (period >= values.length) continue;
      
      let correlation = 0;
      let count = 0;
      
      for (let i = period; i < values.length; i++) {
        correlation += (values[i] - mean) * (values[i - period] - mean);
        count++;
      }
      
      if (count > 0) {
        correlation = correlation / count;
        if (Math.abs(correlation) > Math.abs(maxCorrelation)) {
          maxCorrelation = correlation;
          bestPeriod = period;
        }
      }
    }

    // Normalize correlation
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const normalizedCorrelation = variance > 0 ? maxCorrelation / variance : 0;

    if (Math.abs(normalizedCorrelation) > 0.3) {
      return {
        detected: true,
        period: `${bestPeriod * 5}m`,
        strength: Math.abs(normalizedCorrelation)
      };
    }

    return { detected: false };
  }

  private detectTimeSeriesAnomalies(series: TimeSeriesPoint[]): Array<{
    timestamp: string;
    value: number;
    expectedValue: number;
    deviation: number;
  }> {
    if (series.length < 3) return [];

    const anomalies: Array<{
      timestamp: string;
      value: number;
      expectedValue: number;
      deviation: number;
    }> = [];

    // Use simple moving average with standard deviation
    const windowSize = Math.min(5, Math.floor(series.length / 4));
    
    for (let i = windowSize; i < series.length; i++) {
      const window = series.slice(i - windowSize, i).map(p => p.value);
      const mean = window.reduce((a, b) => a + b, 0) / window.length;
      const stdDev = Math.sqrt(
        window.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / window.length
      );
      
      const currentValue = series[i].value;
      const zscore = stdDev > 0 ? Math.abs(currentValue - mean) / stdDev : 0;
      
      if (zscore > 3) {
        anomalies.push({
          timestamp: series[i].timestamp,
          value: currentValue,
          expectedValue: mean,
          deviation: zscore
        });
      }
    }

    return anomalies;
  }

  private generateForecast(
    series: TimeSeriesPoint[],
    periods: number,
    interval: string
  ): TimeSeriesPoint[] {
    // Use exponential smoothing for forecasting
    return this.exponentialSmoothingForecast(series, periods);
  }

  private simpleMovingAverageForecast(
    series: TimeSeriesPoint[],
    periods: number
  ): TimeSeriesPoint[] {
    const windowSize = Math.min(5, Math.floor(series.length / 4));
    const lastValues = series.slice(-windowSize).map(p => p.value);
    const avgValue = lastValues.reduce((a, b) => a + b, 0) / windowSize;
    
    const forecast: TimeSeriesPoint[] = [];
    const lastTimestamp = new Date(series[series.length - 1].timestamp);
    const intervalMs = series.length > 1 
      ? new Date(series[1].timestamp).getTime() - new Date(series[0].timestamp).getTime()
      : 5 * 60 * 1000; // Default 5 minutes

    for (let i = 1; i <= periods; i++) {
      const timestamp = new Date(lastTimestamp.getTime() + i * intervalMs);
      forecast.push({
        timestamp: timestamp.toISOString(),
        value: avgValue
      });
    }

    return forecast;
  }

  private linearTrendForecast(
    series: TimeSeriesPoint[],
    periods: number
  ): TimeSeriesPoint[] {
    const trend = this.detectTrend(series);
    const lastValue = series[series.length - 1].value;
    const avgChange = trend.changeRate * lastValue / series.length;
    
    const forecast: TimeSeriesPoint[] = [];
    const lastTimestamp = new Date(series[series.length - 1].timestamp);
    const intervalMs = series.length > 1 
      ? new Date(series[1].timestamp).getTime() - new Date(series[0].timestamp).getTime()
      : 5 * 60 * 1000;

    for (let i = 1; i <= periods; i++) {
      const timestamp = new Date(lastTimestamp.getTime() + i * intervalMs);
      forecast.push({
        timestamp: timestamp.toISOString(),
        value: Math.max(0, lastValue + avgChange * i)
      });
    }

    return forecast;
  }

  private exponentialSmoothingForecast(
    series: TimeSeriesPoint[],
    periods: number,
    alpha: number = 0.3
  ): TimeSeriesPoint[] {
    if (series.length === 0) return [];

    // Calculate smoothed values
    const smoothed: number[] = [series[0].value];
    for (let i = 1; i < series.length; i++) {
      smoothed.push(alpha * series[i].value + (1 - alpha) * smoothed[i - 1]);
    }

    const lastSmoothed = smoothed[smoothed.length - 1];
    const forecast: TimeSeriesPoint[] = [];
    const lastTimestamp = new Date(series[series.length - 1].timestamp);
    const intervalMs = series.length > 1 
      ? new Date(series[1].timestamp).getTime() - new Date(series[0].timestamp).getTime()
      : 5 * 60 * 1000;

    for (let i = 1; i <= periods; i++) {
      const timestamp = new Date(lastTimestamp.getTime() + i * intervalMs);
      forecast.push({
        timestamp: timestamp.toISOString(),
        value: lastSmoothed
      });
    }

    return forecast;
  }

  private selectBestForecast(
    historical: TimeSeriesPoint[],
    candidates: Array<{ method: string; forecast: TimeSeriesPoint[] }>
  ): {
    bestForecast: TimeSeriesPoint[];
    accuracy: { method: string; mape: number; rmse: number };
  } {
    // Use a simple holdout validation
    const trainSize = Math.floor(historical.length * 0.8);
    const train = historical.slice(0, trainSize);
    const test = historical.slice(trainSize);

    let bestMethod = candidates[0];
    let bestMAPE = Infinity;

    for (const candidate of candidates) {
      const testForecast = candidate.method === 'SMA' 
        ? this.simpleMovingAverageForecast(train, test.length)
        : candidate.method === 'Linear'
        ? this.linearTrendForecast(train, test.length)
        : this.exponentialSmoothingForecast(train, test.length);

      const mape = this.calculateMAPE(test, testForecast);
      if (mape < bestMAPE) {
        bestMAPE = mape;
        bestMethod = candidate;
      }
    }

    const rmse = this.calculateRMSE(
      test,
      bestMethod.forecast.slice(0, test.length)
    );

    return {
      bestForecast: bestMethod.forecast,
      accuracy: {
        method: bestMethod.method,
        mape: bestMAPE,
        rmse
      }
    };
  }

  private calculateMAPE(actual: TimeSeriesPoint[], forecast: TimeSeriesPoint[]): number {
    let sum = 0;
    let count = 0;

    for (let i = 0; i < Math.min(actual.length, forecast.length); i++) {
      if (actual[i].value > 0) {
        sum += Math.abs(actual[i].value - forecast[i].value) / actual[i].value;
        count++;
      }
    }

    return count > 0 ? (sum / count) * 100 : 0;
  }

  private calculateRMSE(actual: TimeSeriesPoint[], forecast: TimeSeriesPoint[]): number {
    let sum = 0;
    let count = 0;

    for (let i = 0; i < Math.min(actual.length, forecast.length); i++) {
      sum += Math.pow(actual[i].value - forecast[i].value, 2);
      count++;
    }

    return count > 0 ? Math.sqrt(sum / count) : 0;
  }

  private generateConfidenceIntervals(
    forecast: TimeSeriesPoint[],
    stdDev: number
  ): {
    lower: TimeSeriesPoint[];
    upper: TimeSeriesPoint[];
  } {
    const z = 1.96; // 95% confidence interval
    
    return {
      lower: forecast.map(p => ({
        timestamp: p.timestamp,
        value: Math.max(0, p.value - z * stdDev)
      })),
      upper: forecast.map(p => ({
        timestamp: p.timestamp,
        value: p.value + z * stdDev
      }))
    };
  }

  private calculateVolumeChange(baseline: number, comparison: number): number {
    return baseline > 0 ? ((comparison - baseline) / baseline) * 100 : 0;
  }

  private compareTrends(
    baseline: any,
    comparison: any
  ): string {
    if (baseline.direction === comparison.direction) {
      return 'same direction';
    } else if (
      (baseline.direction === 'increasing' && comparison.direction === 'decreasing') ||
      (baseline.direction === 'decreasing' && comparison.direction === 'increasing')
    ) {
      return 'reversed';
    } else {
      return 'changed';
    }
  }

  private calculateCorrelation(
    series1: TimeSeriesPoint[],
    series2: TimeSeriesPoint[],
    align?: boolean
  ): number {
    // Simple correlation calculation
    // In a real implementation, this would handle alignment and interpolation
    const minLength = Math.min(series1.length, series2.length);
    if (minLength < 2) return 0;

    const values1 = series1.slice(0, minLength).map(p => p.value);
    const values2 = series2.slice(0, minLength).map(p => p.value);

    const mean1 = values1.reduce((a, b) => a + b, 0) / values1.length;
    const mean2 = values2.reduce((a, b) => a + b, 0) / values2.length;

    let numerator = 0;
    let denominator1 = 0;
    let denominator2 = 0;

    for (let i = 0; i < minLength; i++) {
      const diff1 = values1[i] - mean1;
      const diff2 = values2[i] - mean2;
      
      numerator += diff1 * diff2;
      denominator1 += diff1 * diff1;
      denominator2 += diff2 * diff2;
    }

    const denominator = Math.sqrt(denominator1 * denominator2);
    return denominator === 0 ? 0 : numerator / denominator;
  }

  private generateComparisonInsights(
    baseline: TimeSeriesAnalysis,
    comparison: TimeSeriesAnalysis,
    differences: any
  ): string[] {
    const insights: string[] = [];

    // Volume change insight
    if (Math.abs(differences.volumeChange) > 20) {
      insights.push(
        `Log volume ${differences.volumeChange > 0 ? 'increased' : 'decreased'} by ${Math.abs(differences.volumeChange).toFixed(0)}%`
      );
    }

    // Trend change insight
    if (differences.trendChange === 'reversed') {
      insights.push(
        `Trend reversed from ${baseline.trend.direction} to ${comparison.trend.direction}`
      );
    }

    // Anomaly change insight
    if (differences.anomalyChange !== 0) {
      insights.push(
        `Anomaly count ${differences.anomalyChange > 0 ? 'increased' : 'decreased'} by ${Math.abs(differences.anomalyChange)}`
      );
    }

    // Seasonality insight
    if (baseline.seasonality.detected !== comparison.seasonality.detected) {
      insights.push(
        comparison.seasonality.detected 
          ? `Seasonality emerged with ${comparison.seasonality.period} period`
          : 'Previously detected seasonality disappeared'
      );
    }

    // Correlation insight
    if (Math.abs(differences.correlation) > 0.7) {
      insights.push(
        `Series show ${differences.correlation > 0 ? 'strong positive' : 'strong negative'} correlation (${differences.correlation.toFixed(2)})`
      );
    }

    return insights;
  }
}