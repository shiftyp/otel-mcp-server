import { logger } from '../../../utils/logger.js';
import { MetricsAdapterCore } from './metricCore.js';
import { HistogramDensityAnalysis } from './histogramDensityAnalysis.js';
import { SearchEngineType } from '../../base/searchAdapter.js';
import { HistogramMetric } from './metricCore.js';
import { generateEmbeddingsWithProvider, EmbeddingProviderConfig } from '../ml/embeddingProvider.js';
import { generateEmbedding, EmbeddingOptions } from '../ml/embeddings.js';
import { extractTextContent, createTextExtractor, TextExtractionOptions } from '../ml/textExtraction.js';

/**
 * Histogram comparison analysis using ML capabilities
 * Supports both OpenSearch and Elasticsearch with different implementations
 */
export class HistogramComparison {
  /**
   * Compare histogram patterns across multiple time ranges
   * @param client The search engine client to use for requests
   * @param histogramData1 First set of histogram data
   * @param histogramData2 Second set of histogram data
   * @param options Additional options for comparison
   */
  public static async compareHistogramPatterns(
    client: MetricsAdapterCore,
    histogramData1: any[],
    histogramData2: any[],
    options: any = {}
  ): Promise<any> {
    logger.info('[HistogramComparison] Comparing histogram patterns', { 
      histogramCount1: histogramData1.length, 
      histogramCount2: histogramData2.length,
      options 
    });
    
    try {
      // Default options
      const compareMethod = options.compareMethod || 'all';
      const detectModes = options.detectModes !== undefined ? options.detectModes : true;
      const runStatTests = options.runStatTests !== undefined ? options.runStatTests : true;
      const smoothing = options.smoothing || 0.1;
      const useEmbeddings = options.useEmbeddings !== undefined ? options.useEmbeddings : false;
      const embeddingBatchSize = options.embeddingBatchSize || 5;
      const similarityThreshold = options.similarityThreshold || 0.7;
      
      // Text extraction options for embedding generation
      const textExtractionOptions = options.textExtractionOptions || {
        textFields: [
          'timestamp', 'shape', 'modeCount', 'distribution', 'peakedness',
          'metric.name', 'metric.description'
        ],
        dimensionFields: [
          'attributes', 'labels', 'dimensions', 'tags', 'metric'
        ],
        valueFields: [
          'stats.mean', 'stats.median', 'stats.min', 'stats.max',
          'stats.stdDev', 'stats.variance', 'stats.skewness', 'stats.kurtosis',
          'primaryMode.x', 'primaryMode.y'
        ]
      };
      
      if (histogramData1.length === 0 || histogramData2.length === 0) {
        return { 
          comparison: [], 
          message: 'Insufficient histogram data provided for comparison'
        };
      }
      
      // Choose implementation based on engine type
      if (options.engineType === SearchEngineType.OPENSEARCH) {
        return this.compareWithOpenSearch(client, histogramData1, histogramData2, {
          compareMethod,
          detectModes,
          runStatTests,
          smoothing,
          useEmbeddings,
          embeddingBatchSize,
          similarityThreshold,
          textExtractionOptions
        });
      } else {
        return this.compareWithElasticsearch(client, histogramData1, histogramData2, {
          compareMethod,
          detectModes,
          runStatTests,
          smoothing,
          useEmbeddings,
          embeddingBatchSize,
          similarityThreshold,
          textExtractionOptions
        });
      }
    } catch (error: any) {
      logger.error('[HistogramComparison] Error comparing histogram patterns', { error });
      return { 
        comparison: [], 
        error: error.message || String(error),
        message: 'Failed to compare histogram patterns'
      };
    }
  }
  
