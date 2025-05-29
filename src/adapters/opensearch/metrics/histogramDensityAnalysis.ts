import { logger } from '../../../utils/logger.js';
import { MetricsAdapterCore, HistogramMetric } from './metricCore.js';

/**
 * Histogram Density Analysis using OpenSearch's ML capabilities
 * Applies kernel density estimation to histogram data
 */
export class HistogramDensityAnalysis {
  /**
   * Apply kernel density estimation to histogram data
   * @param client The OpenSearch client to use for requests
   * @param histogramData Array of histogram data
   * @param options Additional options for density estimation
   */
  public static async estimateDensity(
    client: MetricsAdapterCore,
    histogramData: HistogramMetric[],
    options: {
      bandwidth?: number;
      kernelType?: 'gaussian' | 'epanechnikov' | 'uniform';
      gridPoints?: number;
      detectModes?: boolean;
    } = {}
  ): Promise<any> {
    logger.info('[HistogramDensityAnalysis] Estimating density', { 
      histogramCount: histogramData.length, 
      options 
    });
    
    try {
      // Default options
      const bandwidth = options.bandwidth || 0.1;
      const kernelType = options.kernelType || 'gaussian';
      const gridPoints = options.gridPoints || 100;
      const detectModes = options.detectModes !== undefined ? options.detectModes : true;
      
      if (histogramData.length === 0) {
        return { 
          densities: [], 
          message: 'No histogram data provided for density estimation'
        };
      }
      
      // Process each histogram
      const densityResults = [];
      
      for (const histogram of histogramData) {
        // Extract data points from histogram buckets
        const dataPoints: number[] = [];
        
        for (const bucket of histogram.buckets) {
          // Repeat the bucket key by the doc_count
          for (let i = 0; i < bucket.doc_count; i++) {
            dataPoints.push(bucket.key);
          }
        }
        
        if (dataPoints.length === 0) {
          continue;
        }
        
        // Use OpenSearch's ML plugin for kernel density estimation
        const mlEndpoint = '/_plugins/_ml';
        const kdeRequest = {
          algorithm: 'kernel_density_estimation',
          parameters: {
            bandwidth,
            kernel_type: kernelType,
            grid_points: gridPoints
          },
          input_data: {
            data_points: dataPoints
          }
        };
        
        const kdeResponse = await client.request('POST', `${mlEndpoint}/execute_kde`, kdeRequest);
        
        if (!kdeResponse.kde_result || !kdeResponse.kde_result.grid_points || !kdeResponse.kde_result.density_values) {
          continue;
        }
        
        // Extract density estimation results
        const gridPointValues = kdeResponse.kde_result.grid_points;
        const densityValues = kdeResponse.kde_result.density_values;
        
        // Create density curve
        const densityCurve = gridPointValues.map((point: number, i: number) => ({
          x: point,
          y: densityValues[i]
        }));
        
        // Detect modes if requested
        let modes: Array<{x: number; y: number}> = [];
        
        if (detectModes) {
          modes = this.detectModes(densityCurve);
        }
        
        // Calculate statistics
        const stats = this.calculateStatistics(dataPoints);
        
        densityResults.push({
          timestamp: histogram.timestamp,
          densityCurve,
          modes,
          stats,
          dataPoints: {
            count: dataPoints.length,
            min: Math.min(...dataPoints),
            max: Math.max(...dataPoints)
          }
        });
      }
      
      return {
        densities: densityResults,
        summary: {
          histogramCount: histogramData.length,
          densityCount: densityResults.length,
          averageModes: densityResults.length > 0 
            ? densityResults.reduce((sum, result) => sum + result.modes.length, 0) / densityResults.length 
            : 0
        },
        message: `Estimated density for ${densityResults.length} histograms`
      };
    } catch (error: any) {
      logger.error('[HistogramDensityAnalysis] Error estimating density', { error });
      return { 
        densities: [], 
        error: error.message || String(error),
        message: 'Failed to estimate density'
      };
    }
  }
  
  /**
   * Detect modes in a density curve
   * @param densityCurve Array of {x, y} points representing the density curve
   */
  private static detectModes(densityCurve: Array<{x: number; y: number}>): Array<{x: number; y: number}> {
    if (densityCurve.length < 3) {
      return [];
    }
    
    const modes = [];
    
    // Find local maxima
    for (let i = 1; i < densityCurve.length - 1; i++) {
      const prev = densityCurve[i - 1];
      const curr = densityCurve[i];
      const next = densityCurve[i + 1];
      
      if (curr.y > prev.y && curr.y > next.y) {
        modes.push(curr);
      }
    }
    
    // Sort modes by density (descending)
    modes.sort((a, b) => b.y - a.y);
    
    return modes;
  }
  
