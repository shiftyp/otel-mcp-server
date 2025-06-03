import { MetricsAdapterCore } from './metricCore.js';
import { logger } from '../../../utils/logger.js';
import { createErrorResponse, ErrorResponse, isErrorResponse } from '../../../utils/errorHandling.js';
import {
  HistogramComparator,
  MetricAnomalyDetector,
  TimeSeriesAnalyzer,
  AnomalyDetectionResult,
  TimeSeriesAnalysisResult,
  HistogramComparisonResult
} from './analysis/index.js';

/**
 * OpenSearch Metrics Adapter
 * Provides clean, high-level metrics analysis functionality
 */
export class MetricsAdapter extends MetricsAdapterCore {
  private histogramComparator: HistogramComparator;
  private anomalyDetector: MetricAnomalyDetector;
  private timeSeriesAnalyzer: TimeSeriesAnalyzer;

  constructor(options: any) {
    super(options);
    
    // Initialize analysis modules
    this.histogramComparator = new HistogramComparator(this);
    this.anomalyDetector = new MetricAnomalyDetector(this);
    this.timeSeriesAnalyzer = new TimeSeriesAnalyzer(this);
  }

  /**
   * Detect anomalies in metrics
   */
  public async detectMetricAnomalies(
    startTime: string,
    endTime: string,
    options: {
      metricField: string;
      thresholdType?: 'stddev' | 'percentile' | 'mad';
      sensitivity?: number;
      service?: string;
    }
  ): Promise<AnomalyDetectionResult | ErrorResponse> {
    logger.info('[MetricsAdapter] Detecting metric anomalies', {
      startTime,
      endTime,
      options
    });

    try {
      // Map threshold type to detection method
      const method = this.mapThresholdType(options.thresholdType);
      
      // Build query filter for service if provided
      const queryFilter = options.service ? {
        bool: {
          must: [
            { term: { 'service.name': options.service } }
          ]
        }
      } : undefined;

      const result = await this.anomalyDetector.detectAnomalies(
        options.metricField,
        { from: startTime, to: endTime },
        {
          method,
          sensitivity: options.sensitivity || 0.95,
          // Add service filter to the detector config if needed
        }
      );

      return result;
    } catch (error) {
      logger.error('[MetricsAdapter] Error detecting anomalies', { error });
      return createErrorResponse(
        error instanceof Error ? error.message : 'Unknown error detecting anomalies',
        { error: String(error) },
        undefined,
        500
      );
    }
  }

  /**
   * Analyze time series data
   */
  public async timeSeriesAnalysis(
    startTime: string,
    endTime: string,
    options: {
      metricField: string;
      analysisType?: 'basic' | 'trend' | 'seasonality' | 'full';
      forecastPoints?: number;
      service?: string;
    }
  ): Promise<TimeSeriesAnalysisResult & { forecast?: any[] } | ErrorResponse> {
    logger.info('[MetricsAdapter] Analyzing time series', {
      startTime,
      endTime,
      options
    });

    try {
      const result = await this.timeSeriesAnalyzer.analyze(
        options.metricField,
        { from: startTime, to: endTime },
        {
          smoothing: {
            enabled: options.analysisType === 'full',
            method: 'sma',
            window: 5
          }
        }
      );

      // Add forecast if requested
      let forecast;
      if (options.forecastPoints && options.forecastPoints > 0) {
        forecast = await this.timeSeriesAnalyzer.forecast(
          options.metricField,
          { from: startTime, to: endTime },
          options.forecastPoints
        );
      }

      // Filter result based on analysis type
      return this.filterAnalysisResult(result, options.analysisType, forecast);
    } catch (error) {
      logger.error('[MetricsAdapter] Error analyzing time series', { error });
      return createErrorResponse(
        error instanceof Error ? error.message : 'Unknown error analyzing time series',
        { error: String(error) },
        undefined,
        500
      );
    }
  }

  /**
   * Compare histogram patterns
   */
  public async compareHistograms(
    metricName: string,
    timeRange1: { from: string; to: string },
    timeRange2: { from: string; to: string },
    options: {
      useML?: boolean;
      densityPoints?: number;
    } = {}
  ): Promise<HistogramComparisonResult | ErrorResponse> {
    logger.info('[MetricsAdapter] Comparing histograms', {
      metric: metricName,
      timeRange1,
      timeRange2,
      options
    });

    try {
      const result = await this.histogramComparator.compareTimeRanges(
        metricName,
        timeRange1,
        timeRange2,
        {
          useEmbeddings: options.useML || false,
          densityPoints: options.densityPoints || 100
        }
      );

      return result;
    } catch (error) {
      logger.error('[MetricsAdapter] Error comparing histograms', { error });
      return createErrorResponse(
        error instanceof Error ? error.message : 'Unknown error comparing histograms',
        { error: String(error) },
        undefined,
        500
      );
    }
  }