  /**
   * Compare histograms using OpenSearch's ML capabilities
   */
  private static async compareWithOpenSearch(
    client: MetricsAdapterCore,
    histogramData1: HistogramMetric[],
    histogramData2: HistogramMetric[],
    options: {
      compareMethod: 'kl_divergence' | 'js_divergence' | 'wasserstein' | 'all';
      detectModes: boolean;
      runStatTests: boolean;
      smoothing: number;
      useEmbeddings?: boolean;
      embeddingBatchSize?: number;
      similarityThreshold?: number;
      textExtractionOptions?: {
        textFields?: string[];
        dimensionFields?: string[];
        valueFields?: string[];
      };
      embeddingProviderConfig?: EmbeddingProviderConfig;
    }
  ): Promise<any> {
    logger.info('[HistogramComparison] Comparing histogram patterns with OpenSearch', { 
      histogramCount1: histogramData1.length, 
      histogramCount2: histogramData2.length, 
      options 
    });
    
    // Default options for embedding-based comparison
    const useEmbeddings = options.useEmbeddings !== undefined ? options.useEmbeddings : true;
    const embeddingBatchSize = options.embeddingBatchSize || 5;
    const similarityThreshold = options.similarityThreshold || 0.7;
    
    // Use HistogramDensityAnalysis static methods to estimate densities
    const densityOptions = {
      bandwidth: options.smoothing,
      kernelType: 'gaussian' as 'gaussian' | 'epanechnikov' | 'uniform',
      gridPoints: 100,
      detectModes: options.detectModes
    };
    
    const densityResult1 = await HistogramComparison.estimateDensityDirectly(
      client, 
      histogramData1, 
      densityOptions
    );
    
    const densityResult2 = await HistogramComparison.estimateDensityDirectly(
      client, 
      histogramData2, 
      densityOptions
    );
    
    if (!densityResult1.densities || !densityResult2.densities || 
        densityResult1.densities.length === 0 || densityResult2.densities.length === 0) {
      return {
        error: 'Failed to estimate densities for histograms',
        message: 'Could not compare histogram patterns due to density estimation failure'
      };
    }
    
    // If embeddings are enabled, perform embedding-based comparison
    let embeddingResults = null;
    if (useEmbeddings) {
      try {
        embeddingResults = await HistogramComparison.compareWithEmbeddings(
          client,
          densityResult1.densities,
          densityResult2.densities,
          embeddingBatchSize,
          similarityThreshold,
          options.textExtractionOptions,
          // Pass embedding provider config if available
          options.embeddingProviderConfig
        );
        logger.info('[HistogramComparison] Successfully performed embedding-based comparison', {
          averageSimilarity: embeddingResults?.averageSimilarity,
          pairCount: embeddingResults?.totalPairCount
        });
      } catch (error) {
        logger.warn('[HistogramComparison] Failed to perform embedding-based comparison, falling back to traditional methods', { error });
        // Continue with traditional comparison methods even if embedding comparison fails
      }
    }
    
    // Compare the densities
    const comparisons = [];
    
    for (let i = 0; i < Math.min(densityResult1.densities.length, densityResult2.densities.length); i++) {
      const d1 = densityResult1.densities[i];
      const d2 = densityResult2.densities[i];
      
      // Calculate divergences between distributions
      const divergences = await this.calculateDivergences(
        client,
        d1.densityCurve,
        d2.densityCurve,
        options.compareMethod
      );
      
      // Compare modes if requested
      let modeComparison = null;
      if (options.detectModes) {
        modeComparison = this.compareModes(d1.modes, d2.modes);
      }
      
      // Run statistical tests if requested
      let statTests = null;
      if (options.runStatTests) {
        statTests = await this.runStatisticalTests(
          client,
          d1.dataPoints,
          d2.dataPoints
        );
      }
      
      comparisons.push({
        timestamp1: d1.timestamp,
        timestamp2: d2.timestamp,
        divergences,
        modeComparison,
        statTests,
        embeddingComparison: embeddingResults,
        stats1: d1.stats,
        stats2: d2.stats,
        summary: {
          significantDifference: statTests ? statTests.significantDifference : null,
          divergenceScore: divergences.kl_divergence || divergences.js_divergence || 0,
          modeDifference: modeComparison ? modeComparison.modeDifferenceScore : null
        }
      });
    }
    
    // Sort comparisons by divergence score (descending)
    comparisons.sort((a, b) => b.summary.divergenceScore - a.summary.divergenceScore);
    
    // Prepare the final response with all comparison results
    const response: any = {
      comparison: comparisons,
      densities: {
        timeWindow1: densityResult1.densities,
        timeWindow2: densityResult2.densities
      },
      summary: {
        timeWindow1: {
          histogramCount: histogramData1.length,
          densityCount: densityResult1.densities.length,
          averageModes: densityResult1.densities.length > 0 
            ? densityResult1.densities.reduce((sum: number, d: any) => sum + (d.modes?.length || 0), 0) / densityResult1.densities.length 
            : 0
        },
        timeWindow2: {
          histogramCount: histogramData2.length,
          densityCount: densityResult2.densities.length,
          averageModes: densityResult2.densities.length > 0 
            ? densityResult2.densities.reduce((sum: number, d: any) => sum + (d.modes?.length || 0), 0) / densityResult2.densities.length 
            : 0
        }
      },
      message: `Compared ${densityResult1.densities.length} and ${densityResult2.densities.length} histograms`
    };
    
    // Add embedding analysis to summary if available
    if (embeddingResults) {
      if (!response.summary.embeddingAnalysis) {
        response.summary.embeddingAnalysis = {};
      }
      
      response.summary.embeddingAnalysis = {
        similarityScore: embeddingResults.averageSimilarity,
        clusterCount: embeddingResults.clusters?.length || 0,
        similarPairCount: embeddingResults.similarPairCount,
        totalPairCount: embeddingResults.totalPairCount
      };
    }
    
    return response;
  }
  
