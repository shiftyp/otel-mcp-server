import { logger } from '../../../../utils/logger.js';
import { MetricsAdapterCore, TimeSeriesPoint } from '../metricCore.js';

/**
 * Time series analysis configuration
 */
export interface TimeSeriesConfig {
  interval?: string;
  fillMissing?: 'zero' | 'interpolate' | 'previous' | 'none';
  smoothing?: {
    enabled: boolean;
    method?: 'sma' | 'ema' | 'lowess';
    window?: number;
  };
}

/**
 * Trend information
 */
export interface TrendInfo {
  direction: 'increasing' | 'decreasing' | 'stable';
  strength: number; // 0-1
  slope: number;
  rSquared: number;
  changeRate: number; // Percentage change
}

/**
 * Seasonality information
 */
export interface SeasonalityInfo {
  detected: boolean;
  period?: string;
  strength?: number; // 0-1
  components?: Array<{
    frequency: number;
    amplitude: number;
    phase: number;
  }>;
}

/**
 * Forecast point
 */
export interface ForecastPoint {
  timestamp: string;
  value: number;
  lower: number; // Confidence interval
  upper: number;
  confidence: number;
}

/**
 * Time series analysis result
 */
export interface TimeSeriesAnalysisResult {
  timeSeries: TimeSeriesPoint[];
  statistics: {
    mean: number;
    median: number;
    stdDev: number;
    min: number;
    max: number;
    cv: number; // Coefficient of variation
  };
  trend: TrendInfo;
  seasonality: SeasonalityInfo;
  forecast?: ForecastPoint[];
  changePoints?: Array<{
    timestamp: string;
    type: 'increase' | 'decrease' | 'variance';
    magnitude: number;
  }>;
}

/**
 * Clean time series analysis service
 */
export class TimeSeriesAnalyzer {
  private readonly defaultConfig: Required<TimeSeriesConfig>;

  constructor(
    private readonly adapter: MetricsAdapterCore,
    config: TimeSeriesConfig = {}
  ) {
    this.defaultConfig = {
      interval: config.interval || 'auto',
      fillMissing: config.fillMissing || 'interpolate',
      smoothing: {
        enabled: config.smoothing?.enabled ?? false,
        method: config.smoothing?.method || 'sma',
        window: config.smoothing?.window || 5
      }
    };
  }

  /**
   * Analyze a time series
   */
  public async analyze(
    metricName: string,
    timeRange: { from: string; to: string },
    config: TimeSeriesConfig = {}
  ): Promise<TimeSeriesAnalysisResult> {
    const cfg = { ...this.defaultConfig, ...config };
    
    logger.info('[TimeSeriesAnalyzer] Analyzing time series', {
      metric: metricName,
      timeRange,
      config: cfg
    });

    // Fetch time series data
    let timeSeries = await this.fetchTimeSeries(metricName, timeRange, cfg.interval);
    
    // Fill missing values
    if (cfg.fillMissing !== 'none') {
      timeSeries = this.fillMissingValues(timeSeries, cfg.fillMissing);
    }
    
    // Apply smoothing if enabled
    if (cfg.smoothing.enabled) {
      timeSeries = this.smoothTimeSeries(timeSeries, cfg.smoothing.method!, cfg.smoothing.window!);
    }
    
    // Calculate statistics
    const statistics = this.calculateStatistics(timeSeries);
    
    // Analyze trend
    const trend = this.analyzeTrend(timeSeries);
    
    // Detect seasonality
    const seasonality = this.detectSeasonality(timeSeries);
    
    // Detect change points
    const changePoints = this.detectChangePoints(timeSeries);
    
    return {
      timeSeries,
      statistics,
      trend,
      seasonality,
      changePoints
    };
  }

  /**
   * Forecast future values
   */
  public async forecast(
    metricName: string,
    historicalRange: { from: string; to: string },
    forecastPeriods: number,
    config: TimeSeriesConfig & { confidence?: number } = {}
  ): Promise<ForecastPoint[]> {
    const confidence = config.confidence || 0.95;
    
    logger.info('[TimeSeriesAnalyzer] Generating forecast', {
      metric: metricName,
      historicalRange,
      forecastPeriods,
      confidence
    });

    // Analyze historical data
    const analysis = await this.analyze(metricName, historicalRange, config);
    
    // Generate forecast based on trend and seasonality
    return this.generateForecast(
      analysis.timeSeries,
      analysis.trend,
      analysis.seasonality,
      forecastPeriods,
      confidence
    );
  }

