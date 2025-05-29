import { logger } from '../../../utils/logger.js';

/**
 * Prophet forecasting for metrics using OpenSearch's ML capabilities
 */
export class ProphetForecasting {
  /**
   * Forecast metrics using OpenSearch's Prophet implementation
   * @param client The OpenSearch client to use for requests
   * @param timeSeriesData Array of time series data points
   * @param options Configuration options
   */
  public static async forecastMetrics(
    client: any,
    timeSeriesData: Array<{
      timestamp: string;
      value: number;
    }>,
    options: {
      forecastPeriods?: number;
      seasonalityMode?: 'additive' | 'multiplicative';
      changePointPriorScale?: number;
      seasonalityPriorScale?: number;
      includeComponents?: boolean;
      intervalWidth?: number;
    } = {}
  ): Promise<any> {
    logger.info('[ProphetForecasting] Forecasting metrics', { 
      dataPoints: timeSeriesData.length, 
      options 
    });
    
    try {
      // Default options
      const forecastPeriods = options.forecastPeriods || 24;
      const seasonalityMode = options.seasonalityMode || 'additive';
      const changePointPriorScale = options.changePointPriorScale || 0.05;
      const seasonalityPriorScale = options.seasonalityPriorScale || 10;
      const includeComponents = options.includeComponents !== undefined ? options.includeComponents : true;
      const intervalWidth = options.intervalWidth || 0.8;
      
      // Sort data by timestamp
      timeSeriesData.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      
      // Convert to Prophet format (ds, y)
      const prophetData = timeSeriesData.map(point => ({
        ds: point.timestamp,
        y: point.value
      }));
      
      // Use OpenSearch's Prophet forecasting
      const prophetEndpoint = '/_plugins/_ml/forecast/prophet';
      const prophetRequest = {
        data: prophetData,
        forecast_periods: forecastPeriods,
        seasonality_mode: seasonalityMode,
        changepoint_prior_scale: changePointPriorScale,
        seasonality_prior_scale: seasonalityPriorScale,
        include_components: includeComponents,
        interval_width: intervalWidth
      };
      
      const prophetResponse = await client.request('POST', prophetEndpoint, prophetRequest);
      
      // Process the results
      const forecast = prophetResponse.forecast || [];
      
      // Convert forecast to consistent format
      const formattedForecast = forecast.map((point: any) => ({
        timestamp: point.ds,
        value: point.yhat,
        lowerBound: point.yhat_lower,
        upperBound: point.yhat_upper
      }));
      
      // Extract components if available
      const components: Record<string, any[]> = {};
      
      if (includeComponents && prophetResponse.components) {
        const componentTypes = ['trend', 'seasonal', 'weekly', 'yearly', 'daily'];
        
        for (const type of componentTypes) {
          if (prophetResponse.components[type]) {
            components[type] = prophetResponse.components[type].map((value: number, i: number) => ({
              timestamp: prophetData[i]?.ds,
              value
            }));
          }
        }
      }
      
      // Calculate forecast metrics
      const lastActualPoint = timeSeriesData[timeSeriesData.length - 1];
      const firstForecastPoint = formattedForecast[0];
      
      const forecastMetrics = {
        startValue: lastActualPoint.value,
        endValue: formattedForecast[formattedForecast.length - 1].value,
        changeAbsolute: formattedForecast[formattedForecast.length - 1].value - lastActualPoint.value,
        changePercent: lastActualPoint.value !== 0 
          ? ((formattedForecast[formattedForecast.length - 1].value - lastActualPoint.value) / lastActualPoint.value) * 100 
          : 0,
        trend: formattedForecast[formattedForecast.length - 1].value > lastActualPoint.value 
          ? 'increasing' 
          : (formattedForecast[formattedForecast.length - 1].value < lastActualPoint.value ? 'decreasing' : 'stable')
      };
      
      return {
        forecast: formattedForecast,
        components,
        metrics: forecastMetrics,
        model: {
          seasonalityMode,
          changePointPriorScale,
          seasonalityPriorScale,
          intervalWidth
        },
        summary: {
          inputPoints: timeSeriesData.length,
          forecastPoints: formattedForecast.length,
          forecastPeriods,
          startTimestamp: timeSeriesData[0]?.timestamp,
          endTimestamp: formattedForecast[formattedForecast.length - 1]?.timestamp
        },
        message: `Forecasted ${formattedForecast.length} points with Prophet`
      };
    } catch (error) {
      logger.error('[ProphetForecasting] Error forecasting metrics', { error });
      return { 
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to forecast metrics with Prophet'
      };
    }
  }
  