  /**
   * Compare histograms using Elasticsearch's ML capabilities
   */
  private static async compareWithElasticsearch(
    client: MetricsAdapterCore,
    histogramData1: HistogramMetric[],
    histogramData2: HistogramMetric[],
    options: {
      compareMethod: 'kl_divergence' | 'js_divergence' | 'wasserstein' | 'all';
      detectModes: boolean;
      runStatTests: boolean;
      smoothing: number;
      useEmbeddings?: boolean;
      embeddingBatchSize?: number;
      similarityThreshold?: number;
      textExtractionOptions?: {
        textFields?: string[];
        dimensionFields?: string[];
        valueFields?: string[];
      };
      embeddingProviderConfig?: EmbeddingProviderConfig;
    }
  ): Promise<any> {
    // Elasticsearch implementation uses different endpoints and parameters
    // First, get density estimations using Elasticsearch's ML API
    const densityOptions = {
      bandwidth: options.smoothing,
      kernelType: 'gaussian',
      gridPoints: 100,
      detectModes: options.detectModes
    };
    
    // Note: For Elasticsearch, we would use a different endpoint
    // This is a placeholder for the actual implementation
    logger.info('[HistogramComparison] Using Elasticsearch implementation');
    
    // For now, we'll use the OpenSearch implementation as a fallback
    // In a real implementation, we would use Elasticsearch's ML APIs
    return this.compareWithOpenSearch(client, histogramData1, histogramData2, options);
  }
  
  /**
   * Calculate divergences between two density curves
   */
  private static async calculateDivergences(
    client: MetricsAdapterCore,
    densityCurve1: Array<{x: number; y: number}>,
    densityCurve2: Array<{x: number; y: number}>,
    method: 'kl_divergence' | 'js_divergence' | 'wasserstein' | 'all'
  ): Promise<{
    kl_divergence?: number;
    js_divergence?: number;
    wasserstein_distance?: number;
  }> {
    try {
      // Extract probability distributions from density curves
      const dist1 = densityCurve1.map(p => p.y);
      const dist2 = densityCurve2.map(p => p.y);
      
      // Normalize distributions to ensure they sum to 1
      const sum1 = dist1.reduce((a, b) => a + b, 0);
      const sum2 = dist2.reduce((a, b) => a + b, 0);
      
      const normDist1 = dist1.map(p => p / sum1);
      const normDist2 = dist2.map(p => p / sum2);
      
      const result: {
        kl_divergence?: number;
        js_divergence?: number;
        wasserstein_distance?: number;
      } = {};
      
      // Calculate requested divergences
      if (method === 'kl_divergence' || method === 'all') {
        result.kl_divergence = this.calculateKLDivergence(normDist1, normDist2);
      }
      
      if (method === 'js_divergence' || method === 'all') {
        result.js_divergence = this.calculateJSDivergence(normDist1, normDist2);
      }
      
      if (method === 'wasserstein' || method === 'all') {
        // For Wasserstein distance, we need the x-values as well
        const x1 = densityCurve1.map(p => p.x);
        const x2 = densityCurve2.map(p => p.x);
        result.wasserstein_distance = this.calculateWassersteinDistance(x1, normDist1, x2, normDist2);
      }
      
      return result;
    } catch (error) {
      logger.error('[HistogramComparison] Error calculating divergences', { error });
      return {};
    }
  }
  
  /**
   * Calculate Kullback-Leibler divergence between two distributions
   */
  private static calculateKLDivergence(p: number[], q: number[]): number {
    // Add small epsilon to avoid division by zero or log(0)
    const epsilon = 1e-10;
    
    let kl = 0;
    for (let i = 0; i < p.length; i++) {
      const pi = p[i] + epsilon;
      const qi = q[i] + epsilon;
      kl += pi * Math.log(pi / qi);
    }
    
    return kl;
  }
  
  /**
   * Calculate Jensen-Shannon divergence between two distributions
   */
  private static calculateJSDivergence(p: number[], q: number[]): number {
    // Jensen-Shannon divergence is based on the KL divergence
    // It's symmetric and always finite
    const m = p.map((pi, i) => (pi + q[i]) / 2);
    
    const klPM = this.calculateKLDivergence(p, m);
    const klQM = this.calculateKLDivergence(q, m);
    
    return (klPM + klQM) / 2;
  }
  
