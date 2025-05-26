import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { registerMcpTool } from '../../utils/registerTool.js';
import { escapeMermaidString } from '../../utils/mermaidEscaper.js';

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
        services: z.array(z.string()).optional().describe('Optional array of services to include. Use servicesGet tool to find available services.'),
        title: z.string().optional().describe('Optional chart title'),
        showData: z.boolean().optional().describe('Whether to show data values in the chart'),
        maxResults: z.number().optional().describe('Maximum number of results to show (default: 10)'),
        pattern: z.string().optional().describe('Filter errors by text pattern')
      },
      async (args: {
        startTime: string;
        endTime: string;
        services?: string[];
        title?: string;
        showData?: boolean;
        maxResults?: number;
        pattern?: string;
      }, extra: unknown) => {
        logger.info('[MCP TOOL] error-pie-chart called', { args });
        try {
          const mermaidChart = await this.generateErrorPieChart(
            args.startTime,
            args.endTime,
            args.services,
            args.title,
            args.showData,
            args.maxResults,
            args.pattern
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
    maxResults: number = 10,
    pattern?: string
  ): Promise<string> {
    // Get top errors from the logs adapter using the enhanced topErrors function
    logger.info('[Error Pie Chart] Calling topErrors', { 
      startTime, 
      endTime, 
      maxResults, 
      services, 
      pattern 
    });
    
    try {
      // If no services are specified, we'll pass undefined to the topErrors method
      // which will cause it to retrieve errors from all services
      if (!services || services.length === 0) {
        logger.info('[Error Pie Chart] No services specified, retrieving errors from all services');
        services = undefined;
      }
      
      // Get errors from logs using the topErrors method
      const errors = await this.esAdapter.topErrors(
        startTime,
        endTime,
        maxResults,
        services,
        pattern
      );
      
      // Log the errors for debugging
      logger.info('[Error Pie Chart] Errors returned from topErrors', { 
        errorCount: errors ? errors.length : 0,
        pattern: pattern,
        services: services,
        errors: errors && errors.length > 0 ? errors.map((e: any) => ({ error: e.error, count: e.count, service: e.service })) : 'No errors found'
      });
      
      // If we don't get any errors from topErrors, return a "No Errors Found" chart
      if (!errors || errors.length === 0) {
        logger.info('[Error Pie Chart] No errors found from topErrors');
        return `pie title Error Distribution\n    "No Errors Found" : 1`;
      }
      
      // Group errors by service
      const serviceErrors = new Map<string, number>();
      
      for (const error of errors) {
        // The topErrors method returns objects that may have service, level, etc.
        const errorObj = error as any;
        
        // Extract service name from various possible fields
        const service = errorObj.service || 
                       errorObj['Resource.service.name'] || 
                       errorObj['resource.attributes.service.name'] || 
                       errorObj['service.name'] || 
                       'unknown';
        const count = errorObj.count || 1;
        
        logger.info('[Error Pie Chart] Processing error', {
          error: errorObj.error,
          service,
          count
        });
        
        if (serviceErrors.has(service)) {
          serviceErrors.set(service, serviceErrors.get(service)! + count);
        } else {
          serviceErrors.set(service, count);
        }
      }
      
      // Log the service errors for debugging
      logger.info('[Error Pie Chart] Service errors', {
        serviceErrorCount: serviceErrors.size,
        serviceErrors: Array.from(serviceErrors.entries()).map(([service, count]) => ({ service, count }))
      });

      // Sort services by error count (descending)
      const sortedServices = Array.from(serviceErrors.entries())
        .sort((a, b) => b[1] - a[1]);

      // Build the Mermaid pie chart
      const mermaidLines = [];
      
      // Add pie directive with optional showData
      mermaidLines.push(showData ? 'pie showData' : 'pie');
      
      // Add title with escaped special characters
      const chartTitle = title || 'Error Distribution by Service';
      mermaidLines.push(`    title ${escapeMermaidString(chartTitle)}`);
      
      // Add data points with escaped service names
      for (const [service, count] of sortedServices) {
        // Escape the service name to handle special characters
        const escapedService = escapeMermaidString(service);
        mermaidLines.push(`    "${escapedService}" : ${count}`);
      }
      
      return mermaidLines.join('\n');
      
    } catch (error) {
      logger.error('[Error Pie Chart] Error getting errors', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // Return a fallback error pie chart
      return `pie title Error Distribution\n    "Error Retrieving Data" : 1`;
    }
  }
}
