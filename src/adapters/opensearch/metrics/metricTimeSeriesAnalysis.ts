import { logger } from '../../../utils/logger.js';
import { MetricsAdapterCore, TimeSeriesPoint } from './metricCore.js';
import { ProphetForecasting } from './prophetForecasting.js';

/**
 * OpenSearch Metrics Time Series Analysis Adapter
 * Provides functionality for time series analysis of OpenTelemetry metrics data
 * using OpenSearch ML capabilities
 */
export class MetricsTimeSeriesAnalysisAdapter extends MetricsAdapterCore {
  constructor(options: any) {
    super(options);
  }

  /**
   * Perform time series analysis and forecasting using OpenSearch's ML capabilities
   */
  public async timeSeriesAnalysis(
    startTime: string,
    endTime: string,
    options: {
      metricField: string,
      service?: string,
      queryString?: string,
      interval?: string,
      analysisType?: 'basic' | 'trend' | 'seasonality' | 'outliers' | 'full',
      forecastPoints?: number
    }
  ): Promise<any> {
    logger.info('[OpenSearch MetricsTimeSeriesAnalysisAdapter] Performing time series analysis', { startTime, endTime, options });
    
    try {
      const indexPattern = 'metrics-*';
      const interval = options.interval || '5m';
      const analysisType = options.analysisType || 'basic';
      const forecastPoints = options.forecastPoints || 12; // Default to forecasting 12 points ahead
      
      if (!options.metricField) {
        return { 
          error: 'metricField is required',
          message: 'Failed to perform time series analysis: metricField is required'
        };
      }
      
      // Build the query filters
      const filters = [
        {
          range: {
            '@timestamp': {
              gte: startTime,
              lte: endTime
            }
          }
        }
      ] as any[];
      
      // Add service filter if specified
      if (options.service) {
        filters.push({
          term: {
            'resource.attributes.service.name': options.service
          }
        });
      }
      
      // Add additional query string if specified
      if (options.queryString) {
        filters.push({
          query_string: {
            query: options.queryString
          }
        });
      }
      
      // Get the time series data
      const timeSeriesQuery = {
        query: {
          bool: {
            filter: filters
          }
        },
        size: 0,
        aggs: {
          timeseries: {
            date_histogram: {
              field: '@timestamp',
              fixed_interval: interval
            },
            aggs: {
              metric_value: {
                avg: {
                  field: options.metricField
                }
              }
            }
          }
        }
      };
      
      const timeSeriesResponse = await this.request('POST', `/${indexPattern}/_search`, timeSeriesQuery);
      
      if (!timeSeriesResponse.aggregations?.timeseries?.buckets) {
        return { timeSeriesData: [], message: 'No metric data found' };
      }
      
      const timeSeriesBuckets = timeSeriesResponse.aggregations.timeseries.buckets;
      
      // Extract the time series data
      const timeSeriesData: TimeSeriesPoint[] = timeSeriesBuckets.map((bucket: any): TimeSeriesPoint => ({
        timestamp: bucket.key_as_string,
        value: bucket.metric_value.value || 0
      }));
      
      // Use OpenSearch's ML plugin for time series analysis
      const mlEndpoint = '/_plugins/_ml';
      
      // Results object
      const results: any = {
        timeSeriesData,
        metadata: {
          startTime,
          endTime,
          interval,
          analysisType,
          metricField: options.metricField,
          service: options.service,
          queryString: options.queryString
        }
      };
      
      // For trend analysis, use linear regression
      if (['trend', 'full'].includes(analysisType)) {
        const regressionRequest = {
          algorithm: 'linear_regression',
          parameters: {},
          input_data: {
            // X values are timestamps converted to numeric (milliseconds since epoch)
            feature_values: timeSeriesData.map((_: any, index: number) => [index]),
            // Y values are the metric values
            target_values: timeSeriesData.map((point: TimeSeriesPoint) => point.value)
          }
        };
        
        const regressionResponse = await this.request('POST', `${mlEndpoint}/train_predict`, regressionRequest);
        
        if (regressionResponse.prediction_result && regressionResponse.prediction_result.predicted_values) {
          results.trendAnalysis = {
            predictedValues: regressionResponse.prediction_result.predicted_values,
            model: regressionResponse.model_config
          };
        }
      }
      
      // For seasonality analysis, use FFT (Fast Fourier Transform)
      if (['seasonality', 'full'].includes(analysisType)) {
        // Use OpenSearch's signal processing plugin
        const fftEndpoint = '/_plugins/_ml/signal/fft';
        const fftRequest = {
          signal: timeSeriesData.map((point: TimeSeriesPoint) => point.value)
        };
        
        const fftResponse = await this.request('POST', fftEndpoint, fftRequest);
        
        if (fftResponse.fft) {
          // Find dominant frequencies
          const frequencies = fftResponse.fft.map((val: any, index: number) => ({
            frequency: index / timeSeriesData.length,
            amplitude: Math.sqrt(val.real * val.real + val.imag * val.imag)
          }));
          
          // Sort by amplitude
          frequencies.sort((a: any, b: any) => b.amplitude - a.amplitude);
          
          results.seasonalityAnalysis = {
            dominantFrequencies: frequencies.slice(1, 6), // Skip DC component (index 0)
            periodicity: frequencies.slice(1, 6).map((f: any) => ({
              frequency: f.frequency,
              period: f.frequency > 0 ? Math.round(1 / f.frequency) : 0,
              amplitude: f.amplitude
            }))
          };
        }
      }
      
      // For outlier detection, use DBSCAN
      if (['outliers', 'full'].includes(analysisType)) {
        const dbscanRequest = {
          algorithm: 'dbscan',
          parameters: {
            eps: 0.5,
            min_points: 3
          },
          input_data: {
            // Convert to 2D points (time index, value)
            feature_vectors: timeSeriesData.map((point: TimeSeriesPoint, index: number) => [index, point.value])
          }
        };
        
        const dbscanResponse = await this.request('POST', `${mlEndpoint}/execute_cluster`, dbscanRequest);
        
        if (dbscanResponse.cluster_result && dbscanResponse.cluster_result.cluster_indices) {
          // Identify outliers (cluster -1)
          const outliers = [];
          
          for (let i = 0; i < dbscanResponse.cluster_result.cluster_indices.length; i++) {
            if (dbscanResponse.cluster_result.cluster_indices[i] === -1) {
              outliers.push({
                index: i,
                timestamp: timeSeriesData[i].timestamp,
                value: timeSeriesData[i].value
              });
            }
          }
          
          results.outlierAnalysis = {
            outliers,
            clusterCount: new Set(dbscanResponse.cluster_result.cluster_indices.filter((c: number) => c !== -1)).size
          };
        }
      }
      
      // Forecasting using ARIMA model (unique to OpenSearch)
      const forecastRequest = {
        algorithm: 'arima',
        parameters: {
          p: 2, // AR order
          d: 1, // Differencing
          q: 2, // MA order
          forecast_steps: forecastPoints
        },
        input_data: {
          time_series: timeSeriesData.map((point: TimeSeriesPoint) => point.value)
        }
      };
      
      const forecastResponse = await this.request('POST', `${mlEndpoint}/forecast`, forecastRequest);
      
      if (forecastResponse.forecast_result && forecastResponse.forecast_result.forecast_points) {
        // Calculate forecast timestamps
        const lastTimestamp = new Date(timeSeriesData[timeSeriesData.length - 1].timestamp);
        const intervalMs = this.parseInterval(interval);
        
        const forecastTimestamps = Array.from({ length: forecastPoints }, (_, i: number) => {
          const forecastTime = new Date(lastTimestamp.getTime() + (i + 1) * intervalMs);
          return forecastTime.toISOString();
        });
        
        results.forecast = {
          points: forecastResponse.forecast_result.forecast_points.map((value: number, i: number): TimeSeriesPoint => ({
            timestamp: forecastTimestamps[i],
            value
          })),
          confidence_intervals: forecastResponse.forecast_result.confidence_intervals?.map((interval: any, i: number) => ({
            timestamp: forecastTimestamps[i],
            lower: interval.lower,
            upper: interval.upper
          }))
        };
      }
      
      return results;
    } catch (error: any) {
      logger.error('[OpenSearch MetricsTimeSeriesAnalysisAdapter] Error performing time series analysis', { error });
      return { 
        timeSeriesData: [], 
        error: error.message || error,
        message: 'Failed to perform time series analysis'
      };
    }
  }
  