  /**
   * Compare two time series
   */
  public async compare(
    metric1: string,
    metric2: string,
    timeRange: { from: string; to: string },
    config: TimeSeriesConfig = {}
  ): Promise<{
    correlation: number;
    crossCorrelation: Array<{ lag: number; correlation: number }>;
    similarity: number;
    leadLagRelationship?: {
      leader: string;
      lagger: string;
      lag: number;
      confidence: number;
    };
  }> {
    logger.info('[TimeSeriesAnalyzer] Comparing time series', {
      metric1,
      metric2,
      timeRange
    });

    // Fetch both time series
    const [series1, series2] = await Promise.all([
      this.analyze(metric1, timeRange, config),
      this.analyze(metric2, timeRange, config)
    ]);
    
    // Align time series
    const { aligned1, aligned2 } = this.alignTimeSeries(
      series1.timeSeries,
      series2.timeSeries
    );
    
    // Calculate correlation
    const correlation = this.calculateCorrelation(aligned1, aligned2);
    
    // Calculate cross-correlation at different lags
    const crossCorrelation = this.calculateCrossCorrelation(aligned1, aligned2);
    
    // Calculate overall similarity
    const similarity = this.calculateSimilarity(series1, series2);
    
    // Detect lead-lag relationship
    const leadLag = this.detectLeadLagRelationship(crossCorrelation, metric1, metric2);
    
    return {
      correlation,
      crossCorrelation,
      similarity,
      leadLagRelationship: leadLag
    };
  }

  // Private methods

  private async fetchTimeSeries(
    metricName: string,
    timeRange: { from: string; to: string },
    interval: string
  ): Promise<TimeSeriesPoint[]> {
    const calculatedInterval = interval === 'auto' 
      ? this.calculateOptimalInterval(timeRange)
      : interval;
    
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
            fixed_interval: calculatedInterval,
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
    
    return result.aggregations.time_series.buckets.map((bucket: any) => ({
      timestamp: bucket.key_as_string,
      value: bucket.value.value || 0
    }));
  }

  private calculateOptimalInterval(timeRange: { from: string; to: string }): string {
    const start = new Date(timeRange.from).getTime();
    const end = new Date(timeRange.to).getTime();
    const duration = end - start;
    const targetPoints = 100; // Aim for ~100 data points
    
    const intervalMs = duration / targetPoints;
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    
    if (intervalMs <= minute) return '1m';
    if (intervalMs <= 5 * minute) return '5m';
    if (intervalMs <= 10 * minute) return '10m';
    if (intervalMs <= 30 * minute) return '30m';
    if (intervalMs <= hour) return '1h';
    if (intervalMs <= 6 * hour) return '6h';
    if (intervalMs <= day) return '1d';
    return '1w';
  }

  private fillMissingValues(
    timeSeries: TimeSeriesPoint[],
    method: 'zero' | 'interpolate' | 'previous' | 'none'
  ): TimeSeriesPoint[] {
    if (method === 'none' || timeSeries.length < 2) return timeSeries;
    
    const filled: TimeSeriesPoint[] = [];
    
    for (let i = 0; i < timeSeries.length; i++) {
      const current = timeSeries[i];
      
      if (current.value === null || current.value === undefined) {
        let fillValue = 0;
        
        switch (method) {
          case 'zero':
            fillValue = 0;
            break;
          case 'previous':
            fillValue = i > 0 ? filled[i - 1].value : 0;
            break;
          case 'interpolate':
            // Linear interpolation
            let prevIndex = i - 1;
            let nextIndex = i + 1;
            
            while (prevIndex >= 0 && (timeSeries[prevIndex].value === null || timeSeries[prevIndex].value === undefined)) {
              prevIndex--;
            }
            
            while (nextIndex < timeSeries.length && (timeSeries[nextIndex].value === null || timeSeries[nextIndex].value === undefined)) {
              nextIndex++;
            }
            
            if (prevIndex >= 0 && nextIndex < timeSeries.length) {
              const prevValue = timeSeries[prevIndex].value;
              const nextValue = timeSeries[nextIndex].value;
              const weight = (i - prevIndex) / (nextIndex - prevIndex);
              fillValue = prevValue + (nextValue - prevValue) * weight;
            } else if (prevIndex >= 0) {
              fillValue = timeSeries[prevIndex].value;
            } else if (nextIndex < timeSeries.length) {
              fillValue = timeSeries[nextIndex].value;
            }
            break;
        }
        
        filled.push({
          timestamp: current.timestamp,
          value: fillValue
        });
      } else {
        filled.push(current);
      }
    }
    
    return filled;
  }

