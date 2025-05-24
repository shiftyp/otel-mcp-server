import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { registerMcpTool } from '../../utils/registerTool.js';

/**
 * Tool for generating markdown tables from OTEL data
 */
export class MarkdownTableTool {
  private esAdapter: ElasticsearchAdapter;

  constructor(esAdapter: ElasticsearchAdapter) {
    this.esAdapter = esAdapter;
  }

  /**
   * Register the markdown table tool with the MCP server
   */
  public register(server: McpServer): void {
    // Register the standard markdown table tool
    registerMcpTool(
      server,
      'generateMarkdownTable',
      {
        startTime: z.string().describe('Start time (ISO 8601)'),
        endTime: z.string().describe('End time (ISO 8601)'),
        headers: z.array(z.string()).describe('Column headers for the table'),
        queryType: z.enum(['logs', 'traces', 'metrics']).describe('Type of OTEL data to query'),
        query: z.object({}).describe('Query to fetch data dynamically'),
        fieldMappings: z.array(z.string()).describe('Field paths to extract for each column'),
        maxRows: z.number().optional().describe('Maximum number of rows to display (default: 100)'),
        alignment: z.array(z.enum(['left', 'center', 'right'])).optional().describe('Column alignments'),
        title: z.string().optional().describe('Table title'),
        queryString: z.string().optional().describe('Optional query string to further filter the data')
      },
      async (args: {
        startTime: string;
        endTime: string;
        headers: string[];
        queryType: 'logs' | 'traces' | 'metrics';
        query: any;
        fieldMappings: string[];
        maxRows?: number;
        alignment?: ('left' | 'center' | 'right')[];
        title?: string;
        queryString?: string;
      }, extra: unknown) => {
        logger.info('[MCP TOOL] markdown-table called', { args });
        try {
          const table = await this.generateMarkdownTable(
            args.startTime,
            args.endTime,
            args.headers,
            args.queryType,
            args.query,
            args.fieldMappings,
            args.maxRows,
            args.alignment,
            args.title,
            args.queryString
          );
          
          const output: MCPToolOutput = { 
            content: [
              { type: 'text', text: table }
            ] 
          };
          
          logger.info('[MCP TOOL] markdown-table result generated successfully');
          return output;
        } catch (error) {
          logger.error('[MCP TOOL] markdown-table error', { 
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
          return { 
            content: [{ 
              type: 'text', 
              text: `Error generating markdown table: ${error instanceof Error ? error.message : String(error)}` 
            }] 
          };
        }
      }
    );
    
    // Register the metrics time series table tool
    registerMcpTool(
      server,
      'generateMetricsTimeSeriesTable',
      {
        startTime: z.string().describe('Start time (ISO 8601)'),
        endTime: z.string().describe('End time (ISO 8601)'),
        metricField: z.string().describe('Metric field to visualize (e.g., "metric.value")'),
        services: z.array(z.string()).describe('Array of services to include in the table'),
        intervalCount: z.number().optional().describe('Number of time intervals to display (default: 6)'),
        formatValue: z.enum(['raw', 'percent', 'integer', 'decimal1', 'decimal2']).optional().describe('Format for metric values (default: "decimal2")'),
        title: z.string().optional().describe('Table title')
      },
      async (args: {
        startTime: string;
        endTime: string;
        metricField: string;
        services: string[];
        intervalCount?: number;
        formatValue?: 'raw' | 'percent' | 'integer' | 'decimal1' | 'decimal2';
        title?: string;
        query?: string;
      }, extra: unknown) => {
        logger.info('[MCP TOOL] metrics-time-series-table called', { args });
        try {
          const table = await this.generateMetricsTimeSeriesTable(
            args.startTime,
            args.endTime,
            args.metricField,
            args.services,
            args.intervalCount,
            args.formatValue,
            args.title
          );
          
          const output: MCPToolOutput = { 
            content: [{ type: 'text', text: table }] 
          };
          
          logger.info('[MCP TOOL] metrics-time-series-table result generated successfully');
          return output;
        } catch (error) {
          logger.error('[MCP TOOL] metrics-time-series-table error', { 
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
          return { 
            content: [{ 
              type: 'text', 
              text: `Error generating metrics time series table: ${error instanceof Error ? error.message : String(error)}` 
            }] 
          };
        }
      }
    );
  }

  /**
   * Generate a markdown table from OTEL data
   */
  public async generateMarkdownTable(
    startTime: string,
    endTime: string,
    headers: string[],
    queryType: 'logs' | 'traces' | 'metrics',
    query: any,
    fieldMappings: string[],
    maxRows: number = 100,
    alignment?: ('left' | 'center' | 'right')[],
    title?: string,
    queryString?: string
  ): Promise<string> {
    try {
      if (!headers || headers.length === 0) {
        return 'No headers provided for markdown table.';
      }

      if (!fieldMappings || fieldMappings.length === 0) {
        return 'No field mappings provided for markdown table.';
      }

      if (headers.length !== fieldMappings.length) {
        return `Headers count (${headers.length}) does not match field mappings count (${fieldMappings.length}).`;
      }

      // Prepare the query with time range
      const esQuery = {
        ...query,
        query: {
          ...query.query,
          bool: {
            ...(query.query?.bool || {}),
            must: [
              ...(query.query?.bool?.must || []),
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
        }
      };
      
      // Add custom query string if provided
      if (queryString) {
        esQuery.query.bool.must.push({
          query_string: {
            query: queryString
          }
        });
      }

      // Execute the appropriate query based on queryType
      let queryResult: any;
      switch (queryType) {
        case 'logs':
          queryResult = await this.esAdapter.queryLogs(esQuery);
          break;
        case 'traces':
          queryResult = await this.esAdapter.queryTraces(esQuery);
          break;
        case 'metrics':
          queryResult = await this.esAdapter.queryMetrics(esQuery);
          break;
        default:
          return `Unsupported query type: ${queryType}`;
      }

      // Transform query results into table data
      let data: string[][] = [];
      if (queryResult && queryResult.hits && queryResult.hits.hits) {
        data = queryResult.hits.hits.map((hit: any) => {
          const source = hit._source;
          // Map each field mapping to a corresponding value in the source
          return fieldMappings.map((fieldPath: string) => {
            const value = this.getNestedValue(source, fieldPath);
            return value !== undefined ? String(value) : '';
          });
        });
      }

      // Apply max rows limit
      if (data.length > maxRows) {
        data = data.slice(0, maxRows);
      }

      // Get column alignments or default to 'left' for all columns
      const alignments = alignment || headers.map(() => 'left' as const);

      // Ensure alignments array matches headers length
      while (alignments.length < headers.length) {
        alignments.push('left');
      }

      // Generate the markdown table
      let table = '';

      // Add title if provided
      if (title) {
        table += `### ${title}\n\n`;
      }

      // Add headers
      table += '| ' + headers.join(' | ') + ' |\n';

      // Add alignment row
      const alignmentRow = alignments.map((align: 'left' | 'center' | 'right') => {
        switch (align) {
          case 'center': return ':---:';
          case 'right': return '---:';
          default: return ':---'; // left alignment is default
        }
      });
      table += '| ' + alignmentRow.join(' | ') + ' |\n';

      // Add data rows
      for (const row of data) {
        // Ensure row has the same length as headers
        const paddedRow = [...row];
        while (paddedRow.length < headers.length) {
          paddedRow.push('');
        }

        // Escape pipe characters in cell values
        const escapedRow = paddedRow.map(cell => cell.replace(/\|/g, '\\|'));

        table += '| ' + escapedRow.join(' | ') + ' |\n';
      }

      // If no data, add a "No data" row
      if (data.length === 0) {
        const noDataRow = Array(headers.length).fill('No data');
        table += '| ' + noDataRow.join(' | ') + ' |\n';
      }

      return table;
    } catch (error) {
      logger.error('[MarkdownTable] Error generating markdown table', {
        error: error instanceof Error ? error.message : String(error)
      });
      return `Error generating table: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Helper method to get nested values from an object using a path string
   * Example: getNestedValue(obj, "user.profile.name")
   * 
   * This method handles two cases:
   * 1. Nested objects where the path represents object hierarchy (standard case)
   * 2. Flat objects where the field name itself contains dots (Elasticsearch case)
   */
  private getNestedValue(obj: any, path: string): any {
    if (!obj || !path) return undefined;
    
    // First try direct access - for Elasticsearch fields with dots in the name
    if (obj[path] !== undefined) {
      return obj[path];
    }
    
    // If direct access fails, try traversing the object hierarchy
    const keys = path.split('.');
    let current = obj;
    
    for (const key of keys) {
      if (current === null || current === undefined) return undefined;
      current = current[key];
    }
    
    return current;
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
   * Format a numeric value according to the specified format
   */
  private formatValue(value: number, format: 'raw' | 'percent' | 'integer' | 'decimal1' | 'decimal2' = 'decimal2'): string {
    if (value === undefined || value === null || isNaN(value)) {
      return '-';
    }
    
    switch (format) {
      case 'raw':
        return String(value);
      case 'percent':
        return `${(value * 100).toFixed(1)}%`;
      case 'integer':
        return Math.round(value).toString();
      case 'decimal1':
        return value.toFixed(1);
      case 'decimal2':
        return value.toFixed(2);
      default:
        return value.toFixed(2);
    }
  }
  
  /**
   * Generate a markdown table showing metrics over time across multiple services
   */
  public async generateMetricsTimeSeriesTable(
    startTime: string,
    endTime: string,
    metricField: string,
    services: string[],
    intervalCount: number = 6,
    valueFormat: 'raw' | 'percent' | 'integer' | 'decimal1' | 'decimal2' = 'decimal2',
    title?: string,
    query?: string
  ): Promise<string> {
    try {
      if (!services || services.length === 0) {
        return 'No services provided for metrics time series table.';
      }
      
      // Generate time intervals for columns
      const intervals = this.generateTimeIntervals(startTime, endTime, intervalCount);
      
      // Format time intervals for display
      const timeLabels = intervals.map(interval => {
        const date = new Date(interval);
        return date.toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      });
      
      // Create headers: Service name followed by time intervals
      const headers = ['Service', ...timeLabels];
      
      // Get metrics data for each service at each time interval
      const servicesData = await Promise.all(
        services.map(async (service) => {
          try {
            // Log the query parameters for debugging
            logger.info('[MarkdownTable] Querying metrics for service', {
              service,
              metricField,
              startTime,
              endTime
            });
            
            // Use the aggregateOtelMetricsRange method to get metrics for this service
            let metricsResults;
            
            if (query) {
              // If a custom query is provided, use it to filter the metrics
              const queryObj: any = {
                bool: {
                  must: [
                    {
                      range: {
                        '@timestamp': {
                          gte: startTime,
                          lte: endTime
                        }
                      }
                    },
                    {
                      term: {
                        'service.name': service
                      }
                    },
                    {
                      query_string: {
                        query: query
                      }
                    }
                  ]
                }
              };
              
              // Use the metrics query API with aggregation
              const result = await this.esAdapter.queryMetrics({
                size: 0,
                query: queryObj,
                aggs: {
                  time_buckets: {
                    date_histogram: {
                      field: '@timestamp',
                      fixed_interval: `${Math.ceil((new Date(endTime).getTime() - new Date(startTime).getTime()) / (intervalCount * 1000))}s`
                    },
                    aggs: {
                      metric_value: {
                        avg: {
                          field: metricField
                        }
                      }
                    }
                  }
                }
              });
              
              // Transform the results to match the expected format
              const buckets = result.aggregations?.time_buckets?.buckets || [];
              const timeseries = buckets.map((bucket: any) => ({
                timestamp: new Date(bucket.key).toISOString(),
                value: bucket.metric_value?.value || 0
              }));
              
              metricsResults = [JSON.stringify({ timeseries })];
            } else {
              // Use the standard aggregateOtelMetricsRange method if no custom query
              metricsResults = await this.esAdapter.aggregateOtelMetricsRange(
                startTime,
                endTime,
                metricField,
                service
              );
            }
            
            // Log the raw results for debugging
            logger.info('[MarkdownTable] Raw metrics results', {
              service,
              resultsCount: metricsResults.length,
              firstResult: metricsResults.length > 0 ? metricsResults[0].substring(0, 200) + '...' : 'none'
            });
            
            // Parse the JSON strings returned by the adapter
            const parsedResults = metricsResults.map(result => {
              try {
                return JSON.parse(result);
              } catch (e) {
                logger.error('[MarkdownTable] Error parsing metrics result', {
                  service,
                  error: e instanceof Error ? e.message : String(e),
                  result
                });
                return null;
              }
            }).filter(Boolean);
            
            // If we have results, use the first one (assuming it's the most relevant)
            if (parsedResults.length > 0) {
              const metrics = parsedResults[0];
              
              // Extract the timeseries data
              const timeseries = metrics.timeseries || [];
              
              // Create a map of timestamp to value for easy lookup
              const timeValueMap = new Map<string, number>();
              timeseries.forEach((point: {timestamp: string, value: number}) => {
                timeValueMap.set(point.timestamp, point.value);
              });
              
              // For each interval, find the closest value
              const values = intervals.map(interval => {
                const targetTime = new Date(interval).getTime();
                
                // Find the closest timestamp
                let closestTimestamp = '';
                let minDiff = Number.MAX_SAFE_INTEGER;
                
                for (const timestamp of timeValueMap.keys()) {
                  const time = new Date(timestamp).getTime();
                  const diff = Math.abs(time - targetTime);
                  
                  if (diff < minDiff) {
                    minDiff = diff;
                    closestTimestamp = timestamp;
                  }
                }
                
                // If we found a close match (within 1 hour), use that value
                if (closestTimestamp && minDiff < 3600000) {
                  return timeValueMap.get(closestTimestamp) || null;
                }
                
                return null;
              });
              
              return {
                service,
                values
              };
            }
            
            // If no results, return nulls for all intervals
            return {
              service,
              values: Array(intervals.length).fill(null)
            };
          } catch (error) {
            logger.error('[MarkdownTable] Error getting metrics for service', { 
              service, 
              error: error instanceof Error ? error.message : String(error)
            });
            
            // Return nulls on error
            return {
              service,
              values: Array(intervals.length).fill(null)
            };
          }
        })
      );
      
      // Generate the markdown table
      let table = '';
      
      // Add title if provided
      if (title) {
        table += `### ${title}\n\n`;
      }
      
      // Add a note about the metric field being queried
      table += `*Metric field: ${metricField}*\n\n`;
      
      // Add headers
      table += '| ' + headers.join(' | ') + ' |\n';
      
      // Add alignment row (service name left-aligned, metrics right-aligned)
      const alignments = [':---', ...Array(timeLabels.length).fill('---:')];
      table += '| ' + alignments.join(' | ') + ' |\n';
      
      // Add a row for each service
      for (const serviceData of servicesData) {
        const { service, values } = serviceData;
        
        // Format each value according to the specified format
        const formattedValues = values.map(value => {
          return value !== null ? this.formatValue(value, valueFormat) : '-';
        });
        
        // Create the row
        table += `| ${service} | ${formattedValues.join(' | ')} |\n`;
      }
      
      // If all values are null/empty, add a note
      const allEmpty = servicesData.every(({ values }) => 
        values.every(value => value === null)
      );
      
      if (allEmpty) {
        table += '\n*No metrics data found for the specified services and metric field in this time range.*\n';
      }
      
      return table;
    } catch (error) {
      logger.error('[MarkdownTable] Error generating metrics time series table', {
        error: error instanceof Error ? error.message : String(error)
      });
      return `Error generating metrics time series table: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
