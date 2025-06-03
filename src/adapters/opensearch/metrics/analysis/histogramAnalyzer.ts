import { logger } from '../../../../utils/logger.js';

/**
 * Configuration for histogram analysis
 */
export interface HistogramConfig {
  densityPoints?: number;
  bandwidth?: number;
  kernelType?: 'gaussian' | 'epanechnikov' | 'uniform';
  minBuckets?: number;
}

/**
 * Histogram data structure
 */
export interface HistogramData {
  buckets: Array<{
    key: number;
    count: number;
  }>;
  min: number;
  max: number;
  total: number;
}

/**
 * Statistical summary of histogram
 */
export interface HistogramStats {
  mean: number;
  median: number;
  mode: number;
  stdDev: number;
  skewness: number;
  kurtosis: number;
  min: number;
  max: number;
  percentiles: {
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    p95: number;
    p99: number;
  };
}

/**
 * Core histogram analysis functionality
 */
export class HistogramAnalyzer {
  private readonly config: Required<HistogramConfig>;

  constructor(config: HistogramConfig = {}) {
    this.config = {
      densityPoints: config.densityPoints ?? 100,
      bandwidth: config.bandwidth ?? 0,
      kernelType: config.kernelType ?? 'gaussian',
      minBuckets: config.minBuckets ?? 5
    };
  }

  /**
   * Calculate comprehensive statistics for a histogram
   */
  public calculateStats(histogram: HistogramData): HistogramStats {
    const values = this.expandHistogramToValues(histogram);
    
    if (values.length === 0) {
      return this.getEmptyStats();
    }

    // Sort values for percentile calculations
    const sorted = [...values].sort((a, b) => a - b);
    
    // Basic statistics
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const median = this.getPercentile(sorted, 50);
    const mode = this.findMode(histogram);
    
    // Variance and standard deviation
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    // Higher moments
    const skewness = this.calculateSkewness(values, mean, stdDev);
    const kurtosis = this.calculateKurtosis(values, mean, stdDev);
    
    return {
      mean,
      median,
      mode,
      stdDev,
      skewness,
      kurtosis,
      min: histogram.min,
      max: histogram.max,
      percentiles: {
        p25: this.getPercentile(sorted, 25),
        p50: median,
        p75: this.getPercentile(sorted, 75),
        p90: this.getPercentile(sorted, 90),
        p95: this.getPercentile(sorted, 95),
        p99: this.getPercentile(sorted, 99)
      }
    };
  }

  /**
   * Estimate probability density function from histogram
   */
  public estimateDensity(histogram: HistogramData): Array<{ x: number; y: number }> {
    if (!histogram.buckets || histogram.buckets.length < this.config.minBuckets) {
      logger.warn('[HistogramAnalyzer] Insufficient buckets for density estimation', {
        bucketCount: histogram.buckets?.length || 0,
        minRequired: this.config.minBuckets
      });
      return [];
    }

    const bandwidth = this.config.bandwidth || this.calculateOptimalBandwidth(histogram);
    const points = this.generateDensityPoints(histogram);
    
    return points.map(x => ({
      x,
      y: this.kernelDensityEstimate(x, histogram, bandwidth)
    }));
  }

  /**
   * Calculate divergence metrics between two histograms
   */
  public calculateDivergence(hist1: HistogramData, hist2: HistogramData): {
    klDivergence: number;
    jsDivergence: number;
    wasserstein: number;
    bhattacharyya: number;
  } {
    // Normalize histograms to probability distributions
    const dist1 = this.normalizeHistogram(hist1);
    const dist2 = this.normalizeHistogram(hist2);
    
    // Align distributions to same bins
    const { aligned1, aligned2 } = this.alignDistributions(dist1, dist2);
    
    return {
      klDivergence: this.klDivergence(aligned1, aligned2),
      jsDivergence: this.jsDivergence(aligned1, aligned2),
      wasserstein: this.wassersteinDistance(aligned1, aligned2),
      bhattacharyya: this.bhattacharyyaDistance(aligned1, aligned2)
    };
  }

  /**
   * Detect modes (peaks) in the histogram
   */
  public detectModes(histogram: HistogramData, minProminence: number = 0.1): Array<{
    value: number;
    count: number;
    prominence: number;
  }> {
    const density = this.estimateDensity(histogram);
    if (density.length < 3) return [];

    const modes: Array<{ value: number; count: number; prominence: number }> = [];
    
    // Find local maxima
    for (let i = 1; i < density.length - 1; i++) {
      if (density[i].y > density[i - 1].y && density[i].y > density[i + 1].y) {
        const prominence = this.calculateProminence(density, i);
        if (prominence >= minProminence) {
          modes.push({
            value: density[i].x,
            count: density[i].y * histogram.total,
            prominence
          });
        }
      }
    }
    
    return modes.sort((a, b) => b.prominence - a.prominence);
  }

  // Private helper methods

  private expandHistogramToValues(histogram: HistogramData): number[] {
    const values: number[] = [];
    for (const bucket of histogram.buckets) {
      const bucketMidpoint = bucket.key;
      for (let i = 0; i < bucket.count; i++) {
        values.push(bucketMidpoint);
      }
    }
    return values;
  }

