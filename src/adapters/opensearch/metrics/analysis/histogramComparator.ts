import { logger } from '../../../../utils/logger.js';
import { HistogramAnalyzer, HistogramData, HistogramStats } from './histogramAnalyzer.js';
import { MetricsAdapterCore } from '../metricCore.js';

/**
 * Comparison result between two histograms
 */
export interface HistogramComparisonResult {
  similarity: {
    statistical: number;
    structural: number;
    overall: number;
  };
  divergence: {
    klDivergence: number;
    jsDivergence: number;
    wasserstein: number;
    bhattacharyya: number;
  };
  stats: {
    histogram1: HistogramStats;
    histogram2: HistogramStats;
    differences: {
      meanDiff: number;
      medianDiff: number;
      stdDevDiff: number;
      skewnessDiff: number;
      kurtosisDiff: number;
    };
  };
  patterns: {
    modeComparison: Array<{
      hist1Mode: number;
      hist2Mode: number;
      difference: number;
      significantChange: boolean;
    }>;
    shapeChange: 'similar' | 'shifted' | 'scaled' | 'different';
  };
}

/**
 * Options for histogram comparison
 */
export interface ComparisonOptions {
  useEmbeddings?: boolean;
  densityPoints?: number;
  significanceThreshold?: number;
}

/**
 * High-level histogram comparison service
 */
export class HistogramComparator {
  private readonly analyzer: HistogramAnalyzer;
  private readonly defaultOptions: Required<ComparisonOptions>;

  constructor(
    private readonly adapter: MetricsAdapterCore,
    options: ComparisonOptions = {}
  ) {
    this.analyzer = new HistogramAnalyzer({
      densityPoints: options.densityPoints || 100
    });
    
    this.defaultOptions = {
      useEmbeddings: false,
      densityPoints: options.densityPoints || 100,
      significanceThreshold: options.significanceThreshold || 0.1
    };
  }

  /**
   * Compare two histograms
   */
  public async compare(
    histogram1: HistogramData,
    histogram2: HistogramData,
    options: ComparisonOptions = {}
  ): Promise<HistogramComparisonResult> {
    const opts = { ...this.defaultOptions, ...options };
    
    logger.info('[HistogramComparator] Comparing histograms', {
      hist1Buckets: histogram1.buckets.length,
      hist2Buckets: histogram2.buckets.length,
      useEmbeddings: opts.useEmbeddings
    });

    // Calculate statistics for both histograms
    const stats1 = this.analyzer.calculateStats(histogram1);
    const stats2 = this.analyzer.calculateStats(histogram2);
    
    // Calculate divergence metrics
    const divergence = this.analyzer.calculateDivergence(histogram1, histogram2);
    
    // Detect modes
    const modes1 = this.analyzer.detectModes(histogram1);
    const modes2 = this.analyzer.detectModes(histogram2);
    
    // Calculate similarities
    const statisticalSimilarity = this.calculateStatisticalSimilarity(divergence);
    const structuralSimilarity = await this.calculateStructuralSimilarity(
      histogram1, 
      histogram2, 
      opts
    );
    
    // Determine shape change
    const shapeChange = this.determineShapeChange(stats1, stats2, divergence);
    
    // Compare modes
    const modeComparison = this.compareModes(modes1, modes2, opts.significanceThreshold);
    
    return {
      similarity: {
        statistical: statisticalSimilarity,
        structural: structuralSimilarity,
        overall: (statisticalSimilarity + structuralSimilarity) / 2
      },
      divergence,
      stats: {
        histogram1: stats1,
        histogram2: stats2,
        differences: {
          meanDiff: Math.abs(stats1.mean - stats2.mean),
          medianDiff: Math.abs(stats1.median - stats2.median),
          stdDevDiff: Math.abs(stats1.stdDev - stats2.stdDev),
          skewnessDiff: Math.abs(stats1.skewness - stats2.skewness),
          kurtosisDiff: Math.abs(stats1.kurtosis - stats2.kurtosis)
        }
      },
      patterns: {
        modeComparison,
        shapeChange
      }
    };
  }

  /**
   * Compare histograms from different time ranges
   */
  public async compareTimeRanges(
    metricName: string,
    timeRange1: { from: string; to: string },
    timeRange2: { from: string; to: string },
    options: ComparisonOptions = {}
  ): Promise<HistogramComparisonResult> {
    logger.info('[HistogramComparator] Comparing time ranges', {
      metric: metricName,
      range1: timeRange1,
      range2: timeRange2
    });

    // Fetch histograms for both time ranges
    const [hist1, hist2] = await Promise.all([
      this.fetchHistogram(metricName, timeRange1),
      this.fetchHistogram(metricName, timeRange2)
    ]);

    return this.compare(hist1, hist2, options);
  }

