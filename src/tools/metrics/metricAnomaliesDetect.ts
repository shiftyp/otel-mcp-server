import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { registerMcpTool } from '../../utils/registerTool.js';
import { logger } from '../../utils/logger.js';

/**
 * Detects anomalies in gauge metrics (point-in-time values)
 */
async function detectGaugeMetricAnomalies(
  esAdapter: ElasticsearchAdapter,
  must: any[],
  metricField: string,
  thresholdType: string,
  thresholdValue?: number,
  windowSize: number = 10,
  maxResults: number = 20
): Promise<any> {
  // Create a copy of the must array
  const mustCopy = [...must];
  
  // Add filter for gauge metrics
  mustCopy.push({
    exists: { field: metricField }
  });
  
  // Execute the query to get time-series data
  const response = await esAdapter.queryMetrics({
    size: 0,
    query: {
      bool: {
        must: mustCopy
      }
    },
    aggs: {
      time_buckets: {
        date_histogram: {
          field: '@timestamp',
          fixed_interval: '1m',
          min_doc_count: 1
        },
        aggs: {
          metric_value: {
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
    return [];
  }
  
  // Extract values for analysis
  const timeSeriesData = buckets.map((bucket: any) => ({
    timestamp: bucket.key_as_string,
    value: bucket.metric_value.avg,
    max: bucket.metric_value.max,
    min: bucket.metric_value.min
  }));
  
  // Calculate statistics for the entire dataset
  const values = timeSeriesData.map((point: any) => point.value).filter((v: any) => v !== null && !isNaN(v));
  if (values.length === 0) {
    return [];
  }
  
  const mean = values.reduce((sum: number, val: number) => sum + val, 0) / values.length;
  const stdDev = Math.sqrt(
    values.reduce((sum: number, val: number) => sum + Math.pow(val - mean, 2), 0) / values.length
  );
  
  // Sort values to calculate percentiles
  const sortedValues = [...values].sort((a, b) => a - b);
  const p99Index = Math.floor(sortedValues.length * 0.99);
  const p99Value = sortedValues[p99Index];
  
  // Determine threshold based on type
  let threshold: number;
  let thresholdDescription: string;
  
  switch (thresholdType) {
    case 'p99':
      threshold = p99Value;
      thresholdDescription = `99th percentile (${p99Value.toFixed(2)})`;
      break;
    case 'stddev':
      threshold = mean + (3 * stdDev); // 3 standard deviations
      thresholdDescription = `mean + 3 stddev (${threshold.toFixed(2)})`;
      break;
    case 'fixed':
      if (thresholdValue === undefined) {
        throw new Error('Fixed threshold type requires a thresholdValue');
      }
      threshold = thresholdValue;
      thresholdDescription = `fixed value (${threshold.toFixed(2)})`;
      break;
    default:
      threshold = mean + (3 * stdDev); // Default to 3 standard deviations
      thresholdDescription = `mean + 3 stddev (${threshold.toFixed(2)})`;
  }
  
  // Find anomalies
  const anomalies = timeSeriesData
    .map((point: any) => {
      if (point.value > threshold) {
        const deviationFactor = (point.value - mean) / stdDev;
        return {
          timestamp: point.timestamp,
          value: point.value,
          threshold,
          deviationFactor: parseFloat(deviationFactor.toFixed(2)),
          percentAboveThreshold: parseFloat(((point.value - threshold) / threshold * 100).toFixed(2))
        };
      }
      return null;
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.deviationFactor - a.deviationFactor)
    .slice(0, maxResults);
  
  return {
    anomalies,
    stats: {
      mean: parseFloat(mean.toFixed(2)),
      stdDev: parseFloat(stdDev.toFixed(2)),
      p99: parseFloat(p99Value.toFixed(2)),
      threshold: parseFloat(threshold.toFixed(2)),
      thresholdType,
      thresholdDescription,
      totalPoints: timeSeriesData.length,
      anomalyCount: anomalies.length
    }
  };
}

/**
 * Detects anomalies in counter metrics (cumulative values)
 * For counters, we analyze the rate of change rather than absolute values
 */
async function detectCounterMetricAnomalies(
  esAdapter: ElasticsearchAdapter,
  must: any[],
  metricField: string,
  thresholdType: string,
  thresholdValue?: number,
  windowSize: number = 10,
  maxResults: number = 20
): Promise<any> {
  // Create a copy of the must array
  const mustCopy = [...must];
  
  // Add filter for counter metrics
  mustCopy.push({
    exists: { field: metricField }
  });
  
  // Execute the query to get time-series data
  const response = await esAdapter.queryMetrics({
    size: 0,
    query: {
      bool: {
        must: mustCopy
      }
    },
    aggs: {
      time_buckets: {
        date_histogram: {
          field: '@timestamp',
          fixed_interval: '1m',
          min_doc_count: 1
        },
        aggs: {
          metric_value: {
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
  if (buckets.length <= 1) { // Need at least 2 points to calculate rate
    return [];
  }
  
  // Extract values for analysis
  const rawTimeSeriesData = buckets.map((bucket: any) => ({
    timestamp: bucket.key_as_string,
    timestampMs: bucket.key,
    value: bucket.metric_value.max // For counters, use max value in the interval
  }));
  
  // Calculate rates of change between consecutive points
  const rateData = [];
  for (let i = 1; i < rawTimeSeriesData.length; i++) {
    const current = rawTimeSeriesData[i];
    const previous = rawTimeSeriesData[i-1];
    
    // Calculate time difference in seconds
    const timeDiffMs = current.timestampMs - previous.timestampMs;
    const timeDiffSeconds = timeDiffMs / 1000;
    
    // Calculate rate (per second)
    if (timeDiffSeconds > 0 && current.value >= previous.value) {
      const rate = (current.value - previous.value) / timeDiffSeconds;
      rateData.push({
        timestamp: current.timestamp,
        rate,
        rawValue: current.value
      });
    }
  }
  
  if (rateData.length === 0) {
    return [];
  }
  
  // Calculate statistics for rates
  const rates = rateData.map((point: any) => point.rate);
  const mean = rates.reduce((sum: number, val: number) => sum + val, 0) / rates.length;
  const stdDev = Math.sqrt(
    rates.reduce((sum: number, val: number) => sum + Math.pow(val - mean, 2), 0) / rates.length
  );
  
  // Sort rates to calculate percentiles
  const sortedRates = [...rates].sort((a, b) => a - b);
  const p99Index = Math.floor(sortedRates.length * 0.99);
  const p99Value = sortedRates[p99Index];
  
  // Determine threshold based on type
  let threshold: number;
  let thresholdDescription: string;
  
  switch (thresholdType) {
    case 'p99':
      threshold = p99Value;
      thresholdDescription = `99th percentile (${p99Value.toFixed(2)}/s)`;
      break;
    case 'stddev':
      threshold = mean + (3 * stdDev); // 3 standard deviations
      thresholdDescription = `mean + 3 stddev (${threshold.toFixed(2)}/s)`;
      break;
    case 'fixed':
      if (thresholdValue === undefined) {
        throw new Error('Fixed threshold type requires a thresholdValue');
      }
      threshold = thresholdValue;
      thresholdDescription = `fixed value (${threshold.toFixed(2)}/s)`;
      break;
    default:
      threshold = mean + (3 * stdDev); // Default to 3 standard deviations
      thresholdDescription = `mean + 3 stddev (${threshold.toFixed(2)}/s)`;
  }
  
  // Find anomalies in rates
  const anomalies = rateData
    .map((point: any) => {
      if (point.rate > threshold) {
        const deviationFactor = (point.rate - mean) / stdDev;
        return {
          timestamp: point.timestamp,
          rate: parseFloat(point.rate.toFixed(2)),
          rawValue: point.rawValue,
          threshold: parseFloat(threshold.toFixed(2)),
          deviationFactor: parseFloat(deviationFactor.toFixed(2)),
          percentAboveThreshold: parseFloat(((point.rate - threshold) / threshold * 100).toFixed(2))
        };
      }
      return null;
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.deviationFactor - a.deviationFactor)
    .slice(0, maxResults);
  
  return {
    anomalies,
    stats: {
      mean: parseFloat(mean.toFixed(2)),
      stdDev: parseFloat(stdDev.toFixed(2)),
      p99: parseFloat(p99Value.toFixed(2)),
      threshold: parseFloat(threshold.toFixed(2)),
      thresholdType,
      thresholdDescription,
      totalPoints: rateData.length,
      anomalyCount: anomalies.length,
      unit: 'per second'
    }
  };
}

/**
 * Detects anomalies in histogram metrics (distribution data)
 * For histograms, we analyze the distribution shape and percentile shifts
 */
async function detectHistogramMetricAnomalies(
  esAdapter: ElasticsearchAdapter,
  must: any[],
  metricField: string,
  thresholdType: string,
  thresholdValue?: number,
  windowSize: number = 10,
  maxResults: number = 20
): Promise<any> {
  // Create a copy of the must array
  const mustCopy = [...must];
  
  // Add filter for histogram metrics
  mustCopy.push({
    exists: { field: metricField }
  });
  
  // Execute the query to get histogram data with percentiles
  const response = await esAdapter.queryMetrics({
    size: 0,
    query: {
      bool: {
        must: mustCopy
      }
    },
    aggs: {
      time_buckets: {
        date_histogram: {
          field: '@timestamp',
          fixed_interval: '1m',
          min_doc_count: 1
        },
        aggs: {
          percentiles: {
            percentiles: {
              field: metricField,
              percents: [50, 75, 90, 95, 99]
            }
          },
          metric_stats: {
            stats: {
              field: metricField
            }
          }
        }
      }
    }
  });
  
  // Extract time series data with percentiles
  const buckets = response.aggregations?.time_buckets?.buckets || [];
  if (buckets.length === 0) {
    return [];
  }
  
  // Extract percentile data for analysis
  const timeSeriesData = buckets.map((bucket: any) => ({
    timestamp: bucket.key_as_string,
    p50: bucket.percentiles.values['50.0'],
    p75: bucket.percentiles.values['75.0'],
    p90: bucket.percentiles.values['90.0'],
    p95: bucket.percentiles.values['95.0'],
    p99: bucket.percentiles.values['99.0'],
    avg: bucket.metric_stats.avg,
    max: bucket.metric_stats.max
  }));
  
  // For histograms, we'll focus on anomalies in the p99 values
  const p99Values = timeSeriesData.map((point: any) => point.p99).filter((v: any) => v !== null && !isNaN(v));
  if (p99Values.length === 0) {
    return [];
  }
  
  // Calculate statistics for p99 values
  const mean = p99Values.reduce((sum: number, val: number) => sum + val, 0) / p99Values.length;
  const stdDev = Math.sqrt(
    p99Values.reduce((sum: number, val: number) => sum + Math.pow(val - mean, 2), 0) / p99Values.length
  );
  
  // Sort p99 values to calculate meta-percentiles
  const sortedP99Values = [...p99Values].sort((a, b) => a - b);
  const metaP99Index = Math.floor(sortedP99Values.length * 0.99);
  const metaP99Value = sortedP99Values[metaP99Index];
  
  // Determine threshold based on type
  let threshold: number;
  let thresholdDescription: string;
  
  switch (thresholdType) {
    case 'p99':
      threshold = metaP99Value;
      thresholdDescription = `99th percentile of p99 values (${metaP99Value.toFixed(2)})`;
      break;
    case 'stddev':
      threshold = mean + (3 * stdDev); // 3 standard deviations
      thresholdDescription = `mean + 3 stddev of p99 values (${threshold.toFixed(2)})`;
      break;
    case 'fixed':
      if (thresholdValue === undefined) {
        throw new Error('Fixed threshold type requires a thresholdValue');
      }
      threshold = thresholdValue;
      thresholdDescription = `fixed value (${threshold.toFixed(2)})`;
      break;
    default:
      threshold = mean + (3 * stdDev); // Default to 3 standard deviations
      thresholdDescription = `mean + 3 stddev of p99 values (${threshold.toFixed(2)})`;
  }
  
  // Find anomalies in p99 values
  const anomalies = timeSeriesData
    .map((point: any) => {
      if (point.p99 > threshold) {
        const deviationFactor = (point.p99 - mean) / stdDev;
        return {
          timestamp: point.timestamp,
          p99: point.p99,
          p95: point.p95,
          p90: point.p90,
          p75: point.p75,
          p50: point.p50,
          avg: point.avg,
          max: point.max,
          threshold,
          deviationFactor: parseFloat(deviationFactor.toFixed(2)),
          percentAboveThreshold: parseFloat(((point.p99 - threshold) / threshold * 100).toFixed(2))
        };
      }
      return null;
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.deviationFactor - a.deviationFactor)
    .slice(0, maxResults);
  
  return {
    anomalies,
    stats: {
      mean: parseFloat(mean.toFixed(2)),
      stdDev: parseFloat(stdDev.toFixed(2)),
      metaP99: parseFloat(metaP99Value.toFixed(2)),
      threshold: parseFloat(threshold.toFixed(2)),
      thresholdType,
      thresholdDescription,
      totalPoints: timeSeriesData.length,
      anomalyCount: anomalies.length,
      analyzedMetric: 'p99 values'
    }
  };
}

/**
 * Registers the metricAnomaliesDetect tool with the MCP server.
 * Detects anomalies in metric values (outliers, sudden changes).
 */
export function registerMetricAnomaliesDetectTool(server: McpServer, esAdapter: ElasticsearchAdapter) {
  registerMcpTool(
    server,
    'metricAnomaliesDetect',
    {
      startTime: z.string().describe('Start time (ISO8601, required)'),
      endTime: z.string().describe('End time (ISO8601, required)'),
      service: z.string().optional().describe('Service name (optional)'),
      metricField: z.string().describe('Metric field to analyze (required)'),
      metricType: z.enum(['gauge', 'counter', 'histogram']).describe('Type of metric (gauge, counter, histogram)'),
      metricName: z.string().optional().describe('Metric name (optional)'),
      queryString: z.string().optional().describe('Additional Elasticsearch query string to filter results'),
      thresholdType: z.enum(['p99', 'stddev', 'fixed']).default('stddev').describe('Threshold type for anomaly detection'),
      thresholdValue: z.number().optional().describe('Fixed threshold value (only used when thresholdType is fixed)'),
      windowSize: z.number().default(10).describe('Window size for moving average/stddev'),
      maxResults: z.number().default(20).describe('Maximum number of anomalies to return'),
    },
    async (params: { 
      startTime: string, 
      endTime: string, 
      service?: string, 
      metricField: string,
      metricType: 'gauge' | 'counter' | 'histogram',
      metricName?: string, 
      queryString?: string,
      thresholdType?: 'p99' | 'stddev' | 'fixed', 
      thresholdValue?: number,
      windowSize?: number, 
      maxResults?: number 
    }) => {
      const { 
        startTime, 
        endTime, 
        service, 
        metricField, 
        metricType, 
        metricName, 
        queryString,
        thresholdType = 'stddev', 
        thresholdValue,
        windowSize = 10, 
        maxResults = 20 
      } = params;
      
      try {
        logger.info('[MCP TOOL] metricAnomaliesDetect called', { 
          startTime, 
          endTime, 
          service, 
          metricField,
          metricType,
          metricName, 
          queryString,
          thresholdType, 
          thresholdValue,
          windowSize, 
          maxResults 
        });
        
        // Build the base bool filter
        const must: any[] = [];
        
        // Add time range filter
        if (startTime || endTime) {
          const range: any = { '@timestamp': {} };
          if (startTime) range['@timestamp'].gte = startTime;
          if (endTime) range['@timestamp'].lte = endTime;
          must.push({ range });
        }
        
        // Add service filter if provided
        if (service) {
          must.push({
            bool: {
              should: [
                { term: { 'service.name': service } },
                { term: { 'resource.attributes.service.name': service } },
                { term: { 'Resource.service.name': service } },
                { term: { 'kubernetes.deployment.name': service } }
              ],
              minimum_should_match: 1
            }
          });
        }
        
        // Add metric name filter if provided
        if (metricName) {
          must.push({
            bool: {
              should: [
                { term: { 'name.keyword': metricName } },
                { term: { 'metric.name.keyword': metricName } }
              ],
              minimum_should_match: 1
            }
          });
        }
        
        // Add query string filter if provided
        if (queryString) {
          must.push({
            query_string: {
              query: queryString
            }
          });
        }
        
        // Different query strategies based on metric type
        let anomalies: any[] = [];
        
        let result;
        switch (metricType) {
          case 'gauge':
            result = await detectGaugeMetricAnomalies(
              esAdapter,
              must,
              metricField,
              thresholdType,
              thresholdValue,
              windowSize,
              maxResults
            );
            anomalies = result.anomalies || [];
            break;
            
          case 'counter':
            result = await detectCounterMetricAnomalies(
              esAdapter,
              must,
              metricField,
              thresholdType,
              thresholdValue,
              windowSize,
              maxResults
            );
            anomalies = result.anomalies || [];
            break;
            
          case 'histogram':
            result = await detectHistogramMetricAnomalies(
              esAdapter,
              must,
              metricField,
              thresholdType,
              thresholdValue,
              windowSize,
              maxResults
            );
            anomalies = result.anomalies || [];
            break;
            
          default:
            throw new Error(`Unsupported metric type: ${metricType}`);
        }
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                anomalies,
                metadata: {
                  metricField,
                  metricType,
                  thresholdType,
                  thresholdValue,
                  windowSize,
                  queryString,
                  timeRange: {
                    start: startTime,
                    end: endTime
                  }
                }
              })
            }
          ]
        };
      } catch (err) {
        logger.error('[MCP TOOL] metricAnomaliesDetect failed', { 
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          params
        });
        
        return {
          content: [
            { type: 'text', text: `Metric anomaly detection failed: ${(err as Error).message}` }
          ],
          isError: true
        };
      }
    }
  );
}
