import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { registerMcpTool } from '../../utils/registerTool.js';

/**
 * Tool for generating field distribution pie charts
 * Shows the distribution of values for a specific field in OTEL data
 */
export class FieldDistributionPieChartTool {
  private esAdapter: ElasticsearchAdapter;

  constructor(esAdapter: ElasticsearchAdapter) {
    this.esAdapter = esAdapter;
  }

  /**
   * Register the field distribution pie chart tool with the MCP server
   */
  public register(server: McpServer): void {
    registerMcpTool(
      server,
      'generateFieldDistributionPieChart',
      {
        startTime: z.string().describe('Start time (ISO 8601)'),
        endTime: z.string().describe('End time (ISO 8601)'),
        field: z.string().describe('The field to analyze for distribution (e.g., "Resource.service.name", "http.status_code")'),
        dataType: z.enum(['logs', 'traces', 'metrics']).describe('Type of OTEL data to analyze'),
        query: z.string().optional().describe('Optional query to filter the data'),
        title: z.string().optional().describe('Optional chart title'),
        showData: z.boolean().optional().describe('Whether to show data values in the chart'),
        maxSlices: z.number().optional().describe('Maximum number of slices to show (default: 10)')
      },
      async (args: {
        startTime: string;
        endTime: string;
        field: string;
        dataType: 'logs' | 'traces' | 'metrics';
        query?: string;
        title?: string;
        showData?: boolean;
        maxSlices?: number;
      }, extra: unknown) => {
        logger.info('[MCP TOOL] field-distribution-pie-chart called', { args });
        try {
          const mermaidChart = await this.generateFieldDistributionPieChart(
            args.startTime,
            args.endTime,
            args.field,
            args.dataType,
            args.query,
            args.title,
            args.showData,
            args.maxSlices
          );

          // Create a markdown representation with the mermaid diagram
          const markdown = '```mermaid\n' + mermaidChart + '\n```';
          
          const output: MCPToolOutput = { 
            content: [
              { type: 'text', text: markdown }
            ] 
          };
          
          logger.info('[MCP TOOL] field-distribution-pie-chart result generated successfully');
          return output;
        } catch (error) {
          logger.error('[MCP TOOL] field-distribution-pie-chart error', { 
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
          return { 
            content: [{ 
              type: 'text', 
              text: `Error generating field distribution pie chart: ${error instanceof Error ? error.message : String(error)}` 
            }] 
          };
        }
      }
    );
  }

  /**
   * Generate a Mermaid pie chart showing the distribution of values for a specific field
   */
  public async generateFieldDistributionPieChart(
    startTime: string,
    endTime: string,
    field: string,
    dataType: 'logs' | 'traces' | 'metrics',
    query?: string,
    title?: string,
    showData?: boolean,
    maxSlices: number = 10
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

    // Determine the index based on data type
    let index = '';
    switch (dataType) {
      case 'logs':
        index = 'logs-*';
        break;
      case 'traces':
        index = 'traces-*';
        break;
      case 'metrics':
        index = 'metrics-*';
        break;
    }

    // Create an aggregation to count values for the specified field
    const aggregation = {
      field_values: {
        terms: {
          field: field,
          size: maxSlices
        }
      }
    };

    // Execute the query with aggregation based on data type
    let result;
    switch (dataType) {
      case 'logs':
        result = await this.esAdapter.queryLogs({
          size: 0,
          query: esQuery,
          aggs: aggregation
        });
        break;
      case 'traces':
        result = await this.esAdapter.queryTraces({
          size: 0,
          query: esQuery,
          aggs: aggregation
        });
        break;
      case 'metrics':
        result = await this.esAdapter.queryMetrics({
          size: 0,
          query: esQuery,
          aggs: aggregation
        });
        break;
      default:
        throw new Error(`Unsupported data type: ${dataType}`);
    }

    // Extract the buckets from the aggregation result
    const buckets = result?.aggregations?.field_values?.buckets || [];

    if (!buckets || buckets.length === 0) {
      return `pie title No Data Found for ${field}\n    "No Data" : 1`;
    }

    // Build the Mermaid pie chart
    const mermaidLines = [];
    
    // Add pie directive with optional showData
    mermaidLines.push(showData ? 'pie showData' : 'pie');
    
    // Add title
    const chartTitle = title || `Distribution of ${field}`;
    mermaidLines.push(`    title ${chartTitle}`);
    
    // Add data points
    for (const bucket of buckets) {
      const key = bucket.key || 'unknown';
      const count = bucket.doc_count || 0;
      mermaidLines.push(`    "${key}" : ${count}`);
    }
    
    return mermaidLines.join('\n');
  }
}