  /**
   * Find similar histogram patterns
   */
  public async findSimilarPatterns(
    referenceHistogram: HistogramData,
    candidateMetrics: string[],
    timeRange: { from: string; to: string },
    options: ComparisonOptions & { topK?: number } = {}
  ): Promise<Array<{
    metric: string;
    similarity: number;
    comparison: HistogramComparisonResult;
  }>> {
    const topK = options.topK || 10;
    
    logger.info('[HistogramComparator] Finding similar patterns', {
      candidateCount: candidateMetrics.length,
      topK
    });

    const comparisons = await Promise.all(
      candidateMetrics.map(async (metric) => {
        const histogram = await this.fetchHistogram(metric, timeRange);
        const comparison = await this.compare(referenceHistogram, histogram, options);
        
        return {
          metric,
          similarity: comparison.similarity.overall,
          comparison
        };
      })
    );

    // Sort by similarity and return top K
    return comparisons
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  /**
   * Cluster metrics by histogram similarity
   */
  public async clusterByHistogram(
    metrics: string[],
    timeRange: { from: string; to: string },
    options: ComparisonOptions & { 
      numClusters?: number;
      minSimilarity?: number;
    } = {}
  ): Promise<Array<{
    clusterId: number;
    metrics: string[];
    centroid: HistogramData;
  }>> {
    const numClusters = options.numClusters || 5;
    const minSimilarity = options.minSimilarity || 0.7;
    
    logger.info('[HistogramComparator] Clustering metrics by histogram', {
      metricCount: metrics.length,
      numClusters
    });

    // Fetch all histograms
    const histograms = await Promise.all(
      metrics.map(async (metric) => ({
        metric,
        histogram: await this.fetchHistogram(metric, timeRange)
      }))
    );

    // Calculate pairwise similarities
    const similarityMatrix = await this.calculateSimilarityMatrix(
      histograms.map(h => h.histogram),
      options
    );

    // Simple hierarchical clustering
    const clusters = this.hierarchicalCluster(
      histograms,
      similarityMatrix,
      numClusters,
      minSimilarity
    );

    return clusters;
  }

  // Private helper methods

  private async fetchHistogram(
    metricName: string,
    timeRange: { from: string; to: string }
  ): Promise<HistogramData> {
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
        histogram: {
          histogram: {
            field: metricName,
            interval: this.calculateOptimalInterval(metricName)
          }
        },
        stats: {
          stats: {
            field: metricName
          }
        }
      }
    };

    const result = await this.adapter.searchMetrics(query);
    
