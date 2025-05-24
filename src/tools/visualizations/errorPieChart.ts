import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { registerMcpTool } from '../../utils/registerTool.js';

/**
 * Tool for generating error distribution pie charts
 */
export class ErrorPieChartTool {
  private esAdapter: ElasticsearchAdapter;

  constructor(esAdapter: ElasticsearchAdapter) {
    this.esAdapter = esAdapter;
  }

  /**
   * Register the error pie chart tool with the MCP server
   */
  public register(server: McpServer): void {
    registerMcpTool(
      server,
      'generateErrorPieChart',
      {
        startTime: z.string().describe('Start time (ISO 8601)'),
        endTime: z.string().describe('End time (ISO 8601)'),
        services: z.array(z.string()).optional().describe('Optional array of services to include'),
        title: z.string().optional().describe('Optional chart title'),
        showData: z.boolean().optional().describe('Whether to show data values in the chart'),
        maxResults: z.number().optional().describe('Maximum number of results to show (default: 10)')
      },
      async (args: {
        startTime: string;
        endTime: string;
        services?: string[];
        title?: string;
        showData?: boolean;
        maxResults?: number;
      }, extra: unknown) => {
        logger.info('[MCP TOOL] error-pie-chart called', { args });
        try {
          const mermaidChart = await this.generateErrorPieChart(
            args.startTime,
            args.endTime,
            args.services,
            args.title,
            args.showData,
            args.maxResults
          );

          // Create a markdown representation with the mermaid diagram
          const markdown = '```mermaid\n' + mermaidChart + '\n```';
          
          const output: MCPToolOutput = { 
            content: [
              { type: 'text', text: markdown }
            ] 
          };
          
          logger.info('[MCP TOOL] error-pie-chart result generated successfully');
          return output;
        } catch (error) {
          logger.error('[MCP TOOL] error-pie-chart error', { 
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
          return { 
            content: [{ 
              type: 'text', 
              text: `Error generating error pie chart: ${error instanceof Error ? error.message : String(error)}` 
            }] 
          };
        }
      }
    );
  }

  /**
   * Generate a Mermaid pie chart showing error distribution by service
   */
  public async generateErrorPieChart(
    startTime: string,
    endTime: string,
    services?: string[],
    title?: string,
    showData?: boolean,
    maxResults: number = 10
  ): Promise<string> {
    // Get top errors from the logs adapter
    const errors = await this.esAdapter.topErrors(
      startTime,
      endTime,
      maxResults,
      services
    );

    if (!errors || errors.length === 0) {
      return 'pie title No Errors Found\n    "No Errors" : 1';
    }

    // Group errors by service
    const serviceErrors = new Map<string, number>();
    
    for (const error of errors) {
      // The topErrors method returns objects that may have service, level, etc.
      // but TypeScript doesn't know about these properties
      const errorObj = error as any;
      const service = errorObj.service || errorObj.level || 'unknown';
      const count = errorObj.count || 1;
      
      if (serviceErrors.has(service)) {
        serviceErrors.set(service, serviceErrors.get(service)! + count);
      } else {
        serviceErrors.set(service, count);
      }
    }

    // Sort services by error count (descending)
    const sortedServices = Array.from(serviceErrors.entries())
      .sort((a, b) => b[1] - a[1]);

    // Build the Mermaid pie chart
    const mermaidLines = [];
    
    // Add pie directive with optional showData
    mermaidLines.push(showData ? 'pie showData' : 'pie');
    
    // Add title
    const chartTitle = title || 'Error Distribution by Service';
    mermaidLines.push(`    title ${chartTitle}`);
    
    // Add data points
    for (const [service, count] of sortedServices) {
      mermaidLines.push(`    "${service}" : ${count}`);
    }
    
    return mermaidLines.join('\n');
  }
}