  /**
   * Forecast metrics using Prophet algorithm
   * This leverages OpenSearch's Prophet implementation for more sophisticated forecasting
   */
  public async forecastMetricsWithProphet(
    timeSeriesData: Array<TimeSeriesPoint>,
    options: {
      forecastPeriods?: number;
      seasonalityMode?: 'additive' | 'multiplicative';
      changePointPriorScale?: number;
      seasonalityPriorScale?: number;
      includeComponents?: boolean;
      intervalWidth?: number;
    } = {}
  ): Promise<any> {
    logger.info('[OpenSearch MetricsTimeSeriesAnalysisAdapter] Forecasting metrics with Prophet', { 
      dataPoints: timeSeriesData.length, 
      options 
    });
    
    return ProphetForecasting.forecastMetrics(this, timeSeriesData, options);
  }

  /**
   * Detect changepoints in time series data using Prophet
   * This is useful for identifying significant shifts in metrics
   */
  public async detectChangepoints(
    timeSeriesData: Array<TimeSeriesPoint>,
    options: {
      changePointPriorScale?: number;
      minDelta?: number;
    } = {}
  ): Promise<any> {
    logger.info('[OpenSearch MetricsTimeSeriesAnalysisAdapter] Detecting changepoints', { 
      dataPoints: timeSeriesData.length, 
      options 
    });
    
    return ProphetForecasting.detectChangepoints(this, timeSeriesData, options);
  }

  /**
   * Analyze seasonality in time series data using Prophet
   * This helps identify daily, weekly, and yearly patterns in metrics
   */
  public async analyzeSeasonality(
    timeSeriesData: Array<TimeSeriesPoint>,
    options: {
      seasonalityMode?: 'additive' | 'multiplicative';
      seasonalityPriorScale?: number;
    } = {}
  ): Promise<any> {
    logger.info('[OpenSearch MetricsTimeSeriesAnalysisAdapter] Analyzing seasonality', { 
      dataPoints: timeSeriesData.length, 
      options 
    });
    
    return ProphetForecasting.analyzeSeasonality(this, timeSeriesData, options);
  }
}
