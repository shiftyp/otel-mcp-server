import { z } from 'zod';
import { BaseTool, ToolCategory } from '../../base/tool.js';
import { BaseSearchAdapter } from '../../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../../config/index.js';
import { MCPToolSchema } from '../../../types.js';

/**
 * Zod schema for forecast metrics arguments
 */
const ForecastMetricsSchema = {
  metricName: z.string().describe('Name of the metric to forecast'),
  historicalPeriod: z.string().describe('Historical data period for training (e.g., "7d", "30d")'),
  forecastPeriod: z.string().describe('Future period to predict (e.g., "1h", "24h", "7d")'),
  service: z.string().optional().describe('Service name to filter results (optional)'),
  confidence: z.number().min(0).max(1).optional().describe('Statistical confidence level 0-1 (default: 0.95)')
};

type ForecastMetricsArgs = MCPToolSchema<typeof ForecastMetricsSchema>;

interface ForecastResult {
  timestamp: string;
  predicted: number;
  upperBound?: number;
  lowerBound?: number;
}

/**
 * ML-powered metric forecasting tool
 */
export class ForecastMetricsTool extends BaseTool<typeof ForecastMetricsSchema> {
  // Static schema property
  static readonly schema = ForecastMetricsSchema;
  
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'forecastMetrics',
      category: ToolCategory.ANALYSIS,
      description: 'Predict future metric values using ML time-series models with confidence intervals',
      requiredCapabilities: ['ml'],
      backendSpecific: null // Available for any backend with ML
    });
  }
  
  protected getSchema() {
    return ForecastMetricsSchema;
  }
  
  protected async executeImpl(args: ForecastMetricsArgs): Promise<any> {
    const config = ConfigLoader.get();
    
    // Parse time periods
    const now = new Date();
    const historicalStart = this.subtractPeriod(now, args.historicalPeriod);
    const forecastEnd = this.addPeriod(now, args.forecastPeriod);
    
    const result = await this.adapter.forecast(
      config.telemetry.indices.metrics,
      {
        field: args.metricName,
        periods: this.parsePeriodToPoints(args.forecastPeriod),
        interval: this.determineInterval(args.historicalPeriod)
      },
      {
        from: historicalStart.toISOString(),
        to: now.toISOString()
      }
    );
    
    // Analyze forecast quality
    const forecastAnalysis = this.analyzeForecast(result);
    
    return this.formatJsonOutput({
      metric: args.metricName,
      service: args.service,
      timeRange: {
        historical: {
          from: historicalStart.toISOString(),
          to: now.toISOString()
        },
        forecast: {
          from: now.toISOString(),
          to: forecastEnd.toISOString()
        }
      },
      forecast: result,
      analysis: forecastAnalysis,
      confidence: args.confidence || config.ml.forecasting.defaultConfidence
    });
  }
  
  private subtractPeriod(date: Date, period: string): Date {
    const match = period.match(/^(\d+)([hdwm])$/);
    if (!match) return date;
    
    const value = parseInt(match[1]);
    const unit = match[2];
    const result = new Date(date);
    
    switch (unit) {
      case 'h':
        result.setHours(result.getHours() - value);
        break;
      case 'd':
        result.setDate(result.getDate() - value);
        break;
      case 'w':
        result.setDate(result.getDate() - value * 7);
        break;
      case 'm':
        result.setMonth(result.getMonth() - value);
        break;
    }
    
    return result;
  }
  
  private addPeriod(date: Date, period: string): Date {
    const match = period.match(/^(\d+)([hdwm])$/);
    if (!match) return date;
    
    const value = parseInt(match[1]);
    const unit = match[2];
    const result = new Date(date);
    
    switch (unit) {
      case 'h':
        result.setHours(result.getHours() + value);
        break;
      case 'd':
        result.setDate(result.getDate() + value);
        break;
      case 'w':
        result.setDate(result.getDate() + value * 7);
        break;
      case 'm':
        result.setMonth(result.getMonth() + value);
        break;
    }
    
    return result;
  }
  
  private parsePeriodToPoints(period: string): number {
    const match = period.match(/^(\d+)([hdwm])$/);
    if (!match) return 24; // Default to 24 points
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    // Return number of points based on period
    switch (unit) {
      case 'h':
        return value; // 1 point per hour
      case 'd':
        return value * 24; // 24 points per day
      case 'w':
        return value * 7 * 24; // 168 points per week
      case 'm':
        return value * 30 * 24; // ~720 points per month
      default:
        return 24;
    }
  }
  
  private determineInterval(period: string): string {
    const match = period.match(/^(\d+)([hdwm])$/);
    if (!match) return '1h';
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    // Determine appropriate interval based on historical period
    if (unit === 'h' || (unit === 'd' && value <= 1)) {
      return '5m'; // 5-minute intervals for short periods
    } else if (unit === 'd' && value <= 7) {
      return '1h'; // Hourly intervals for weekly data
    } else if (unit === 'd' || (unit === 'w' && value <= 4)) {
      return '6h'; // 6-hour intervals for monthly data
    } else {
      return '1d'; // Daily intervals for longer periods
    }
  }
  
  private analyzeForecast(forecast: ForecastResult[]): any {
    if (!forecast || forecast.length === 0) {
      return {
        trend: 'unknown',
        volatility: 'unknown',
        confidence: 'low'
      };
    }
    
    // Calculate trend
    const values = forecast.map(f => f.predicted);
    const firstValue = values[0];
    const lastValue = values[values.length - 1];
    const percentChange = ((lastValue - firstValue) / firstValue) * 100;
    
    let trend: string;
    if (Math.abs(percentChange) < 1) {
      trend = 'stable';
    } else if (percentChange > 0) {
      trend = percentChange > 10 ? 'increasing_sharply' : 'increasing';
    } else {
      trend = percentChange < -10 ? 'decreasing_sharply' : 'decreasing';
    }
    
    // Calculate volatility (if confidence intervals provided)
    let volatility = 'unknown';
    if (forecast[0].upperBound !== undefined) {
      const avgRange = forecast.reduce((sum, f) => {
        const range = (f.upperBound || f.predicted) - (f.lowerBound || f.predicted);
        return sum + range;
      }, 0) / forecast.length;
      
      const avgValue = values.reduce((sum, v) => sum + v, 0) / values.length;
      const relativeVolatility = (avgRange / avgValue) * 100;
      
      if (relativeVolatility < 5) {
        volatility = 'low';
      } else if (relativeVolatility < 15) {
        volatility = 'moderate';
      } else {
        volatility = 'high';
      }
    }
    
    return {
      trend,
      percentChange: Math.round(percentChange * 100) / 100,
      volatility,
      minValue: Math.min(...values),
      maxValue: Math.max(...values),
      avgValue: values.reduce((sum, v) => sum + v, 0) / values.length
    };
  }
}