import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { registerMcpTool } from '../../utils/registerTool.js';
import { escapeMermaidString, escapeMermaidAxisLabels } from '../../utils/mermaidEscaper.js';

/**
 * Tool for generating XY charts (bar, line, scatter)
 * Supports visualizing data with two dimensions
 */
export class XYChartTool {
  private esAdapter: ElasticsearchAdapter;

  constructor(esAdapter: ElasticsearchAdapter) {
    this.esAdapter = esAdapter;
  }

  /**
   * Register the XY chart tool with the MCP server
   */
  public register(server: McpServer): void {
    registerMcpTool(
      server,
      'generateXYChart',
      {
        startTime: z.string().describe('Start time (ISO 8601)'),
        endTime: z.string().describe('End time (ISO 8601)'),
        chartType: z.enum(['bar', 'line', 'scatter']).describe('Type of chart to generate'),
        xField: z.string().describe('Field to use for X-axis values or categories'),
        yField: z.string().describe('Field to use for Y-axis values'),
        dataType: z.enum(['logs', 'traces', 'metrics']).describe('Type of OTEL data to analyze'),
        query: z.string().optional().describe('Optional query to filter the data'),
        title: z.string().optional().describe('Optional chart title'),
        xAxisTitle: z.string().optional().describe('Optional X-axis title'),
        yAxisTitle: z.string().optional().describe('Optional Y-axis title'),
        showValues: z.boolean().optional().describe('Whether to show data values on the chart'),
        maxItems: z.number().optional().describe('Maximum number of data points to show (default: 10)'),
        sortBy: z.enum(['x', 'y']).optional().describe('Sort by X or Y values (default: y)'),
        sortDirection: z.enum(['asc', 'desc']).optional().describe('Sort direction (default: desc)'),
        multiSeries: z.boolean().optional().describe('Whether to generate multiple series based on a grouping field'),
        seriesField: z.string().optional().describe('Field to use for grouping data into multiple series'),
        maxSeries: z.number().optional().describe('Maximum number of series to show (default: 5)'),
        aggregation: z.enum(['count', 'sum', 'avg', 'min', 'max']).optional().describe('Aggregation method for Y values (default: count)'),
        yMin: z.number().optional().describe('Minimum value for Y-axis'),
        yMax: z.number().optional().describe('Maximum value for Y-axis'),
        timeInterval: z.string().optional().describe('Time interval for time-based charts (e.g., "1h", "1d")')
      },
      async (args: {
        startTime: string;
        endTime: string;
        chartType: 'bar' | 'line' | 'scatter';
        xField: string;
        yField: string;
        dataType: 'logs' | 'traces' | 'metrics';
        query?: string;
        title?: string;
        xAxisTitle?: string;
        yAxisTitle?: string;
        showValues?: boolean;
        maxItems?: number;
        sortBy?: 'x' | 'y';
        sortDirection?: 'asc' | 'desc';
        multiSeries?: boolean;
        seriesField?: string;
        maxSeries?: number;
        aggregation?: 'count' | 'sum' | 'avg' | 'min' | 'max';
        yMin?: number;
        yMax?: number;
        timeInterval?: string;
      }, extra: unknown) => {
        logger.info('[MCP TOOL] xy-chart called', { args });
        try {
          const mermaidChart = await this.generateXYChart(
            args.startTime,
            args.endTime,
            args.chartType,
            args.xField,
            args.yField,
            args.dataType,
            args.query,
            args.title,
            args.xAxisTitle,
            args.yAxisTitle,
            args.showValues,
            args.maxItems,
            args.sortBy,
            args.sortDirection,
            args.multiSeries,
            args.seriesField,
            args.maxSeries,
            args.aggregation,
            args.yMin,
            args.yMax,
            args.timeInterval
          );

          // Create a markdown representation with the mermaid diagram
          const markdown = '```mermaid\n' + mermaidChart + '\n```';
          
          const output: MCPToolOutput = { 
            content: [
              { type: 'text', text: markdown }
            ] 
          };
          
          logger.info('[MCP TOOL] xy-chart result generated successfully');
          return output;
        } catch (error) {
          logger.error('[MCP TOOL] xy-chart error', { 
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
          return { 
            content: [{ 
              type: 'text', 
              text: `Error generating XY chart: ${error instanceof Error ? error.message : String(error)}` 
            }] 
          };
        }
      }
    );
  }

  /**
   * Helper method to determine if a field is likely numeric based on its name
   * This is a heuristic approach since we don't have direct field type information
   */
  private isLikelyNumericField(fieldName: string, dataType: 'logs' | 'traces' | 'metrics'): boolean {
    // Fields that are definitely numeric
    if (
      fieldName === 'Duration' ||
      fieldName.includes('.duration') ||
      fieldName.includes('.status_code') ||
      fieldName.includes('.count') ||
      fieldName.includes('.value') ||
      fieldName.includes('.size') ||
      fieldName.includes('.bytes') ||
      fieldName.includes('.length') ||
      fieldName.includes('.time') ||
      fieldName.includes('.timestamp') ||
      fieldName === '@timestamp' ||
      fieldName.match(/\d+$/) // Ends with digits
    ) {
      return true;
    }

    // Metrics fields are generally numeric
    if (dataType === 'metrics') {
      return true;
    }

    return false;
  }

  /**
   * Generate a Mermaid XY chart based on the specified parameters
   */
  public async generateXYChart(
    startTime: string,
    endTime: string,
    chartType: 'bar' | 'line' | 'scatter',
    xField: string,
    yField: string,
    dataType: 'logs' | 'traces' | 'metrics',
    query?: string,
    title?: string,
    xAxisTitle?: string,
    yAxisTitle?: string,
    showValues?: boolean,
    maxItems: number = 10,
    sortBy: 'x' | 'y' = 'y',
    sortDirection: 'asc' | 'desc' = 'desc',
    multiSeries: boolean = false,
    seriesField?: string,
    maxSeries: number = 5,
    aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max' = 'count',
    yMin?: number,
    yMax?: number,
    timeInterval?: string
  ): Promise<string> {
    // Build the Elasticsearch query
    const esQuery: any = {
      bool: {
        must: [
          {
            range: {
              '@timestamp': {
                gte: startTime,
                lte: endTime
              }
            }
          }
        ]
      }
    };

    // Add the custom query if provided
    if (query) {
      try {
        // Try to parse the query as JSON first
        const parsedQuery = JSON.parse(query);
        esQuery.bool.must.push(parsedQuery);
      } catch (e) {
        // If not valid JSON, treat as a query string
        esQuery.bool.must.push({
          query_string: {
            query: query
          }
        });
      }
    }

    // Create aggregations based on the chart configuration
    let aggregations: any = {};
    
    if (multiSeries && seriesField) {
      // Multi-series chart with series field
      // Add .keyword suffix for string fields if not already present
      const seriesFieldName = seriesField.endsWith('.keyword') ? seriesField : 
                            (dataType === 'logs' || dataType === 'traces') && !this.isLikelyNumericField(seriesField, dataType) ? 
                            `${seriesField}.keyword` : seriesField;
      
      // Handle x-field - only add .keyword for non-numeric fields
      const xFieldName = xField.endsWith('.keyword') ? xField : 
                       (dataType === 'logs' || dataType === 'traces') && !this.isLikelyNumericField(xField, dataType) ? 
                       `${xField}.keyword` : xField;
      
      // Handle y-field - only add .keyword for non-numeric fields
      // This is especially important for aggregation fields like Duration
      const yFieldName = yField.endsWith('.keyword') ? yField : 
                       (dataType === 'logs' || dataType === 'traces') && !this.isLikelyNumericField(yField, dataType) ? 
                       `${yField}.keyword` : yField;
      
      aggregations = {
        series: {
          terms: {
            field: seriesFieldName,
            size: maxSeries,
            order: {
              _count: 'desc'
            }
          },
          aggs: {
            x_values: {
              terms: {
                field: xFieldName,
                size: maxItems,
                order: {
                  [sortBy === 'x' ? '_key' : '_count']: sortDirection
                }
              }
            }
          }
        }
      };
      
      // Add y-value aggregation if not using count
      if (aggregation !== 'count' && yField) {
        aggregations.series.aggs.x_values.aggs = {
          y_value: {
            [aggregation]: {
              field: yFieldName
            }
          }
        };
      }
    } else {
      // Single series chart
      // Handle x-field - only add .keyword for non-numeric fields
      const xFieldName = xField.endsWith('.keyword') ? xField : 
                       (dataType === 'logs' || dataType === 'traces') && !this.isLikelyNumericField(xField, dataType) ? 
                       `${xField}.keyword` : xField;
      
      // Handle y-field - only add .keyword for non-numeric fields
      // This is especially important for aggregation fields like Duration
      const yFieldName = yField.endsWith('.keyword') ? yField : 
                       (dataType === 'logs' || dataType === 'traces') && !this.isLikelyNumericField(yField, dataType) ? 
                       `${yField}.keyword` : yField;
      
      aggregations = {
        x_values: {
          terms: {
            field: xFieldName,
            size: maxItems,
            order: {
              [sortBy === 'x' ? '_key' : '_count']: sortDirection
            }
          }
        }
      };
      
      // Add y-value aggregation if not using count
      if (aggregation !== 'count' && yField) {
        aggregations.x_values.aggs = {
          y_value: {
            [aggregation]: {
              field: yFieldName
            }
          }
        };
      }
    }

    // Handle time-based charts with date histogram
    if (timeInterval && xField === '@timestamp') {
      if (multiSeries && seriesField) {
        aggregations = {
          series: {
            terms: {
              field: seriesField,
              size: maxSeries,
              order: {
                _count: 'desc'
              }
            },
            aggs: {
              time_buckets: {
                date_histogram: {
                  field: '@timestamp',
                  calendar_interval: timeInterval,
                  format: 'yyyy-MM-dd HH:mm:ss'
                }
              }
            }
          }
        };
        
        // Add y-value aggregation if not using count
        if (aggregation !== 'count' && yField) {
          // Use the properly formatted field name for y-field
          const yFieldName = yField.endsWith('.keyword') ? yField : 
                           (dataType === 'logs' || dataType === 'traces') && 
                           !yField.includes('.status_code') && 
                           !yField.includes('@timestamp') && 
                           !yField.includes('.duration') && 
                           !yField.match(/\d+$/) ? 
                           `${yField}.keyword` : yField;
                           
          aggregations.series.aggs.time_buckets.aggs = {
            y_value: {
              [aggregation]: {
                field: yFieldName
              }
            }
          };
        }
      } else {
        aggregations = {
          time_buckets: {
            date_histogram: {
              field: '@timestamp',
              calendar_interval: timeInterval,
              format: 'yyyy-MM-dd HH:mm:ss'
            }
          }
        };
        
        // Add y-value aggregation if not using count
        if (aggregation !== 'count' && yField) {
          // Use the properly formatted field name for y-field
          const yFieldName = yField.endsWith('.keyword') ? yField : 
                           (dataType === 'logs' || dataType === 'traces') && 
                           !yField.includes('.status_code') && 
                           !yField.includes('@timestamp') && 
                           !yField.includes('.duration') && 
                           !yField.match(/\d+$/) ? 
                           `${yField}.keyword` : yField;
                           
          aggregations.time_buckets.aggs = {
            y_value: {
              [aggregation]: {
                field: yFieldName
              }
            }
          };
        }
      }
    }

    // Execute the query with aggregation based on data type
    let result;
    switch (dataType) {
      case 'logs':
        result = await this.esAdapter.queryLogs({
          size: 0,
          query: esQuery,
          aggs: aggregations
        });
        break;
      case 'traces':
        result = await this.esAdapter.queryTraces({
          size: 0,
          query: esQuery,
          aggs: aggregations
        });
        break;
      case 'metrics':
        result = await this.esAdapter.queryMetrics({
          size: 0,
          query: esQuery,
          aggs: aggregations
        });
        break;
      default:
        throw new Error(`Unsupported data type: ${dataType}`);
    }

    // Process the aggregation results
    let chartData: any = {};
    let xLabels: string[] = [];
    let yValues: { [series: string]: number[] } = {};
    let yMin_calculated = Number.MAX_VALUE;
    let yMax_calculated = Number.MIN_VALUE;

    if (timeInterval && xField === '@timestamp') {
      // Process time-based results
      if (multiSeries && seriesField && result?.aggregations?.series?.buckets) {
        const seriesBuckets = result.aggregations.series.buckets;
        
        // Create a map of all time buckets across all series
        const allTimeBuckets = new Map<string, number>();
        
        // First pass: collect all unique timestamps
        for (const seriesBucket of seriesBuckets) {
          const timeBuckets = seriesBucket.time_buckets.buckets;
          for (const bucket of timeBuckets) {
            allTimeBuckets.set(bucket.key_as_string, 0);
          }
        }
        
        // Sort timestamps
        xLabels = Array.from(allTimeBuckets.keys()).sort();
        
        // Second pass: populate series data
        for (const seriesBucket of seriesBuckets) {
          const seriesName = seriesBucket.key;
          yValues[seriesName] = new Array(xLabels.length).fill(0);
          
          const timeBuckets = seriesBucket.time_buckets.buckets;
          const bucketMap = new Map(timeBuckets.map((b: any) => [b.key_as_string, b]));
          
          for (let i = 0; i < xLabels.length; i++) {
            const timestamp = xLabels[i];
            const bucket: any = bucketMap.get(timestamp);
            
            if (bucket) {
              const value = aggregation === 'count' ? bucket.doc_count : bucket.y_value.value;
              yValues[seriesName][i] = value;
              
              // Update min/max
              yMin_calculated = Math.min(yMin_calculated, value);
              yMax_calculated = Math.max(yMax_calculated, value);
            }
          }
        }
      } else if (result?.aggregations?.time_buckets?.buckets) {
        const timeBuckets = result.aggregations.time_buckets.buckets;
        const seriesName = 'default';
        yValues[seriesName] = [];
        
        for (const bucket of timeBuckets) {
          xLabels.push(bucket.key_as_string);
          const value = aggregation === 'count' ? bucket.doc_count : bucket.y_value.value;
          yValues[seriesName].push(value);
          
          // Update min/max
          yMin_calculated = Math.min(yMin_calculated, value);
          yMax_calculated = Math.max(yMax_calculated, value);
        }
      }
    } else {
      // Process regular aggregation results
      if (multiSeries && seriesField && result?.aggregations?.series?.buckets) {
        const seriesBuckets = result.aggregations.series.buckets;
        
        // Create a map of all x values across all series
        const allXValues = new Map<string, number>();
        
        // First pass: collect all unique x values
        for (const seriesBucket of seriesBuckets) {
        
          const xBuckets = seriesBucket.x_values.buckets;
          for (const bucket of xBuckets) {
            allXValues.set(bucket.key, 0);
          }
        }
        
        // Sort x values based on sortBy and sortDirection
        if (sortBy === 'x') {
          xLabels = Array.from(allXValues.keys()).sort((a: string, b: string) => {
            return sortDirection === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
          });
        } else {
          // For y sorting, we'll use the order from the first series
          if (seriesBuckets.length > 0) {
            xLabels = seriesBuckets[0].x_values.buckets.map((b: any) => b.key);
          }
        }
        
        // Second pass: populate series data
        for (const seriesBucket of seriesBuckets) {
          const seriesName = seriesBucket.key;
          yValues[seriesName] = new Array(xLabels.length).fill(0);
          
          const xBuckets = seriesBucket.x_values.buckets;
          const bucketMap = new Map(xBuckets.map((b: any) => [b.key, b]));
          
          for (let i = 0; i < xLabels.length; i++) {
            const xValue = xLabels[i];
            const bucket = bucketMap.get(xValue);
            
            if (bucket) {
              const value = aggregation === 'count' ? (bucket as any).doc_count : (bucket as any).y_value.value;
              yValues[seriesName][i] = value;
              
              // Update min/max
              yMin_calculated = Math.min(yMin_calculated, value);
              yMax_calculated = Math.max(yMax_calculated, value);
            }
          }
        }
      } else if (result?.aggregations?.x_values?.buckets) {
        const xBuckets = result.aggregations.x_values.buckets;
        const seriesName = 'default';
        yValues[seriesName] = [];
        
        for (const bucket of xBuckets) {
          xLabels.push(bucket.key);
          const value = aggregation === 'count' ? (bucket as any).doc_count : (bucket as any).y_value.value;
          yValues[seriesName].push(value);
          
          // Update min/max
          yMin_calculated = Math.min(yMin_calculated, value);
          yMax_calculated = Math.max(yMax_calculated, value);
        }
      }
    }

    // If no data found, return a message
    if (Object.keys(yValues).length === 0 || xLabels.length === 0) {
      return `xychart-beta
    title No Data Found
    x-axis "No Data"
    y-axis 0 --> 1
    bar "No Data", 0`;
    }

    // Adjust min/max if needed
    if (yMin_calculated === Number.MAX_VALUE) yMin_calculated = 0;
    if (yMax_calculated === Number.MIN_VALUE) yMax_calculated = 10;
    
    // Add some padding to the y-axis
    const yRange = yMax_calculated - yMin_calculated;
    yMin_calculated = Math.max(0, yMin_calculated - yRange * 0.1);
    yMax_calculated = yMax_calculated + yRange * 0.1;
    
    // Use provided min/max if available
    const finalYMin = yMin !== undefined ? yMin : yMin_calculated;
    const finalYMax = yMax !== undefined ? yMax : yMax_calculated;

    // Build the Mermaid XY chart
    const mermaidLines: string[] = [];
  
    mermaidLines.push('xychart-beta');
    
    // Add title with escaped special characters
    const chartTitle = title || `${chartType.charAt(0).toUpperCase() + chartType.slice(1)} Chart of ${xField} vs ${yField}`;
    mermaidLines.push(`    title "${escapeMermaidString(chartTitle)}"`);
    
    // Add x-axis with escaped labels
    const xAxis = xAxisTitle || xField;
    
    // Special handling for timestamps to avoid Mermaid lexical errors
    let formattedXLabels = xLabels;
    if (xField === '@timestamp') {
      // For timestamps, use quotes with properly escaped colons
      formattedXLabels = xLabels.map(label => {
        // Escape colons in the timestamp
        const escapedLabel = label.replace(/:/g, '#58;');
        // Wrap in quotes for Mermaid
        return `"${escapedLabel}"`;
      });
      // Join without additional escaping since we've already handled it
      mermaidLines.push(`    x-axis "${escapeMermaidString(xAxis)}" [${formattedXLabels.join(',')}]`);
    } else {
      // For non-timestamp fields, use the standard escaping
      mermaidLines.push(`    x-axis "${escapeMermaidString(xAxis)}" [${escapeMermaidAxisLabels(formattedXLabels)}]`);
    }
    
    // Add y-axis with escaped label
    const yAxis = yAxisTitle || yField;
    mermaidLines.push(`    y-axis "${escapeMermaidString(yAxis)}" ${finalYMin} --> ${finalYMax}`);
    
    // Add data series
    const seriesNames = Object.keys(yValues);
    
    // For bar charts, we need a single series with values corresponding to x-axis labels
    if (chartType === 'bar') {
      // For Mermaid bar charts, values must be provided as a single array
      // The array length must match the number of x-axis labels
      if (seriesNames.length === 0) {
        // No data case - provide default values matching x-axis labels count
        const defaultValues = new Array(xLabels.length || 1).fill(0);
        mermaidLines.push(`    ${chartType} [${defaultValues.join(',')}]`);
      } else if (seriesNames.length > 1 && multiSeries) {
        // For multiple series, combine them into a single array
        const combinedValues: number[] = [];
        
        // For each x-label, add values from all series
        for (let i = 0; i < xLabels.length; i++) {
          let sum = 0;
          for (const seriesName of seriesNames) {
            if (yValues[seriesName] && yValues[seriesName][i] !== undefined) {
              sum += yValues[seriesName][i];
            }
          }
          combinedValues.push(sum || 0); // Use 0 if sum is falsy
        }
        
        // Add the combined bar chart
        mermaidLines.push(`    ${chartType} [${combinedValues.join(',')}]`);
      } else {
        // Single series bar chart
        const seriesName = seriesNames[0];
        // Ensure we have values that match x-axis labels
        if (yValues[seriesName] && yValues[seriesName].length > 0) {
          // Make sure all values are numbers, replace undefined/null with 0
          const cleanValues = yValues[seriesName].map(v => v || 0);
          mermaidLines.push(`    ${chartType} [${cleanValues.join(',')}]`);
        } else {
          // Fallback for empty data - provide values matching x-axis labels count
          const defaultValues = new Array(xLabels.length || 1).fill(0);
          mermaidLines.push(`    ${chartType} [${defaultValues.join(',')}]`);
        }
      }
    } else {
      // For line and scatter charts, keep the existing multi-series behavior
      for (const seriesName of seriesNames) {
        // Check if the series has any non-zero/non-empty values
        const hasValues = yValues[seriesName].some(value => value !== undefined && value !== null && value !== 0);
        
        // Only include series with actual values
        if (hasValues) {
          // For single series, don't include the series name
          if (seriesNames.length === 1 && seriesName === 'default') {
            mermaidLines.push(`    ${chartType} [${yValues[seriesName].join(',')}]`);
          } else {
            // Escape the series name to handle special characters
            const escapedSeriesName = escapeMermaidString(seriesName);
            mermaidLines.push(`    ${chartType} "${escapedSeriesName}" [${yValues[seriesName].join(',')}]`);
          }
        }
      }
    }
    
    return mermaidLines.join('\n');
  }
}