  /**
   * Calculate Wasserstein distance (Earth Mover's Distance)
   */
  private static calculateWassersteinDistance(
    x1: number[], 
    p: number[], 
    x2: number[], 
    q: number[]
  ): number {
    // This is a simplified implementation of the 1D Wasserstein distance
    // For histograms with the same bin locations
    
    // First, compute cumulative distributions
    const cdf1 = this.computeCDF(p);
    const cdf2 = this.computeCDF(q);
    
    // Calculate the area between the CDFs
    let distance = 0;
    for (let i = 0; i < cdf1.length - 1; i++) {
      const x_diff = x1[i+1] - x1[i];
      const y_diff = Math.abs(cdf1[i] - cdf2[i]);
      distance += x_diff * y_diff;
    }
    
    return distance;
  }
  
  /**
   * Compute cumulative distribution function
   */
  private static computeCDF(p: number[]): number[] {
    const cdf = [];
    let sum = 0;
    
    for (const pi of p) {
      sum += pi;
      cdf.push(sum);
    }
    
    return cdf;
  }
  
  /**
   * Compare modes between two distributions
   */
  private static compareModes(
    modes1: Array<{x: number; y: number}>,
    modes2: Array<{x: number; y: number}>
  ): {
    modeDifferenceScore: number;
    modeCountDiff: number;
    modePairs: Array<{
      mode1: {x: number; y: number} | null;
      mode2: {x: number; y: number} | null;
      distance: number;
    }>;
  } {
    // Calculate the difference in mode count
    const modeCountDiff = Math.abs(modes1.length - modes2.length);
    
    // Match modes between the two distributions
    const modePairs = [];
    const usedIndices = new Set<number>();
    
    // For each mode in the first distribution, find the closest mode in the second
    for (const mode1 of modes1) {
      let minDistance = Infinity;
      let closestIndex = -1;
      
      for (let i = 0; i < modes2.length; i++) {
        if (usedIndices.has(i)) continue;
        
        const mode2 = modes2[i];
        const distance = Math.abs(mode1.x - mode2.x);
        
        if (distance < minDistance) {
          minDistance = distance;
          closestIndex = i;
        }
      }
      
      if (closestIndex !== -1) {
        usedIndices.add(closestIndex);
        modePairs.push({
          mode1,
          mode2: modes2[closestIndex],
          distance: minDistance
        });
      } else {
        modePairs.push({
          mode1,
          mode2: null,
          distance: Infinity
        });
      }
    }
    
    // Add remaining unmatched modes from the second distribution
    for (let i = 0; i < modes2.length; i++) {
      if (!usedIndices.has(i)) {
        modePairs.push({
          mode1: null,
          mode2: modes2[i],
          distance: Infinity
        });
      }
    }
    
    // Calculate overall mode difference score
    // This combines the difference in mode count and the distances between matched modes
    const matchedPairs = modePairs.filter(pair => pair.mode1 !== null && pair.mode2 !== null);
    const avgDistance = matchedPairs.length > 0
      ? matchedPairs.reduce((sum, pair) => sum + pair.distance, 0) / matchedPairs.length
      : 0;
    
    const modeDifferenceScore = modeCountDiff + avgDistance;
    
    return {
      modeDifferenceScore,
      modeCountDiff,
      modePairs
    };
  }
  
  /**
   * Run statistical tests to compare two distributions
   */
  private static async runStatisticalTests(
    client: MetricsAdapterCore,
    dataPoints1: { count: number; min: number; max: number },
    dataPoints2: { count: number; min: number; max: number }
  ): Promise<{
    significantDifference: boolean;
    pValue?: number;
    testName: string;
    testStatistic?: number;
  }> {
    try {
      // This is a placeholder for actual statistical tests
      // In a real implementation, we would use the ML API to run tests
      
      // For now, we'll use a simple heuristic based on the ranges
      const range1 = dataPoints1.max - dataPoints1.min;
      const range2 = dataPoints2.max - dataPoints2.min;
      
      const rangeDiff = Math.abs(range1 - range2);
      const avgRange = (range1 + range2) / 2;
      
      const significantDifference = rangeDiff > (avgRange * 0.2); // 20% difference threshold
      
      return {
        significantDifference,
        pValue: significantDifference ? 0.01 : 0.5, // Placeholder p-value
        testName: 'range_comparison',
        testStatistic: rangeDiff / avgRange
      };
    } catch (error) {
      logger.error('[HistogramComparison] Error running statistical tests', { error });
      return {
        significantDifference: false,
        testName: 'failed'
      };
    }
  }