  private smoothTimeSeries(
    timeSeries: TimeSeriesPoint[],
    method: 'sma' | 'ema' | 'lowess',
    window: number
  ): TimeSeriesPoint[] {
    if (timeSeries.length < window) return timeSeries;
    
    switch (method) {
      case 'sma':
        return this.simpleMovingAverage(timeSeries, window);
      case 'ema':
        return this.exponentialMovingAverage(timeSeries, window);
      case 'lowess':
        return this.lowessSmoothing(timeSeries, window);
      default:
        return timeSeries;
    }
  }

  private simpleMovingAverage(
    timeSeries: TimeSeriesPoint[],
    window: number
  ): TimeSeriesPoint[] {
    const smoothed: TimeSeriesPoint[] = [];
    
    for (let i = 0; i < timeSeries.length; i++) {
      const start = Math.max(0, i - Math.floor(window / 2));
      const end = Math.min(timeSeries.length, i + Math.ceil(window / 2));
      const windowValues = timeSeries.slice(start, end).map(p => p.value);
      const avg = windowValues.reduce((a, b) => a + b, 0) / windowValues.length;
      
      smoothed.push({
        timestamp: timeSeries[i].timestamp,
        value: avg
      });
    }
    
    return smoothed;
  }

  private exponentialMovingAverage(
    timeSeries: TimeSeriesPoint[],
    window: number
  ): TimeSeriesPoint[] {
    const alpha = 2 / (window + 1);
    const smoothed: TimeSeriesPoint[] = [];
    
    let ema = timeSeries[0].value;
    smoothed.push({ ...timeSeries[0] });
    
    for (let i = 1; i < timeSeries.length; i++) {
      ema = alpha * timeSeries[i].value + (1 - alpha) * ema;
      smoothed.push({
        timestamp: timeSeries[i].timestamp,
        value: ema
      });
    }
    
    return smoothed;
  }

  private lowessSmoothing(
    timeSeries: TimeSeriesPoint[],
    window: number
  ): TimeSeriesPoint[] {
    // Simplified LOWESS implementation
    // In production, use a proper implementation
    return this.simpleMovingAverage(timeSeries, window);
  }

  private calculateStatistics(timeSeries: TimeSeriesPoint[]): any {
    const values = timeSeries.map(p => p.value);
    const sorted = [...values].sort((a, b) => a - b);
    
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / values.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    
    const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    return {
      mean,
      median,
      stdDev,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      cv: stdDev / mean // Coefficient of variation
    };
  }