  private getEmptyStats(): HistogramStats {
    return {
      mean: 0,
      median: 0,
      mode: 0,
      stdDev: 0,
      skewness: 0,
      kurtosis: 0,
      min: 0,
      max: 0,
      percentiles: {
        p25: 0,
        p50: 0,
        p75: 0,
        p90: 0,
        p95: 0,
        p99: 0
      }
    };
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

  private findMode(histogram: HistogramData): number {
    if (!histogram.buckets || histogram.buckets.length === 0) return 0;
    
    let maxBucket = histogram.buckets[0];
    for (const bucket of histogram.buckets) {
      if (bucket.count > maxBucket.count) {
        maxBucket = bucket;
      }
    }
    
    return maxBucket.key;
  }

  private calculateSkewness(values: number[], mean: number, stdDev: number): number {
    if (stdDev === 0 || values.length < 3) return 0;
    
    const n = values.length;
    const sum = values.reduce((acc, val) => acc + Math.pow((val - mean) / stdDev, 3), 0);
    
    return (n / ((n - 1) * (n - 2))) * sum;
  }

  private calculateKurtosis(values: number[], mean: number, stdDev: number): number {
    if (stdDev === 0 || values.length < 4) return 0;
    
    const n = values.length;
    const sum = values.reduce((acc, val) => acc + Math.pow((val - mean) / stdDev, 4), 0);
    
    const kurtosis = (n * (n + 1) / ((n - 1) * (n - 2) * (n - 3))) * sum;
    const correction = 3 * Math.pow(n - 1, 2) / ((n - 2) * (n - 3));
    
    return kurtosis - correction;
  }

  private calculateOptimalBandwidth(histogram: HistogramData): number {
    // Silverman's rule of thumb
    const stats = this.calculateStats(histogram);
    const n = histogram.total;
    const iqr = stats.percentiles.p75 - stats.percentiles.p25;
    const sigma = Math.min(stats.stdDev, iqr / 1.34);
    
    return 0.9 * sigma * Math.pow(n, -0.2);
  }

  private generateDensityPoints(histogram: HistogramData): number[] {
    const range = histogram.max - histogram.min;
    const step = range / (this.config.densityPoints - 1);
    const points: number[] = [];
    
    for (let i = 0; i < this.config.densityPoints; i++) {
      points.push(histogram.min + i * step);
    }
    
    return points;
  }

  private kernelDensityEstimate(x: number, histogram: HistogramData, bandwidth: number): number {
    let sum = 0;
    
    for (const bucket of histogram.buckets) {
      const weight = bucket.count / histogram.total;
      const distance = (x - bucket.key) / bandwidth;
      
      // Apply kernel function
      let kernelValue = 0;
      switch (this.config.kernelType) {
        case 'gaussian':
          kernelValue = Math.exp(-0.5 * distance * distance) / Math.sqrt(2 * Math.PI);
          break;
        case 'epanechnikov':
          kernelValue = Math.abs(distance) <= 1 ? 0.75 * (1 - distance * distance) : 0;
          break;
        case 'uniform':
          kernelValue = Math.abs(distance) <= 1 ? 0.5 : 0;
          break;
      }
      
      sum += weight * kernelValue / bandwidth;
    }
    
    return sum;
  }

  private normalizeHistogram(histogram: HistogramData): Map<number, number> {
    const normalized = new Map<number, number>();
    const total = histogram.total || histogram.buckets.reduce((sum, b) => sum + b.count, 0);
    
    for (const bucket of histogram.buckets) {
      normalized.set(bucket.key, bucket.count / total);
    }
    
    return normalized;
  }

  private alignDistributions(dist1: Map<number, number>, dist2: Map<number, number>): {
    aligned1: number[];
    aligned2: number[];
  } {
    // Get all unique keys
    const allKeys = new Set([...dist1.keys(), ...dist2.keys()]);
    const sortedKeys = Array.from(allKeys).sort((a, b) => a - b);
    
    const aligned1: number[] = [];
    const aligned2: number[] = [];
    
    for (const key of sortedKeys) {
      aligned1.push(dist1.get(key) || 0);
      aligned2.push(dist2.get(key) || 0);
    }
    
    return { aligned1, aligned2 };
  }

  private klDivergence(p: number[], q: number[]): number {
    let sum = 0;
    for (let i = 0; i < p.length; i++) {
      if (p[i] > 0 && q[i] > 0) {
        sum += p[i] * Math.log(p[i] / q[i]);
      }
    }
    return sum;
  }

  private jsDivergence(p: number[], q: number[]): number {
    const m = p.map((pi, i) => (pi + q[i]) / 2);
    return 0.5 * this.klDivergence(p, m) + 0.5 * this.klDivergence(q, m);
  }

  private wassersteinDistance(p: number[], q: number[]): number {
    // Calculate CDFs
    const cdfP = this.calculateCDF(p);
    const cdfQ = this.calculateCDF(q);
    
    // Calculate L1 distance between CDFs
    let sum = 0;
    for (let i = 0; i < cdfP.length; i++) {
      sum += Math.abs(cdfP[i] - cdfQ[i]);
    }
    
    return sum / p.length;
  }

  private bhattacharyyaDistance(p: number[], q: number[]): number {
    let sum = 0;
    for (let i = 0; i < p.length; i++) {
      sum += Math.sqrt(p[i] * q[i]);
    }
    return -Math.log(sum);
  }

  private calculateCDF(pdf: number[]): number[] {
    const cdf: number[] = [];
    let sum = 0;
    
    for (const value of pdf) {
      sum += value;
      cdf.push(sum);
    }
    
    return cdf;
  }

  private calculateProminence(density: Array<{ x: number; y: number }>, peakIndex: number): number {
    const peakHeight = density[peakIndex].y;
    
    // Find valleys on both sides
    let leftValley = peakHeight;
    for (let i = peakIndex - 1; i >= 0; i--) {
      if (density[i].y < leftValley) {
        leftValley = density[i].y;
      } else {
        break;
      }
    }
    
    let rightValley = peakHeight;
    for (let i = peakIndex + 1; i < density.length; i++) {
      if (density[i].y < rightValley) {
        rightValley = density[i].y;
      } else {
        break;
      }
    }
    
    const minValley = Math.min(leftValley, rightValley);
    return (peakHeight - minValley) / peakHeight;
  }
}