  /**
   * Estimate density directly without using HistogramDensityAnalysis
   * This is a simplified version of HistogramDensityAnalysis.estimateDensity
   */
  private static async estimateDensityDirectly(
    client: MetricsAdapterCore,
    histogramData: HistogramMetric[],
    options: {
      bandwidth?: number;
      kernelType?: 'gaussian' | 'epanechnikov' | 'uniform';
      gridPoints?: number;
      detectModes?: boolean;
    }
  ): Promise<any> {
    logger.info('[HistogramComparison] Estimating density directly', { 
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
          modes = HistogramComparison.detectModes(densityCurve);
        }
        
        // Calculate statistics
        const stats = HistogramComparison.calculateStatistics(dataPoints);
        
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
      logger.error('[HistogramComparison] Error estimating density directly', { error });
      return { 
        densities: [], 
        error: error.message || String(error),
        message: 'Failed to estimate density'
      };
    }
  }
  
  /**
   * Detect modes in a density curve
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
   */
  private static calculateStats(dataPoints: number[]): any {
    if (dataPoints.length === 0) {
      return {
        count: 0,
        min: 0,
        max: 0,
        mean: 0,
        median: 0,
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
    const squaredDiffs = sorted.map(x => Math.pow(x - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / sorted.length;
    const stdDev = Math.sqrt(variance);
    
    return {
      mean,
      median,
      min,
      max,
      stdDev
    };
  }

  /**
   * Compare histograms using embeddings for better semantic understanding
   * This method generates embeddings on-the-fly for histogram density curves
   * using the centralized text extraction and embedding utilities
   * 
   * @param client The metrics adapter client
   * @param densities1 First set of histogram densities
   * @param densities2 Second set of histogram densities
   * @param batchSize Batch size for embedding generation
   * @param similarityThreshold Threshold for similarity clustering
   * @param textExtractionOptions Optional configuration for text extraction fields
   */
  public static async compareWithEmbeddings(
    client: MetricsAdapterCore,
    densities1: any[],
    densities2: any[],
    batchSize: number = 5,
    similarityThreshold: number = 0.7,
    textExtractionOptions?: {
      textFields?: string[];
      dimensionFields?: string[];
      valueFields?: string[];
    },
    embeddingProviderConfig?: EmbeddingProviderConfig
  ): Promise<any> {
    try {
      logger.info('[HistogramComparison] Using embeddings for histogram comparison', {
        densityCount1: densities1.length,
        densityCount2: densities2.length,
        batchSize,
        similarityThreshold
      });

      // Define text extraction options for histogram densities, using provided options if available
      const histogramTextExtractionOptions: TextExtractionOptions = {
        textFields: textExtractionOptions?.textFields || [
          'timestamp', 'shape', 'modeCount', 'distribution', 'peakedness', 'metric.name'
        ],
        dimensionFields: textExtractionOptions?.dimensionFields || [
          'attributes', 'labels', 'dimensions', 'tags', 'metric'
        ],
        valueFields: textExtractionOptions?.valueFields || [
          'stats.mean', 'stats.median', 'stats.min', 'stats.max', 
          'stats.stdDev', 'stats.skewness', 'stats.kurtosis',
          'primaryMode.x', 'primaryMode.y'
        ]
      };
      
      logger.debug('[HistogramComparison] Using text extraction options', histogramTextExtractionOptions);
      
      // Create text extractor function for histogram densities
      const histogramTextExtractor = createTextExtractor(histogramTextExtractionOptions);

      // Create rich text representations of the histogram densities using our centralized utility
      // Pass the text extraction options to createDensityText
      const densityTexts1 = densities1.map(density => 
        HistogramComparison.createDensityText(density, histogramTextExtractionOptions));
      const densityTexts2 = densities2.map(density => 
        HistogramComparison.createDensityText(density, histogramTextExtractionOptions));
      
      // Try to generate real embeddings using the client
      // Define the type for embedding results to fix TypeScript errors
      interface EmbeddingItem {
        density: any;
        text: string;
      }
      
      interface EmbeddingResult<T = any> {
        item: T & {
          vector?: number[];
        };
      }
      
      let embeddingResults1: EmbeddingResult<EmbeddingItem>[] = [];
      let embeddingResults2: EmbeddingResult<EmbeddingItem>[] = [];
      let useRealEmbeddings = false;
      
      try {
        // Attempt to generate real embeddings using the embedding provider
        embeddingResults1 = await generateEmbeddingsWithProvider<{density: any, text: string}>(
          client,
          densities1.map((density, i) => ({ density, text: densityTexts1[i] })),
          (item: {density: any, text: string}) => item.text,
          { 
            batchSize,
            context: { 
              source: 'HistogramComparison', 
              operation: 'density_embedding' 
            }
          },
          embeddingProviderConfig
        );
        
        embeddingResults2 = await generateEmbeddingsWithProvider<{density: any, text: string}>(
          client,
          densities2.map((density, i) => ({ density, text: densityTexts2[i] })),
          (item: {density: any, text: string}) => item.text,
          { 
            batchSize,
            context: { 
              source: 'HistogramComparison', 
              operation: 'density_embedding' 
            }
          },
          embeddingProviderConfig
        );
        
        // If we got valid embeddings, use them
        if (embeddingResults1?.length > 0 && embeddingResults2?.length > 0 &&
            embeddingResults1[0]?.item?.vector && embeddingResults2[0]?.item?.vector) {
          useRealEmbeddings = true;
          logger.info('[HistogramComparison] Successfully generated real embeddings');
        }
      } catch (embeddingError) {
        logger.warn('[HistogramComparison] Failed to generate real embeddings, falling back to text similarity', { 
          error: embeddingError 
        });
      }

      // If embedding generation failed, return error
      if (!embeddingResults1 || !embeddingResults2 || 
          embeddingResults1.length === 0 || embeddingResults2.length === 0) {
        logger.warn('[HistogramComparison] Embedding generation failed');
        return null;
      }

      // Calculate similarities between embeddings if we have real embeddings
      const similarities: number[] = [];
      const pairs: Array<{density1: any, density2: any, similarity: number}> = [];
      
      if (useRealEmbeddings) {
        // Use real vector embeddings for similarity calculation
        logger.info('[HistogramComparison] Using real vector embeddings for similarity calculation');
        
        for (let i = 0; i < embeddingResults1.length; i++) {
          for (let j = 0; j < embeddingResults2.length; j++) {
            // Calculate cosine similarity between the embedding vectors
            const similarity = HistogramComparison.calculateCosineSimilarity(
              embeddingResults1[i].item.vector as number[],
              embeddingResults2[j].item.vector as number[]
            );
            
            similarities.push(similarity);
            pairs.push({
              density1: embeddingResults1[i].item.density,
              density2: embeddingResults2[j].item.density,
              similarity
            });
          }
        }
      } else {
        // Fall back to text-based similarity
        logger.info('[HistogramComparison] Falling back to text-based similarity');
        
        for (let i = 0; i < densityTexts1.length; i++) {
          for (let j = 0; j < densityTexts2.length; j++) {
            // Calculate a simple similarity score based on text overlap
            const similarity = HistogramComparison.calculateTextSimilarity(
              densityTexts1[i],
              densityTexts2[j]
            );
            
            similarities.push(similarity);
            pairs.push({
              density1: densities1[i],
              density2: densities2[j],
              similarity
            });
          }
        }
      }

      // Calculate average similarity
      const averageSimilarity = similarities.length > 0 
        ? similarities.reduce((sum: number, sim: number) => sum + sim, 0) / similarities.length 
        : 0;

      // Find similar pairs (above threshold)
      const similarPairs = pairs.filter((pair: {similarity: number}) => pair.similarity >= similarityThreshold);

      // Group similar histograms into clusters
      const clusters = HistogramComparison.clusterSimilarHistograms(pairs, similarityThreshold);

      return {
        averageSimilarity,
        similarPairCount: similarPairs.length,
        totalPairCount: pairs.length,
        topSimilarPairs: similarPairs.sort((a: {similarity: number}, b: {similarity: number}) => b.similarity - a.similarity).slice(0, 10),
        clusters
      };
    } catch (error) {
      logger.error('[HistogramComparison] Error in embedding-based comparison', { error });
      return null;
    }
  }

  /**
   * Create a text representation of a histogram density for embedding generation
   * Uses the centralized text extraction utility for consistent text representation
   * 
   * @param density The histogram density to create a text representation for
   * @param textExtractionOptions Optional configuration for text extraction fields
   * @returns A text representation of the histogram density
   */
  private static createDensityText(density: any, textExtractionOptions?: TextExtractionOptions): string {
    if (!density) {
      return '';
    }
    
    // Create a rich text representation of the density object
    // This will be used for embedding generation
    const densityObject: any = {
      timestamp: density.timestamp || 'unknown time',
      stats: density.stats || {},
      modes: density.modes || [],
      // Add metadata fields that might be present
      metric: density.metric || {},
      attributes: density.attributes || {},
      labels: density.labels || {},
      dimensions: density.dimensions || {},
      tags: density.tags || {}
    };
    
    // Add density shape description as a field
    if (density.modes && Array.isArray(density.modes)) {
      if (density.modes.length === 0) {
        densityObject.shape = 'uniform or flat';
      } else if (density.modes.length === 1) {
        densityObject.shape = 'unimodal';
      } else if (density.modes.length === 2) {
        densityObject.shape = 'bimodal';
      } else {
        densityObject.shape = 'multimodal';
      }
    } else {
      densityObject.shape = 'unknown shape';
    }
    
    // Add mode information as fields
    if (density.modes && Array.isArray(density.modes) && density.modes.length > 0) {
      densityObject.modeCount = density.modes.length;
      densityObject.primaryMode = {
        x: density.modes[0].x?.toFixed(2) || 'unknown',
        y: density.modes[0].y?.toFixed(4) || 'unknown'
      };
      
      if (density.modes.length > 1) {
        densityObject.secondaryModes = [];
        for (let i = 1; i < Math.min(density.modes.length, 3); i++) {
          densityObject.secondaryModes.push({
            x: density.modes[i].x?.toFixed(2) || 'unknown',
            y: density.modes[i].y?.toFixed(4) || 'unknown'
          });
        }
      }
    }
    
    // Enrich with additional statistical information if available
    if (density.stats) {
      // Add percentiles if available
      if (density.stats.percentiles) {
        densityObject.percentiles = density.stats.percentiles;
      }
      
      // Add distribution type if available
      if (density.stats.skewness !== undefined) {
        if (density.stats.skewness > 0.5) {
          densityObject.distribution = 'right-skewed';
        } else if (density.stats.skewness < -0.5) {
          densityObject.distribution = 'left-skewed';
        } else {
          densityObject.distribution = 'approximately symmetric';
        }
      }
      
      // Add kurtosis description if available
      if (density.stats.kurtosis !== undefined) {
        if (density.stats.kurtosis > 3) {
          densityObject.peakedness = 'leptokurtic (heavy-tailed)';
        } else if (density.stats.kurtosis < 3) {
          densityObject.peakedness = 'platykurtic (light-tailed)';
        } else {
          densityObject.peakedness = 'mesokurtic (normal-like)';
        }
      }
    }
    
    // Define default text extraction options for histogram densities if not provided
    const extractionOptions: TextExtractionOptions = textExtractionOptions || {
      textFields: [
        'timestamp', 'shape', 'modeCount', 'distribution', 'peakedness',
        'metric.name', 'metric.description'
      ],
      dimensionFields: ['attributes', 'labels', 'dimensions', 'tags', 'metric'],
      valueFields: [
        'stats.mean', 'stats.median', 'stats.min', 'stats.max',
        'stats.stdDev', 'stats.variance', 'stats.skewness', 'stats.kurtosis',
        'primaryMode.x', 'primaryMode.y'
      ]
    };
    
    // Use our centralized text extraction utility to create a rich text representation
    let text = extractTextContent(densityObject, extractionOptions);
    
    // If the extraction didn't produce meaningful text, fall back to our custom format
    if (!text || text.trim().length === 0) {
      // Start with the timestamp
      text = `Histogram at ${density.timestamp || 'unknown time'}`;
      
      // Add density values
      if (density.x && density.y && Array.isArray(density.x) && Array.isArray(density.y)) {
        // Add summary statistics
        if (density.stats) {
          text += `. Mean: ${density.stats.mean?.toFixed(2) || 'unknown'}, `;
          text += `Median: ${density.stats.median?.toFixed(2) || 'unknown'}, `;
          text += `Min: ${density.stats.min?.toFixed(2) || 'unknown'}, `;
          text += `Max: ${density.stats.max?.toFixed(2) || 'unknown'}`;
        }
        
        // Add mode information
        if (density.modes && Array.isArray(density.modes) && density.modes.length > 0) {
          text += `. Modes: ${density.modes.length}. `;
          text += `Primary mode at x=${density.modes[0].x?.toFixed(2) || 'unknown'} `;
          text += `with height=${density.modes[0].y?.toFixed(4) || 'unknown'}`;
          
          // Add secondary modes if present
          if (density.modes.length > 1) {
            text += `. Secondary modes at: `;
            for (let i = 1; i < Math.min(density.modes.length, 3); i++) {
              text += `x=${density.modes[i].x?.toFixed(2) || 'unknown'} `;
              text += `(height=${density.modes[i].y?.toFixed(4) || 'unknown'})`;
              if (i < Math.min(density.modes.length, 3) - 1) {
                text += ', ';
              }
            }
          }
        } else {
          text += '. No distinct modes detected.';
        }
      }
    }
    
    return text;
  }

  /**
   * Cluster similar histograms based on embedding similarity
   */
  private static clusterSimilarHistograms(pairs: any[], similarityThreshold: number): any[] {
    // Simple clustering algorithm based on similarity threshold
    const clusters: any[] = [];
    const assigned = new Set<string>();

    // Sort pairs by similarity (highest first)
    const sortedPairs = [...pairs].sort((a, b) => b.similarity - a.similarity);

    for (const pair of sortedPairs) {
      if (pair.similarity < similarityThreshold) continue;
      
      const id1 = pair.density1.timestamp || JSON.stringify(pair.density1.dataPoints);
      const id2 = pair.density2.timestamp || JSON.stringify(pair.density2.dataPoints);
      
      // If both densities are already assigned to clusters, skip
      if (assigned.has(id1) && assigned.has(id2)) continue;
      
      // Find existing clusters containing either density
      const cluster1 = clusters.find(c => c.members.some((m: any) => 
        m.timestamp === pair.density1.timestamp || 
        JSON.stringify(m.dataPoints) === JSON.stringify(pair.density1.dataPoints)
      ));
      
      const cluster2 = clusters.find(c => c.members.some((m: any) => 
        m.timestamp === pair.density2.timestamp || 
        JSON.stringify(m.dataPoints) === JSON.stringify(pair.density2.dataPoints)
      ));
      
      if (cluster1 && cluster2 && cluster1 !== cluster2) {
        // Merge clusters
        cluster1.members = [...cluster1.members, ...cluster2.members];
        cluster1.similarities = [...cluster1.similarities, ...cluster2.similarities, pair.similarity];
        clusters.splice(clusters.indexOf(cluster2), 1);
      } else if (cluster1) {
        // Add density2 to cluster1
        if (!cluster1.members.includes(pair.density2)) {
          cluster1.members.push(pair.density2);
          cluster1.similarities.push(pair.similarity);
        }
      } else if (cluster2) {
        // Add density1 to cluster2
        if (!cluster2.members.includes(pair.density1)) {
          cluster2.members.push(pair.density1);
          cluster2.similarities.push(pair.similarity);
        }
      } else {
        // Create new cluster
        clusters.push({
          members: [pair.density1, pair.density2],
          similarities: [pair.similarity]
        });
      }
      
      assigned.add(id1);
      assigned.add(id2);
    }

    // Calculate average similarity for each cluster
    for (const cluster of clusters) {
      cluster.averageSimilarity = cluster.similarities.length > 0
        ? cluster.similarities.reduce((sum: number, sim: number) => sum + sim, 0) / cluster.similarities.length
        : 0;
    }

    return clusters;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private static calculateCosineSimilarity(vectorA: number[], vectorB: number[]): number {
    if (vectorA.length !== vectorB.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vectorA.length; i++) {
      dotProduct += vectorA[i] * vectorB[i];
      normA += vectorA[i] * vectorA[i];
      normB += vectorB[i] * vectorB[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  
  /**
   * Calculate similarity between two text descriptions
   * This is a simple implementation that counts shared words as a proxy for similarity
   */
  private static calculateTextSimilarity(text1: string, text2: string): number {
    // Normalize and tokenize texts
    const tokens1 = new Set(
      text1.toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
        .split(/\s+/)
    );
    
    const tokens2 = new Set(
      text2.toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
        .split(/\s+/)
    );
    
    // Count the number of shared tokens
    let sharedTokenCount = 0;
    // Convert Set to Array before iterating to avoid TypeScript error
    Array.from(tokens1).forEach(token => {
      if (tokens2.has(token)) {
        sharedTokenCount++;
      }
    });
    
    // Calculate Jaccard similarity
    const unionSize = tokens1.size + tokens2.size - sharedTokenCount;
    return unionSize > 0 ? sharedTokenCount / unionSize : 0;
  }

  private static calculateStatistics(dataPoints: number[]): any {
    if (dataPoints.length === 0) {
      return {
        count: 0,
        min: 0,
        max: 0,
        mean: 0,
        median: 0,
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
    const squaredDiffs = sorted.map(x => Math.pow(x - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / sorted.length;
    const stdDev = Math.sqrt(variance);
    
    return {
      mean,
      median,
      min,
      max,
      stdDev
    };
  }
}