  private analyzeTrend(timeSeries: TimeSeriesPoint[]): TrendInfo {
    if (timeSeries.length < 2) {
      return {
        direction: 'stable',
        strength: 0,
        slope: 0,
        rSquared: 0,
        changeRate: 0
      };
    }
    
    // Convert timestamps to numeric x values
    const startTime = new Date(timeSeries[0].timestamp).getTime();
    const points = timeSeries.map((p, i) => ({
      x: (new Date(p.timestamp).getTime() - startTime) / 1000 / 60, // Minutes from start
      y: p.value
    }));
    
    // Calculate linear regression
    const n = points.length;
    const sumX = points.reduce((sum, p) => sum + p.x, 0);
    const sumY = points.reduce((sum, p) => sum + p.y, 0);
    const sumXY = points.reduce((sum, p) => sum + p.x * p.y, 0);
    const sumX2 = points.reduce((sum, p) => sum + p.x * p.x, 0);
    const sumY2 = points.reduce((sum, p) => sum + p.y * p.y, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    // Calculate R-squared
    const yMean = sumY / n;
    const ssTotal = points.reduce((sum, p) => sum + Math.pow(p.y - yMean, 2), 0);
    const ssResidual = points.reduce((sum, p) => {
      const predicted = slope * p.x + intercept;
      return sum + Math.pow(p.y - predicted, 2);
    }, 0);
    const rSquared = 1 - (ssResidual / ssTotal);
    
    // Calculate change rate
    const firstValue = timeSeries[0].value;
    const lastValue = timeSeries[timeSeries.length - 1].value;
    const changeRate = ((lastValue - firstValue) / firstValue) * 100;
    
    // Determine direction and strength
    let direction: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (Math.abs(slope) > 0.01) {
      direction = slope > 0 ? 'increasing' : 'decreasing';
    }
    
    const strength = Math.min(Math.abs(rSquared), 1);
    
    return {
      direction,
      strength,
      slope,
      rSquared,
      changeRate
    };
  }

  private detectSeasonality(timeSeries: TimeSeriesPoint[]): SeasonalityInfo {
    if (timeSeries.length < 24) {
      return { detected: false };
    }
    
    // Simple FFT-based seasonality detection
    // In production, use proper spectral analysis
    const values = timeSeries.map(p => p.value);
    const frequencies = this.findDominantFrequencies(values);
    
    if (frequencies.length === 0) {
      return { detected: false };
    }
    
    // Convert frequency to period
    const dominantFreq = frequencies[0];
    const period = Math.round(values.length / dominantFreq.frequency);
    
    return {
      detected: true,
      period: this.frequencyToPeriod(period, timeSeries),
      strength: dominantFreq.amplitude / Math.max(...values.map(Math.abs)),
      components: frequencies.slice(0, 3) // Top 3 frequencies
    };
  }

  private findDominantFrequencies(values: number[]): Array<any> {
    // Simplified frequency detection
    // In production, use FFT
    const frequencies: Array<{ frequency: number; amplitude: number; phase: number }> = [];
    
    // Check common periods
    const commonPeriods = [24, 7, 30]; // Hours, days, month
    
    for (const period of commonPeriods) {
      if (values.length >= period * 2) {
        const amplitude = this.calculateAmplitude(values, period);
        if (amplitude > 0) {
          frequencies.push({
            frequency: values.length / period,
            amplitude,
            phase: 0
          });
        }
      }
    }
    
    return frequencies.sort((a, b) => b.amplitude - a.amplitude);
  }

  private calculateAmplitude(values: number[], period: number): number {
    let maxDiff = 0;
    
    for (let offset = 0; offset < period; offset++) {
      const samples: number[] = [];
      for (let i = offset; i < values.length; i += period) {
        samples.push(values[i]);
      }
      
      if (samples.length > 1) {
        const min = Math.min(...samples);
        const max = Math.max(...samples);
        maxDiff = Math.max(maxDiff, max - min);
      }
    }
    
    return maxDiff;
  }

  private frequencyToPeriod(samples: number, timeSeries: TimeSeriesPoint[]): string {
    const start = new Date(timeSeries[0].timestamp).getTime();
    const end = new Date(timeSeries[timeSeries.length - 1].timestamp).getTime();
    const duration = end - start;
    const periodMs = duration / (timeSeries.length / samples);
    
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;
    
    if (periodMs < 2 * hour) return '1h';
    if (periodMs < 2 * day) return '1d';
    if (periodMs < 8 * day) return '1w';
    return '1M';
  }

  private detectChangePoints(timeSeries: TimeSeriesPoint[]): Array<any> {
    const changePoints: Array<any> = [];
    const windowSize = Math.max(10, Math.floor(timeSeries.length / 10));
    
    for (let i = windowSize; i < timeSeries.length - windowSize; i++) {
      const before = timeSeries.slice(i - windowSize, i);
      const after = timeSeries.slice(i, i + windowSize);
      
      const beforeStats = this.calculateStatistics(before);
      const afterStats = this.calculateStatistics(after);
      
      // Check for mean shift
      const meanChange = Math.abs(afterStats.mean - beforeStats.mean);
      const threshold = beforeStats.stdDev * 2;
      
      if (meanChange > threshold) {
        changePoints.push({
          timestamp: timeSeries[i].timestamp,
          type: afterStats.mean > beforeStats.mean ? 'increase' : 'decrease',
          magnitude: meanChange / beforeStats.mean
        });
      }
      
      // Check for variance change
      const varianceRatio = afterStats.stdDev / beforeStats.stdDev;
      if (varianceRatio > 2 || varianceRatio < 0.5) {
        changePoints.push({
          timestamp: timeSeries[i].timestamp,
          type: 'variance',
          magnitude: varianceRatio
        });
      }
    }
    
    return changePoints;
  }

  private generateForecast(
    historicalData: TimeSeriesPoint[],
    trend: TrendInfo,
    seasonality: SeasonalityInfo,
    periods: number,
    confidence: number
  ): ForecastPoint[] {
    const forecast: ForecastPoint[] = [];
    const lastPoint = historicalData[historicalData.length - 1];
    const lastTime = new Date(lastPoint.timestamp).getTime();
    const avgInterval = this.calculateAverageInterval(historicalData);
    
    // Simple forecast based on trend and seasonality
    for (let i = 1; i <= periods; i++) {
      const forecastTime = lastTime + i * avgInterval;
      const timestamp = new Date(forecastTime).toISOString();
      
      // Base value from trend
      let value = lastPoint.value + trend.slope * i;
      
      // Add seasonal component if detected
      if (seasonality.detected && seasonality.period) {
        const seasonalIndex = i % this.periodToSamples(seasonality.period);
        const seasonalFactor = this.getSeasonalFactor(historicalData, seasonalIndex);
        value *= seasonalFactor;
      }
      
      // Calculate confidence intervals
      const stats = this.calculateStatistics(historicalData);
      const zScore = this.getZScore(confidence);
      const stdError = stats.stdDev * Math.sqrt(1 + 1/historicalData.length + Math.pow(i, 2)/historicalData.length);
      
      forecast.push({
        timestamp,
        value,
        lower: value - zScore * stdError,
        upper: value + zScore * stdError,
        confidence
      });
    }
    
    return forecast;
  }

  private calculateAverageInterval(timeSeries: TimeSeriesPoint[]): number {
    if (timeSeries.length < 2) return 60 * 60 * 1000; // Default 1 hour
    
    let totalInterval = 0;
    for (let i = 1; i < timeSeries.length; i++) {
      const t1 = new Date(timeSeries[i - 1].timestamp).getTime();
      const t2 = new Date(timeSeries[i].timestamp).getTime();
      totalInterval += t2 - t1;
    }
    
    return totalInterval / (timeSeries.length - 1);
  }

  private periodToSamples(period: string): number {
    // Convert period string to number of samples
    const match = period.match(/^(\d+)([hdwM])$/);
    if (!match) return 24;
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 'h': return value;
      case 'd': return value * 24;
      case 'w': return value * 24 * 7;
      case 'M': return value * 24 * 30;
      default: return 24;
    }
  }

