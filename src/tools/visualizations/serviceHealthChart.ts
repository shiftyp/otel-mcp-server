import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { registerMcpTool } from '../../utils/registerTool.js';

/**
 * Tool for generating service health charts
 */
export class ServiceHealthChartTool {
  private esAdapter: ElasticsearchAdapter;

  constructor(esAdapter: ElasticsearchAdapter) {
    this.esAdapter = esAdapter;
  }

  /**
   * Register the service health chart tool with the MCP server
   */
  public register(server: McpServer): void {
    registerMcpTool(
      server,
      'generateServiceHealthChart',
      {
        startTime: z.string().describe('Start time (ISO 8601)'),
        endTime: z.string().describe('End time (ISO 8601)'),
        services: z.array(z.string()).describe('Array of services to include'),
        metricField: z.string().optional().describe('Metric field to visualize (default: metric.value)'),
        aggregation: z.enum(['avg', 'min', 'max', 'sum']).optional().describe('Aggregation method for multiple services (default: avg)'),
        title: z.string().optional().describe('Chart title'),
        yAxisLabel: z.string().optional().describe('Y-axis label'),
        yMin: z.number().optional().describe('Minimum value for y-axis'),
        yMax: z.number().optional().describe('Maximum value for y-axis'),
        intervalCount: z.number().optional().describe('Number of time intervals to display (default: 6)'),
        query: z.string().optional().describe('Optional query to filter metrics (e.g. "name:http_requests_total")')
      },
      async (args: {
        startTime: string;
        endTime: string;
        service?: string;
        services?: string[];
        metricField?: string;
        aggregation?: 'avg' | 'min' | 'max' | 'sum';
        title?: string;
        showLegend?: boolean;
        dataPoints?: number;
        yAxisLabel?: string;
        yMin?: number;
        yMax?: number;
        intervalCount?: number;
        query?: string;
      }, extra: unknown) => {
        logger.info('[MCP TOOL] service-health-chart called', { args });
        try {
          const mermaidChart = await this.generateServiceHealthChart(
            args.startTime,
            args.endTime,
            args.services || [],
            args.metricField,
            args.aggregation || 'avg',
            args.title,
            args.yAxisLabel,
            args.yMin,
            args.yMax,
            args.intervalCount,
            args.query
          );

          // Create a markdown representation with the mermaid diagram
          const markdown = '```mermaid\n' + mermaidChart + '\n```';
          
          const output: MCPToolOutput = { 
            content: [
              { type: 'text', text: markdown }
            ] 
          };
          
          logger.info('[MCP TOOL] service-health-chart result generated successfully');
          return output;
        } catch (error) {
          logger.error('[MCP TOOL] service-health-chart error', { 
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
          return { 
            content: [{ 
              type: 'text', 
              text: `Error generating service health chart: ${error instanceof Error ? error.message : String(error)}` 
            }] 
          };
        }
      }
    );
  }

  /**
   * Generate a Mermaid chart showing service health metrics over time
   */
  public async generateServiceHealthChart(
    startTime: string,
    endTime: string,
    services: string[] = [],
    metricField?: string,
    aggregation: 'avg' | 'min' | 'max' | 'sum' = 'avg',
    title?: string,
    yAxisLabel?: string,
    yMin?: number,
    yMax?: number,
    intervalCount: number = 6,
    query?: string
  ): Promise<string> {
    // Generate time intervals for the x-axis
    const intervals = this.generateTimeIntervals(startTime, endTime, intervalCount);
    
    let servicesData = [];
    
    // If no services provided, query metrics data without service filter
    if (services.length === 0) {
      try {
        // Use the aggregateOtelMetricsRange method to get metrics without service filter
        const metricsResults = await this.esAdapter.aggregateOtelMetricsRange(
          startTime,
          endTime,
          metricField
        );
        
        // Parse the JSON strings returned by the adapter
        const parsedResults = metricsResults.map(result => JSON.parse(result));
        
        // If we have results, use the first one
        if (parsedResults.length > 0) {
          const metrics = parsedResults[0];
          
          // Extract the timeseries data
          const timeseries = metrics.timeseries || [];
          
          // Interpolate values for our specific intervals
          const values = this.interpolateMetricValues(timeseries, intervals);
          
          // Use the metric field as the service name
          servicesData.push({
            service: metricField || 'metric',
            metrics: values
          });
        }
      } catch (error) {
        logger.error('[ServiceHealthChart] Error getting metrics without service filter', { 
          error: error instanceof Error ? error.message : String(error)
        });
      }
    } else {
      // Query metrics data for each service
      servicesData = await Promise.all(
        services.map(async (service) => {
          try {
            // Use the aggregateOtelMetricsRange method to get metrics for this service
            // The service name is passed directly to the adapter method
            // which will handle the fuzzy matching consistently with other tools
            const metricsResults = await this.esAdapter.aggregateOtelMetricsRange(
              startTime,
              endTime,
              metricField,
              service // Service name - adapter will handle fuzzy matching
            );
            
            // Parse the JSON strings returned by the adapter
            const parsedResults = metricsResults.map(result => JSON.parse(result));
            
            // If we have results, use the first one (assuming it's the most relevant)
            if (parsedResults.length > 0) {
              const metrics = parsedResults[0];
              
              // Extract the timeseries data
              const timeseries = metrics.timeseries || [];
              
              // Interpolate values for our specific intervals - the timeseries already has the right format
              // with timestamp and value fields from our updated aggregateOtelMetricsRange method
              const values = this.interpolateMetricValues(timeseries, intervals);
              
              return {
                service,
                metrics: values
              };
            }
          
            // If no results, return empty metrics
            return {
              service,
              metrics: intervals.map(() => ({ value: 0 }))
            };
          } catch (error) {
            logger.error('[ServiceHealthChart] Error getting metrics for service', { 
              service, 
              error: error instanceof Error ? error.message : String(error)
            });
            
            // Return empty metrics on error
            return {
              service,
              metrics: intervals.map(() => ({ value: 0 }))
            };
          }
        })
      );
    }
    
    // Build the Mermaid chart
    const mermaidLines = ['xychart-beta'];
    
    // Add title
    const chartTitle = title || 'Service Metrics';
    mermaidLines.push(`    title "${chartTitle}"`);
    
    // Format x-axis with time intervals
    const xAxisLabels = intervals.map(interval => 
      new Date(interval).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
    );
    mermaidLines.push(`    x-axis [${xAxisLabels.map(l => `"${l}"`).join(', ')}]`);
    
    // Format y-axis
    const yAxisText = yAxisLabel || 'Value';
    
    // Calculate min and max values from the data if not provided
    let calculatedMin = Number.MAX_VALUE;
    let calculatedMax = Number.MIN_VALUE;
    
    // Find the minimum and maximum values across all services
    servicesData.forEach(({ metrics }) => {
      metrics.forEach(m => {
        if (m.value !== undefined && !isNaN(m.value)) {
          if (m.value < calculatedMin) {
            calculatedMin = m.value;
          }
          if (m.value > calculatedMax) {
            calculatedMax = m.value;
          }
        }
      });
    });
    
    // Handle edge cases
    if (calculatedMin === Number.MAX_VALUE || calculatedMax === Number.MIN_VALUE) {
      calculatedMin = 0;
      calculatedMax = 1;
    }
    
    // Add padding to the range (5% on bottom, 10% on top)
    const range = calculatedMax - calculatedMin;
    calculatedMin = Math.max(0, calculatedMin - range * 0.05); // Ensure min is not negative unless data is negative
    calculatedMax = calculatedMax + range * 0.1;
    
    // Round to nice values
    calculatedMin = Math.floor(calculatedMin * 10) / 10;
    calculatedMax = Math.ceil(calculatedMax * 10) / 10;
    
    const yMinValue = yMin !== undefined ? yMin : calculatedMin;
    const yMaxValue = yMax !== undefined ? yMax : calculatedMax;
    
    mermaidLines.push(`    y-axis "${yAxisText}" ${yMinValue} --> ${yMaxValue}`);
    
    // Aggregate data for all services into a single line
    if (servicesData.length === 1) {
      // If only one service, use its data directly
      const { service, metrics } = servicesData[0];
      const dataPoints = metrics.map(m => m.value || 0).join(', ');
      mermaidLines.push(`    line [${dataPoints}]`);
      mermaidLines.push(`    title "${service}"`);
    } else if (servicesData.length > 1) {
      // For multiple services, calculate the average value at each time point
      const intervalCount = servicesData[0]?.metrics.length || 0;
      const aggregatedValues = new Array(intervalCount).fill(0);
      const validValueCounts = new Array(intervalCount).fill(0);
      
      // Sum up values for each time point
      servicesData.forEach(({ metrics }) => {
        metrics.forEach((m, index) => {
          if (m.value !== undefined && !isNaN(m.value)) {
            aggregatedValues[index] += m.value;
            validValueCounts[index]++;
          }
        });
      });
      
      // Calculate aggregated values based on the specified aggregation method
      let aggregatedResult: number[] = [];
      let aggregationName: string;
      
      switch (aggregation) {
        case 'min':
          aggregationName = 'Minimum';
          aggregatedResult = new Array(intervalCount).fill(Number.MAX_VALUE);
          
          // Find minimum values for each time point
          servicesData.forEach(({ metrics }) => {
            metrics.forEach((m, index) => {
              if (m.value !== undefined && !isNaN(m.value) && m.value < aggregatedResult[index]) {
                aggregatedResult[index] = m.value;
              }
            });
          });
          
          // Handle edge case where no valid values were found
          aggregatedResult = aggregatedResult.map(val => val === Number.MAX_VALUE ? 0 : val);
          break;
          
        case 'max':
          aggregationName = 'Maximum';
          aggregatedResult = new Array(intervalCount).fill(Number.MIN_VALUE);
          
          // Find maximum values for each time point
          servicesData.forEach(({ metrics }) => {
            metrics.forEach((m, index) => {
              if (m.value !== undefined && !isNaN(m.value) && m.value > aggregatedResult[index]) {
                aggregatedResult[index] = m.value;
              }
            });
          });
          
          // Handle edge case where no valid values were found
          aggregatedResult = aggregatedResult.map(val => val === Number.MIN_VALUE ? 0 : val);
          break;
          
        case 'sum':
          aggregationName = 'Sum';
          aggregatedResult = aggregatedValues;
          break;
          
        case 'avg':
        default:
          aggregationName = 'Average';
          // Calculate averages
          aggregatedResult = aggregatedValues.map((sum, index) => {
            return validValueCounts[index] > 0 ? sum / validValueCounts[index] : 0;
          });
          break;
      }
      
      // Add the aggregated line
      const dataPoints = aggregatedResult.join(', ');
      mermaidLines.push(`    line [${dataPoints}]`);
      
      // Create a combined title with aggregation method
      const serviceNames = servicesData.map(({ service }) => service).join(', ');
      mermaidLines.push(`    title "${aggregationName} of ${serviceNames}"`);
    }
    
    return mermaidLines.join('\n');
  }
  
  /**
   * Generate evenly spaced time intervals between start and end times
   */
  private generateTimeIntervals(startTime: string, endTime: string, count: number): string[] {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    const step = (end - start) / (count - 1);
    
    const intervals: string[] = [];
    for (let i = 0; i < count; i++) {
      const time = new Date(start + i * step).toISOString();
      intervals.push(time);
    }
    
    return intervals;
  }
  
  /**
   * Interpolate metric values for specific time intervals
   */
  private interpolateMetricValues(
    timeseries: Array<{timestamp: string, value: number, min?: number, max?: number}>,
    intervals: string[]
  ): Array<{timestamp: string, value: number}> {
    if (!timeseries || timeseries.length === 0) {
      return intervals.map(timestamp => ({ timestamp, value: 0 }));
    }
    
    // Convert timestamps to milliseconds for easier comparison
    const timeseriesMs = timeseries.map(point => ({
      timestamp: new Date(point.timestamp).getTime(),
      value: point.value
    }));
    
    // Sort by timestamp
    timeseriesMs.sort((a, b) => a.timestamp - b.timestamp);
    
    return intervals.map(interval => {
      const targetTime = new Date(interval).getTime();
      
      // Find the closest points before and after the target time
      let beforeIndex = -1;
      let afterIndex = -1;
      
      for (let i = 0; i < timeseriesMs.length; i++) {
        if (timeseriesMs[i].timestamp <= targetTime) {
          beforeIndex = i;
        } else {
          afterIndex = i;
          break;
        }
      }
      
      // If we have points before and after, interpolate
      if (beforeIndex >= 0 && afterIndex >= 0) {
        const before = timeseriesMs[beforeIndex];
        const after = timeseriesMs[afterIndex];
        
        // Linear interpolation
        const ratio = (targetTime - before.timestamp) / (after.timestamp - before.timestamp);
        const value = before.value + ratio * (after.value - before.value);
        
        return { timestamp: interval, value };
      }
      
      // If we only have points before, use the last value
      if (beforeIndex >= 0) {
        return { timestamp: interval, value: timeseriesMs[beforeIndex].value };
      }
      
      // If we only have points after, use the first value
      if (afterIndex >= 0) {
        return { timestamp: interval, value: timeseriesMs[afterIndex].value };
      }
      
      // If we have no points, return 0
      return { timestamp: interval, value: 0 };
    });
  }
}