  /**
   * Calculate statistics for a set of data points
   * @param dataPoints Array of numeric data points
   */
  private static calculateStatistics(dataPoints: number[]): any {
    if (dataPoints.length === 0) {
      return {
        mean: 0,
        median: 0,
        min: 0,
        max: 0,
        stdDev: 0
      };
    }
    
    // Sort data points
    const sorted = [...dataPoints].sort((a, b) => a - b);
    
    // Calculate statistics
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const sum = sorted.reduce((acc, val) => acc + val, 0);
    const mean = sum / sorted.length;
    
    // Calculate median
    const midIndex = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 
      ? (sorted[midIndex - 1] + sorted[midIndex]) / 2 
      : sorted[midIndex];
    
    // Calculate standard deviation
    const variance = sorted.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / sorted.length;
    const stdDev = Math.sqrt(variance);
    
    return {
      mean,
      median,
      min,
      max,
      stdDev,
      range: max - min,
      q1: this.percentile(sorted, 25),
      q3: this.percentile(sorted, 75),
      iqr: this.percentile(sorted, 75) - this.percentile(sorted, 25)
    };
  }
  
  /**
   * Calculate percentile value from a sorted array
   * @param sorted Sorted array of values
   * @param percentile Percentile to calculate (0-100)
   */
  private static percentile(sorted: number[], percentile: number): number {
    if (sorted.length === 0) return 0;
    
    // Calculate index
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
  }
  
  /**
   * Compare histogram distributions using statistical tests
   * @param client The OpenSearch client to use for requests
   * @param histogram1 First histogram
   * @param histogram2 Second histogram
   * @param options Additional options for comparison
   */
  public static async compareHistogramDistributions(
    client: MetricsAdapterCore,
    histogram1: HistogramMetric,
    histogram2: HistogramMetric,
    options: {
      testType?: 'ks' | 'chi_square';
      significance?: number;
    } = {}
  ): Promise<any> {
    logger.info('[HistogramDensityAnalysis] Comparing histogram distributions', { options });
    
    try {
      // Default options
      const testType = options.testType || 'ks';
      const significance = options.significance || 0.05;
      
      // Extract data points from histogram buckets
      const extractDataPoints = (histogram: HistogramMetric): number[] => {
        const dataPoints: number[] = [];
        
        for (const bucket of histogram.buckets) {
          // Repeat the bucket key by the doc_count
          for (let i = 0; i < bucket.doc_count; i++) {
            dataPoints.push(bucket.key);
          }
        }
        
        return dataPoints;
      };
      
      const dataPoints1 = extractDataPoints(histogram1);
      const dataPoints2 = extractDataPoints(histogram2);
      
      if (dataPoints1.length === 0 || dataPoints2.length === 0) {
        return { 
          error: 'Insufficient data for comparison',
          message: 'Both histograms must have data points for comparison'
        };
      }
      
      // Use OpenSearch's ML plugin for statistical tests
      const mlEndpoint = '/_plugins/_ml';
      
      let testResult;
      let pValue;
      
      if (testType === 'ks') {
        // Kolmogorov-Smirnov test
        const ksRequest = {
          algorithm: 'kolmogorov_smirnov_test',
          parameters: {},
          input_data: {
            sample1: dataPoints1,
            sample2: dataPoints2
          }
        };
        
        const ksResponse = await client.request('POST', `${mlEndpoint}/execute_statistical_test`, ksRequest);
        
        if (!ksResponse.test_result || ksResponse.test_result.p_value === undefined) {
          return { 
            error: 'Failed to perform KS test',
            message: 'OpenSearch ML plugin failed to perform Kolmogorov-Smirnov test'
          };
        }
        
        testResult = ksResponse.test_result;
        pValue = testResult.p_value;
      } else {
        // Chi-square test
        const chiSquareRequest = {
          algorithm: 'chi_square_test',
          parameters: {},
          input_data: {
            sample1: dataPoints1,
            sample2: dataPoints2
          }
        };
        
        const chiSquareResponse = await client.request('POST', `${mlEndpoint}/execute_statistical_test`, chiSquareRequest);
        
        if (!chiSquareResponse.test_result || chiSquareResponse.test_result.p_value === undefined) {
          return { 
            error: 'Failed to perform Chi-square test',
            message: 'OpenSearch ML plugin failed to perform Chi-square test'
          };
        }
        
        testResult = chiSquareResponse.test_result;
        pValue = testResult.p_value;
      }
      
      // Interpret the result
      const isDifferent = pValue < significance;
      
      // Calculate statistics for both distributions
      const stats1 = this.calculateStatistics(dataPoints1);
      const stats2 = this.calculateStatistics(dataPoints2);
      
      // Calculate differences
      const differences = {
        mean: stats2.mean - stats1.mean,
        median: stats2.median - stats1.median,
        stdDev: stats2.stdDev - stats1.stdDev,
        range: stats2.range - stats1.range,
        iqr: stats2.iqr - stats1.iqr
      };
      
      return {
        testType,
        testResult,
        pValue,
        isDifferent,
        significance,
        stats1,
        stats2,
        differences,
        interpretation: isDifferent 
          ? 'The distributions are significantly different' 
          : 'The distributions are not significantly different',
        message: `Compared histogram distributions using ${testType} test`
      };
    } catch (error: any) {
      logger.error('[HistogramDensityAnalysis] Error comparing histogram distributions', { error });
      return { 
        error: error.message || String(error),
        message: 'Failed to compare histogram distributions'
      };
    }
  }
}