  private getSeasonalFactor(historicalData: TimeSeriesPoint[], index: number): number {
    // Simple seasonal factor calculation
    const values: number[] = [];
    const period = 24; // Assume daily seasonality for simplicity
    
    for (let i = index; i < historicalData.length; i += period) {
      values.push(historicalData[i].value);
    }
    
    if (values.length === 0) return 1;
    
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const overallAvg = historicalData.reduce((sum, p) => sum + p.value, 0) / historicalData.length;
    
    return avg / overallAvg;
  }

  private getZScore(confidence: number): number {
    // Convert confidence level to z-score
    // Common values
    if (confidence === 0.90) return 1.645;
    if (confidence === 0.95) return 1.96;
    if (confidence === 0.99) return 2.576;
    
    // Approximate for other values
    return 1.96; // Default to 95%
  }

  private alignTimeSeries(
    series1: TimeSeriesPoint[],
    series2: TimeSeriesPoint[]
  ): { aligned1: number[]; aligned2: number[] } {
    const timestamps1 = new Set(series1.map(p => p.timestamp));
    const timestamps2 = new Set(series2.map(p => p.timestamp));
    const commonTimestamps = Array.from(timestamps1).filter(t => timestamps2.has(t)).sort();
    
    const map1 = new Map(series1.map(p => [p.timestamp, p.value]));
    const map2 = new Map(series2.map(p => [p.timestamp, p.value]));
    
    const aligned1: number[] = [];
    const aligned2: number[] = [];
    
    for (const timestamp of commonTimestamps) {
      aligned1.push(map1.get(timestamp)!);
      aligned2.push(map2.get(timestamp)!);
    }
    
    return { aligned1, aligned2 };
  }