  /**
   * Find similar metrics based on patterns
   */
  public async findSimilarMetrics(
    referenceMetric: string,
    candidateMetrics: string[],
    timeRange: { from: string; to: string },
    options: {
      topK?: number;
      minSimilarity?: number;
    } = {}
  ): Promise<Array<{
    metric: string;
    similarity: number;
    comparison: HistogramComparisonResult;
  }> | ErrorResponse> {
    logger.info('[MetricsAdapter] Finding similar metrics', {
      reference: referenceMetric,
      candidateCount: candidateMetrics.length,
      timeRange,
      options
    });

    try {
      // First fetch the reference histogram
      const referenceQuery = await this.buildHistogramQuery(referenceMetric, timeRange);
      const referenceResult = await this.searchMetrics(referenceQuery);
      
      if (!referenceResult.aggregations?.histogram) {
        return createErrorResponse('Failed to fetch reference metric histogram', {}, undefined, 400);
      }

      const referenceHistogram = {
        buckets: referenceResult.aggregations.histogram.buckets.map((b: any) => ({
          key: b.key,
          count: b.doc_count
        })),
        min: referenceResult.aggregations.stats.min,
        max: referenceResult.aggregations.stats.max,
        total: referenceResult.aggregations.stats.count
      };

      const similarMetrics = await this.histogramComparator.findSimilarPatterns(
        referenceHistogram,
        candidateMetrics,
        timeRange,
        {
          topK: options.topK || 10
        }
      );

      return similarMetrics;
    } catch (error) {
      logger.error('[MetricsAdapter] Error finding similar metrics', { error });
      return createErrorResponse(
        error instanceof Error ? error.message : 'Unknown error finding similar metrics',
        { error: String(error) },
        undefined,
        500
      );
    }
  }

  /**
   * Get metric statistics
   */
  public async getMetricStats(
    metricName: string,
    timeRange: { from: string; to: string },
    options: {
      service?: string;
      percentiles?: number[];
    } = {}
  ): Promise<any | ErrorResponse> {
    logger.info('[MetricsAdapter] Getting metric statistics', {
      metric: metricName,
      timeRange,
      options
    });

    try {
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
          stats: {
            extended_stats: {
              field: metricName
            }
          },
          percentiles: {
            percentiles: {
              field: metricName,
              percents: options.percentiles || [25, 50, 75, 90, 95, 99]
            }
          }
        }
      };

      // Add service filter if provided
      if (options.service) {
        query.query.bool.must.push({
          term: {
            'service.name': options.service
          }
        } as any);
      }

      const result = await this.searchMetrics(query);

      if (isErrorResponse(result)) {
        return result;
      }

      return {
        ...result.aggregations.stats,
        percentiles: result.aggregations.percentiles.values
      };
    } catch (error) {
      logger.error('[MetricsAdapter] Error getting metric statistics', { error });
      return createErrorResponse(
        error instanceof Error ? error.message : 'Unknown error getting metric statistics',
        { error: String(error) },
        undefined,
        500
      );
    }
  }

  // Private helper methods

  private mapThresholdType(type?: string): 'zscore' | 'mad' | 'percentile' {
    switch (type) {
      case 'stddev':
        return 'zscore';
      case 'mad':
        return 'mad';
      case 'percentile':
        return 'percentile';
      default:
        return 'zscore';
    }
  }

  private filterAnalysisResult(
    result: TimeSeriesAnalysisResult,
    analysisType?: string,
    forecast?: any[]
  ): TimeSeriesAnalysisResult & { forecast?: any[] } {
    const filtered: any = {};

    switch (analysisType) {
      case 'basic':
        filtered.statistics = result.statistics;
        filtered.timeSeries = result.timeSeries;
        break;
      case 'trend':
        filtered.trend = result.trend;
        filtered.timeSeries = result.timeSeries;
        break;
      case 'seasonality':
        filtered.seasonality = result.seasonality;
        filtered.timeSeries = result.timeSeries;
        break;
      case 'full':
      default:
        Object.assign(filtered, result);
    }

    if (forecast) {
      filtered.forecast = forecast;
    }

    return filtered;
  }

  private async buildHistogramQuery(
    metricName: string,
    timeRange: { from: string; to: string }
  ): Promise<any> {
    // First get the range to determine optimal interval
    const statsQuery = {
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
        stats: {
          stats: {
            field: metricName
          }
        }
      }
    };

    const statsResult = await this.searchMetrics(statsQuery);
    const stats = statsResult.aggregations.stats;
    const range = stats.max - stats.min;
    const interval = range / 50; // Aim for ~50 buckets

    return {
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
            interval: interval || 1
          }
        },
        stats: {
          stats: {
            field: metricName
          }
        }
      }
    };
  }
}