  /**
   * Detect changepoints in time series data using OpenSearch's Prophet implementation
   * @param client The OpenSearch client to use for requests
   * @param timeSeriesData Array of time series data points
   * @param options Configuration options
   */
  public static async detectChangepoints(
    client: any,
    timeSeriesData: Array<{
      timestamp: string;
      value: number;
    }>,
    options: {
      changePointPriorScale?: number;
      minDelta?: number;
    } = {}
  ): Promise<any> {
    logger.info('[ProphetForecasting] Detecting changepoints', { 
      dataPoints: timeSeriesData.length, 
      options 
    });
    
    try {
      // Default options
      const changePointPriorScale = options.changePointPriorScale || 0.05;
      const minDelta = options.minDelta || 0.1;
      
      // Sort data by timestamp
      timeSeriesData.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      
      // Convert to Prophet format (ds, y)
      const prophetData = timeSeriesData.map(point => ({
        ds: point.timestamp,
        y: point.value
      }));
      
      // Use OpenSearch's Prophet for changepoint detection
      const prophetEndpoint = '/_plugins/_ml/forecast/prophet';
      const prophetRequest = {
        data: prophetData,
        forecast_periods: 0, // No forecasting needed
        changepoint_prior_scale: changePointPriorScale,
        return_changepoints: true
      };
      
      const prophetResponse = await client.request('POST', prophetEndpoint, prophetRequest);
      
      // Process the changepoints
      const changepoints = prophetResponse.changepoints || [];
      
      // Filter changepoints by significance
      const significantChangepoints = changepoints
        .filter((cp: any) => Math.abs(cp.delta) >= minDelta)
        .map((cp: any) => ({
          timestamp: cp.ds,
          delta: cp.delta,
          value: timeSeriesData.find(p => p.timestamp === cp.ds)?.value || 0,
          direction: cp.delta > 0 ? 'increase' : 'decrease',
          magnitude: Math.abs(cp.delta)
        }));
      
      // Sort by magnitude (descending)
      significantChangepoints.sort((a: any, b: any) => b.magnitude - a.magnitude);
      
      return {
        changepoints: significantChangepoints,
        allChangepoints: changepoints.map((cp: any) => ({
          timestamp: cp.ds,
          delta: cp.delta,
          value: timeSeriesData.find(p => p.timestamp === cp.ds)?.value || 0,
          direction: cp.delta > 0 ? 'increase' : 'decrease',
          magnitude: Math.abs(cp.delta)
        })),
        summary: {
          totalChangepoints: changepoints.length,
          significantChangepoints: significantChangepoints.length,
          topChangepoint: significantChangepoints[0] || null,
          startTimestamp: timeSeriesData[0]?.timestamp,
          endTimestamp: timeSeriesData[timeSeriesData.length - 1]?.timestamp
        },
        message: `Detected ${significantChangepoints.length} significant changepoints`
      };
    } catch (error) {
      logger.error('[ProphetForecasting] Error detecting changepoints', { error });
      return { 
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to detect changepoints'
      };
    }
  }
  
  /**
   * Analyze seasonality in time series data using OpenSearch's Prophet implementation
   * @param client The OpenSearch client to use for requests
   * @param timeSeriesData Array of time series data points
   * @param options Configuration options
   */
  public static async analyzeSeasonality(
    client: any,
    timeSeriesData: Array<{
      timestamp: string;
      value: number;
    }>,
    options: {
      seasonalityMode?: 'additive' | 'multiplicative';
      seasonalityPriorScale?: number;
    } = {}
  ): Promise<any> {
    logger.info('[ProphetForecasting] Analyzing seasonality', { 
      dataPoints: timeSeriesData.length, 
      options 
    });
    
    try {
      // Default options
      const seasonalityMode = options.seasonalityMode || 'additive';
      const seasonalityPriorScale = options.seasonalityPriorScale || 10;
      
      // Sort data by timestamp
      timeSeriesData.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      
      // Convert to Prophet format (ds, y)
      const prophetData = timeSeriesData.map(point => ({
        ds: point.timestamp,
        y: point.value
      }));
      
      // Use OpenSearch's Prophet for seasonality analysis
      const prophetEndpoint = '/_plugins/_ml/forecast/prophet';
      const prophetRequest = {
        data: prophetData,
        forecast_periods: 0, // No forecasting needed
        seasonality_mode: seasonalityMode,
        seasonality_prior_scale: seasonalityPriorScale,
        include_components: true
      };
      
      const prophetResponse = await client.request('POST', prophetEndpoint, prophetRequest);
      
      // Process the seasonality components
      const components = prophetResponse.components || {};
      
      // Extract seasonality components
      const seasonalityComponents: Record<string, any[]> = {};
      const seasonalityTypes = ['seasonal', 'weekly', 'yearly', 'daily'];
      
      for (const type of seasonalityTypes) {
        if (components[type]) {
          seasonalityComponents[type] = components[type].map((value: number, i: number) => ({
            timestamp: prophetData[i]?.ds,
            value
          }));
        }
      }
      
      // Calculate seasonality strength
      const seasonalityStrength: Record<string, number> = {};
      
      for (const [type, values] of Object.entries(seasonalityComponents)) {
        if (values.length > 0) {
          const seasonalValues = values.map((v: any) => v.value);
          const maxAbs = Math.max(...seasonalValues.map(Math.abs));
          const range = Math.max(...seasonalValues) - Math.min(...seasonalValues);
          
          // Calculate strength as range / max absolute value
          seasonalityStrength[type] = maxAbs > 0 ? range / maxAbs : 0;
        }
      }
      
      // Identify dominant seasonality
      let dominantType = '';
      let dominantStrength = 0;
      
      for (const [type, strength] of Object.entries(seasonalityStrength)) {
        if (strength > dominantStrength) {
          dominantType = type;
          dominantStrength = strength;
        }
      }
      
      return {
        seasonalityComponents,
        seasonalityStrength,
        dominantSeasonality: {
          type: dominantType,
          strength: dominantStrength
        },
        model: {
          seasonalityMode,
          seasonalityPriorScale
        },
        summary: {
          detectedPatterns: Object.keys(seasonalityComponents),
          dominantPattern: dominantType,
          startTimestamp: timeSeriesData[0]?.timestamp,
          endTimestamp: timeSeriesData[timeSeriesData.length - 1]?.timestamp
        },
        message: `Analyzed seasonality in ${timeSeriesData.length} data points`
      };
    } catch (error) {
      logger.error('[ProphetForecasting] Error analyzing seasonality', { error });
      return { 
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to analyze seasonality'
      };
    }
  }
}
