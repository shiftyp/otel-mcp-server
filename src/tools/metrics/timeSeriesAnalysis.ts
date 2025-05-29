import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { registerMcpTool } from '../../utils/registerTool.js';
import { logger } from '../../utils/logger.js';
import { ElasticGuards } from '../../utils/guards/index.js';

/**
 * Performs time series analysis on metric data
 * @param esAdapter Elasticsearch adapter instance
 * @param startTime Start time in ISO format
 * @param endTime End time in ISO format
 * @param metricField The metric field to analyze
 * @param interval Time interval for bucketing (e.g., '1m', '5m', '1h')
 * @param serviceFilter Optional service name to filter metrics
 * @param queryString Additional query string to filter metrics
 * @param analysisType Type of analysis to perform
 * @returns Analysis results
 */
async function analyzeTimeSeries(
  esAdapter: ElasticsearchAdapter,
  startTime: string,
  endTime: string,
  metricField: string,
  interval: string,
  serviceFilter?: string,
  queryString?: string,
  analysisType: string = 'basic'
): Promise<any> {
  // Build the query must conditions
  const must: any[] = [
    {
      range: {
        '@timestamp': {
          gte: startTime,
          lte: endTime
        }
      }
    },
    {
      exists: { field: metricField }
    }
  ];

  // Add service filter if provided
  if (serviceFilter) {
    must.push({
      term: { 'resource.attributes.service.name': serviceFilter }
    });
  }

  // Add additional query string if provided
  if (queryString) {
    must.push({
      query_string: {
        query: queryString
      }
    });
  }

  // Execute the query to get time-series data
  const response = await esAdapter.queryMetrics({
    size: 0,
    query: {
      bool: {
        must
      }
    },
    aggs: {
      time_buckets: {
        date_histogram: {
          field: '@timestamp',
          fixed_interval: interval,
          min_doc_count: 0,
          extended_bounds: {
            min: new Date(startTime).getTime(),
            max: new Date(endTime).getTime()
          }
        },
        aggs: {
          metric_stats: {
            stats: {
              field: metricField
            }
          }
        }
      }
    }
  });

  // Extract time series data
  const buckets = response.aggregations?.time_buckets?.buckets || [];
  if (buckets.length === 0) {
    return {
      status: 'error',
      message: 'No data found for the specified parameters',
      parameters: {
        startTime,
        endTime,
        metricField,
        interval,
        serviceFilter,
        queryString
      }
    };
  }

  // Extract values for analysis
  const timeSeriesData = buckets.map((bucket: any) => ({
    timestamp: bucket.key_as_string,
    timestampMs: bucket.key,
    count: bucket.doc_count,
    min: bucket.metric_stats.min,
    max: bucket.metric_stats.max,
    avg: bucket.metric_stats.avg,
    sum: bucket.metric_stats.sum
  }));

  // Calculate basic statistics
  const values = timeSeriesData.map((point: any) => point.avg).filter((v: any) => v !== null && !isNaN(v));
  if (values.length === 0) {
    return {
      status: 'error',
      message: 'No valid values found for analysis',
      parameters: {
        startTime,
        endTime,
        metricField,
        interval,
        serviceFilter,
        queryString
      }
    };
  }

  const mean = values.reduce((sum: number, val: number) => sum + val, 0) / values.length;
  const stdDev = Math.sqrt(
    values.reduce((sum: number, val: number) => sum + Math.pow(val - mean, 2), 0) / values.length
  );

  // Sort values to calculate percentiles
  const sortedValues = [...values].sort((a, b) => a - b);
  const p50Index = Math.floor(sortedValues.length * 0.5);
  const p90Index = Math.floor(sortedValues.length * 0.9);
  const p95Index = Math.floor(sortedValues.length * 0.95);
  const p99Index = Math.floor(sortedValues.length * 0.99);

  const basicStats = {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    mean: mean,
    median: sortedValues[p50Index],
    p90: sortedValues[p90Index],
    p95: sortedValues[p95Index],
    p99: sortedValues[p99Index],
    stdDev: stdDev,
    variance: stdDev * stdDev
  };

  // Perform trend analysis
  let trendAnalysis = {};
  if (analysisType === 'trend' || analysisType === 'full') {
    // Calculate linear regression
    const n = values.length;
    const indices = Array.from({ length: n }, (_, i) => i);
    const sumX = indices.reduce((sum: number, i: number) => sum + i, 0);
    const sumY = values.reduce((sum: number, val: number) => sum + val, 0);
    const sumXY = indices.reduce((sum: number, i: number) => sum + i * values[i], 0);
    const sumXX = indices.reduce((sum: number, i: number) => sum + i * i, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    // Calculate trend direction and strength
    const trendDirection = slope > 0 ? 'increasing' : slope < 0 ? 'decreasing' : 'stable';
    const trendStrength = Math.abs(slope) / mean * 100; // as percentage of mean
    
    // Calculate R-squared (coefficient of determination)
    const predictedValues = indices.map((i: number) => intercept + slope * i);
    const ssRes = values.reduce((sum: number, val: number, i: number) => sum + Math.pow(val - predictedValues[i], 2), 0);
    const ssTot = values.reduce((sum: number, val: number) => sum + Math.pow(val - mean, 2), 0);
    const rSquared = 1 - (ssRes / ssTot);
    
    trendAnalysis = {
      slope,
      intercept,
      trendDirection,
      trendStrength: trendStrength,
      rSquared,
      trendSignificance: rSquared > 0.7 ? 'high' : rSquared > 0.3 ? 'medium' : 'low'
    };
  }

  // Perform seasonality analysis
  let seasonalityAnalysis = {};
  if (analysisType === 'seasonality' || analysisType === 'full') {
    // Simple autocorrelation to detect seasonality
    const maxLag = Math.floor(values.length / 2);
    const autocorrelation = [];
    
    for (let lag = 1; lag <= maxLag; lag++) {
      let numerator = 0;
      let denominator = 0;
      
      for (let i = 0; i < values.length - lag; i++) {
        numerator += (values[i] - mean) * (values[i + lag] - mean);
        denominator += Math.pow(values[i] - mean, 2);
      }
      
      const acf = numerator / denominator;
      autocorrelation.push({ lag, acf });
    }
    
    // Find peaks in autocorrelation
    const peaks = autocorrelation
      .filter((val, i, arr) => {
        if (i === 0) return val.acf > arr[i + 1].acf;
        if (i === arr.length - 1) return val.acf > arr[i - 1].acf;
        return val.acf > arr[i - 1].acf && val.acf > arr[i + 1].acf;
      })
      .filter(peak => peak.acf > 0.3) // Only significant peaks
      .sort((a, b) => b.acf - a.acf)
      .slice(0, 3); // Top 3 peaks
    
    seasonalityAnalysis = {
      hasSeasonal: peaks.length > 0,
      topPatterns: peaks.map(peak => ({
        period: peak.lag,
        strength: peak.acf
      }))
    };
  }

  // Perform outlier detection
  let outlierAnalysis = {};
  if (analysisType === 'outliers' || analysisType === 'full') {
    const threshold = mean + 3 * stdDev;
    const outliers = timeSeriesData
      .map((point: any, index: number) => {
        if (point.avg > threshold) {
          return {
            timestamp: point.timestamp,
            value: point.avg,
            deviationFactor: (point.avg - mean) / stdDev
          };
        }
        return null;
      })
      .filter(Boolean);
    
    outlierAnalysis = {
      outlierCount: outliers.length,
      outlierPercentage: (outliers.length / timeSeriesData.length) * 100,
      outliers: outliers.sort((a: any, b: any) => b.deviationFactor - a.deviationFactor).slice(0, 10)
    };
  }

  // Combine all analyses based on requested type
  let result: any = {
    timeSeriesData,
    basicStats
  };

  if (analysisType === 'trend' || analysisType === 'full') {
    result.trendAnalysis = trendAnalysis;
  }

  if (analysisType === 'seasonality' || analysisType === 'full') {
    result.seasonalityAnalysis = seasonalityAnalysis;
  }

  if (analysisType === 'outliers' || analysisType === 'full') {
    result.outlierAnalysis = outlierAnalysis;
  }

  return {
    status: 'success',
    metricField,
    startTime,
    endTime,
    interval,
    serviceFilter,
    queryString,
    analysisType,
    ...result
  };
}

/**
 * Registers the timeSeriesAnalysis tool with the MCP server.
 * @param server MCP server instance
 * @param esAdapter Elasticsearch adapter instance
 */
export function registerTimeSeriesAnalysisTool(server: McpServer, esAdapter: ElasticsearchAdapter) {
  registerMcpTool(
    server,
    'timeSeriesAnalysis',
    {
      startTime: z.string().describe('Start time (ISO8601, required, e.g. 2023-01-01T00:00:00Z)'),
      endTime: z.string().describe('End time (ISO8601, required, e.g. 2023-01-02T00:00:00Z)'),
      metricField: z.string().describe('Metric field to analyze (required)'),
      interval: z.string().default('5m').describe('Time interval for bucketing (e.g., "1m", "5m", "1h", default: "5m")'),
      service: z.string().optional().describe('Service name to filter metrics (optional)'),
      queryString: z.string().optional().describe('Additional Elasticsearch query string to filter metrics (optional)'),
      analysisType: z.enum(['basic', 'trend', 'seasonality', 'outliers', 'full']).default('basic').describe('Type of analysis to perform (basic, trend, seasonality, outliers, full)')
    },
    async (params: { 
      startTime: string, 
      endTime: string, 
      metricField: string, 
      interval: string, 
      service?: string, 
      queryString?: string,
      analysisType: 'basic' | 'trend' | 'seasonality' | 'outliers' | 'full'
    }) => {
      const { startTime, endTime, metricField, interval, service, queryString, analysisType } = params;
      
      try {
        logger.info('timeSeriesAnalysis called', { 
          startTime, 
          endTime, 
          metricField, 
          interval, 
          service, 
          queryString,
          analysisType
        });
        
        const result = await analyzeTimeSeries(
          esAdapter,
          startTime,
          endTime,
          metricField,
          interval,
          service,
          queryString,
          analysisType
        );
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (err) {
        logger.error('timeSeriesAnalysis failed', { 
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined
        });
        
        return ElasticGuards.formatErrorResponse(err, {
          startTime,
          endTime,
          metricField,
          interval,
          service,
          queryString,
          analysisType
        });
      }
    }
  );
}