    return {
      buckets: result.aggregations.histogram.buckets.map((b: any) => ({
        key: b.key,
        count: b.doc_count
      })),
      min: result.aggregations.stats.min,
      max: result.aggregations.stats.max,
      total: result.aggregations.stats.count
    };
  }

  private calculateOptimalInterval(metricName: string): number {
    // This should be calculated based on the data range
    // For now, using a simple heuristic
    if (metricName.includes('bytes')) return 1024 * 1024; // 1MB intervals
    if (metricName.includes('milliseconds')) return 100; // 100ms intervals
    if (metricName.includes('percent')) return 5; // 5% intervals
    return 1; // Default interval
  }

  private calculateStatisticalSimilarity(divergence: any): number {
    // Combine multiple divergence metrics into a single similarity score
    const jsScore = Math.exp(-divergence.jsDivergence);
    const wassersteinScore = Math.exp(-divergence.wasserstein);
    const bhattacharyyaScore = Math.exp(-divergence.bhattacharyya);
    
    return (jsScore + wassersteinScore + bhattacharyyaScore) / 3;
  }

  private async calculateStructuralSimilarity(
    hist1: HistogramData,
    hist2: HistogramData,
    options: Required<ComparisonOptions>
  ): Promise<number> {
    // Use density-based structural similarity
    const density1 = this.analyzer.estimateDensity(hist1);
    const density2 = this.analyzer.estimateDensity(hist2);
    
    return this.densityCorrelation(density1, density2);
  }

  private densityCorrelation(
    density1: Array<{ x: number; y: number }>,
    density2: Array<{ x: number; y: number }>
  ): number {
    if (density1.length !== density2.length) return 0;
    
    const y1 = density1.map(d => d.y);
    const y2 = density2.map(d => d.y);
    
    const mean1 = y1.reduce((a, b) => a + b, 0) / y1.length;
    const mean2 = y2.reduce((a, b) => a + b, 0) / y2.length;
    
    let numerator = 0;
    let denominator1 = 0;
    let denominator2 = 0;
    
    for (let i = 0; i < y1.length; i++) {
      const diff1 = y1[i] - mean1;
      const diff2 = y2[i] - mean2;
      
      numerator += diff1 * diff2;
      denominator1 += diff1 * diff1;
      denominator2 += diff2 * diff2;
    }
    
    const denominator = Math.sqrt(denominator1 * denominator2);
    return denominator === 0 ? 0 : numerator / denominator;
  }



  private determineShapeChange(
    stats1: HistogramStats,
    stats2: HistogramStats,
    divergence: any
  ): 'similar' | 'shifted' | 'scaled' | 'different' {
    const meanDiff = Math.abs(stats1.mean - stats2.mean);
    const stdDevRatio = stats1.stdDev / stats2.stdDev;
    const shapeDiff = Math.abs(stats1.skewness - stats2.skewness) + 
                      Math.abs(stats1.kurtosis - stats2.kurtosis);
    
    // Similar if all metrics are close
    if (divergence.jsDivergence < 0.1 && shapeDiff < 0.5) {
      return 'similar';
    }
    
    // Shifted if mean changed but shape is similar
    if (meanDiff > stats1.stdDev * 0.5 && shapeDiff < 0.5) {
      return 'shifted';
    }
    
    // Scaled if standard deviation changed but shape is similar
    if ((stdDevRatio < 0.5 || stdDevRatio > 2) && shapeDiff < 0.5) {
      return 'scaled';
    }
    
    return 'different';
  }

  private compareModes(
    modes1: Array<{ value: number; count: number; prominence: number }>,
    modes2: Array<{ value: number; count: number; prominence: number }>,
    threshold: number
  ): Array<any> {
    const comparisons: Array<any> = [];
    
    // Match modes between histograms
    for (const mode1 of modes1) {
      let bestMatch = null;
      let minDiff = Infinity;
      
      for (const mode2 of modes2) {
        const diff = Math.abs(mode1.value - mode2.value);
        if (diff < minDiff) {
          minDiff = diff;
          bestMatch = mode2;
        }
      }
      
      if (bestMatch) {
        comparisons.push({
          hist1Mode: mode1.value,
          hist2Mode: bestMatch.value,
          difference: minDiff,
          significantChange: minDiff > threshold * mode1.value
        });
      }
    }
    
    return comparisons;
  }


  private async calculateSimilarityMatrix(
    histograms: HistogramData[],
    options: ComparisonOptions
  ): Promise<number[][]> {
    const n = histograms.length;
    const matrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
    
    for (let i = 0; i < n; i++) {
      matrix[i][i] = 1; // Self-similarity
      
      for (let j = i + 1; j < n; j++) {
        const comparison = await this.compare(histograms[i], histograms[j], options);
        const similarity = comparison.similarity.overall;
        
        matrix[i][j] = similarity;
        matrix[j][i] = similarity;
      }
    }
    
    return matrix;
  }

  private hierarchicalCluster(
    items: Array<{ metric: string; histogram: HistogramData }>,
    similarityMatrix: number[][],
    numClusters: number,
    minSimilarity: number
  ): Array<{
    clusterId: number;
    metrics: string[];
    centroid: HistogramData;
  }> {
    // Simple implementation - in production, use a proper clustering library
    const clusters: Array<{
      clusterId: number;
      metrics: string[];
      centroid: HistogramData;
    }> = [];
    
    // Start with each item in its own cluster
    const assignments = items.map((_, i) => i);
    
    // Merge similar clusters
    while (clusters.length < numClusters) {
      let maxSim = -1;
      let mergeI = -1;
      let mergeJ = -1;
      
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          if (assignments[i] !== assignments[j] && similarityMatrix[i][j] > maxSim) {
            maxSim = similarityMatrix[i][j];
            mergeI = i;
            mergeJ = j;
          }
        }
      }
      
      if (maxSim < minSimilarity) break;
      
      // Merge clusters
      const oldCluster = assignments[mergeJ];
      for (let i = 0; i < assignments.length; i++) {
        if (assignments[i] === oldCluster) {
          assignments[i] = assignments[mergeI];
        }
      }
    }
    
    // Group by cluster
    const groups = new Map<number, typeof items>();
    items.forEach((item, i) => {
      const cluster = assignments[i];
      if (!groups.has(cluster)) {
        groups.set(cluster, []);
      }
      groups.get(cluster)!.push(item);
    });
    
    // Create cluster objects
    let clusterId = 0;
    for (const [_, groupItems] of groups) {
      clusters.push({
        clusterId: clusterId++,
        metrics: groupItems.map(item => item.metric),
        centroid: groupItems[0].histogram // Simple: use first as centroid
      });
    }
    
    return clusters;
  }
}