  private calculateCorrelation(values1: number[], values2: number[]): number {
    if (values1.length !== values2.length || values1.length === 0) return 0;
    
    const n = values1.length;
    const mean1 = values1.reduce((a, b) => a + b, 0) / n;
    const mean2 = values2.reduce((a, b) => a + b, 0) / n;
    
    let numerator = 0;
    let denominator1 = 0;
    let denominator2 = 0;
    
    for (let i = 0; i < n; i++) {
      const diff1 = values1[i] - mean1;
      const diff2 = values2[i] - mean2;
      
      numerator += diff1 * diff2;
      denominator1 += diff1 * diff1;
      denominator2 += diff2 * diff2;
    }
    
    const denominator = Math.sqrt(denominator1 * denominator2);
    return denominator === 0 ? 0 : numerator / denominator;
  }

  private calculateCrossCorrelation(
    values1: number[],
    values2: number[]
  ): Array<{ lag: number; correlation: number }> {
    const maxLag = Math.min(20, Math.floor(values1.length / 4));
    const correlations: Array<{ lag: number; correlation: number }> = [];
    
    for (let lag = -maxLag; lag <= maxLag; lag++) {
      let aligned1: number[];
      let aligned2: number[];
      
      if (lag > 0) {
        // values1 leads values2
        aligned1 = values1.slice(0, -lag);
        aligned2 = values2.slice(lag);
      } else if (lag < 0) {
        // values2 leads values1
        aligned1 = values1.slice(-lag);
        aligned2 = values2.slice(0, lag);
      } else {
        aligned1 = values1;
        aligned2 = values2;
      }
      
      const correlation = this.calculateCorrelation(aligned1, aligned2);
      correlations.push({ lag, correlation });
    }
    
    return correlations.sort((a, b) => b.correlation - a.correlation);
  }

  private calculateSimilarity(
    analysis1: TimeSeriesAnalysisResult,
    analysis2: TimeSeriesAnalysisResult
  ): number {
    // Combine multiple similarity metrics
    const trendSimilarity = 1 - Math.abs(analysis1.trend.slope - analysis2.trend.slope) / 
      (Math.abs(analysis1.trend.slope) + Math.abs(analysis2.trend.slope) + 1);
    
    const statsSimilarity = 1 - Math.abs(analysis1.statistics.cv - analysis2.statistics.cv) / 
      (analysis1.statistics.cv + analysis2.statistics.cv + 1);
    
    const seasonalitySimilarity = (analysis1.seasonality.detected === analysis2.seasonality.detected) ? 1 : 0.5;
    
    return (trendSimilarity + statsSimilarity + seasonalitySimilarity) / 3;
  }

  private detectLeadLagRelationship(
    crossCorrelation: Array<{ lag: number; correlation: number }>,
    metric1: string,
    metric2: string
  ): any {
    const bestCorrelation = crossCorrelation[0];
    
    if (Math.abs(bestCorrelation.correlation) < 0.5) {
      return undefined; // No significant relationship
    }
    
    if (bestCorrelation.lag === 0) {
      return undefined; // Synchronous, no lead-lag
    }
    
    return {
      leader: bestCorrelation.lag > 0 ? metric1 : metric2,
      lagger: bestCorrelation.lag > 0 ? metric2 : metric1,
      lag: Math.abs(bestCorrelation.lag),
      confidence: Math.abs(bestCorrelation.correlation)
    };
  }
}