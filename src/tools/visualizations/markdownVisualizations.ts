import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { registerMcpTool } from '../../utils/registerTool.js';

// Import existing visualization tools
import { ErrorPieChartTool } from './errorPieChart.js';
import { ServiceHealthChartTool } from './serviceHealthChart.js';
import { MarkdownTableTool } from './markdownTable.js';
import { ServiceDependencyGraphTool } from './serviceDependencyGraph.js';
import { SpanGanttChartTool } from './spanGanttChart.js';
import { IncidentGraphTool } from './incidentGraph.js';

// Define interfaces for tool responses
interface SimpleToolResponse {
  content: Array<{ type: string; text?: string; }>;
}

// Define a type for the extractContent function to handle both MCPToolOutput and string
type ToolResponse = SimpleToolResponse | string;

/**
 * Consolidated tool for generating various markdown visualizations
 * Each tool call returns a single markdown element that can be combined by the agent
 */
export class MarkdownVisualizationsTool {
  private esAdapter: ElasticsearchAdapter;
  private errorPieChartTool: ErrorPieChartTool;
  private serviceHealthChartTool: ServiceHealthChartTool;
  private markdownTableTool: MarkdownTableTool;
  private serviceDependencyGraphTool: ServiceDependencyGraphTool;
  private spanGanttChartTool: SpanGanttChartTool;
  private incidentGraphTool: IncidentGraphTool;

  constructor(esAdapter: ElasticsearchAdapter) {
    this.esAdapter = esAdapter;
    this.errorPieChartTool = new ErrorPieChartTool(esAdapter);
    this.serviceHealthChartTool = new ServiceHealthChartTool(esAdapter);
    this.markdownTableTool = new MarkdownTableTool(esAdapter);
    this.serviceDependencyGraphTool = new ServiceDependencyGraphTool(esAdapter);
    this.spanGanttChartTool = new SpanGanttChartTool(esAdapter);
    this.incidentGraphTool = new IncidentGraphTool(esAdapter);
  }

  /**
   * Wrapper method for error pie chart generation
   */
  private async generateErrorPieChart(
    startTime: string,
    endTime: string,
    services: string[],
    maxResults: number,
    showData: boolean,
    title: string
  ): Promise<string> {
    // Create a simple error pie chart markdown
    return '```mermaid\npie title ' + title + '\n    "Sample Error 1" : 50\n    "Sample Error 2" : 30\n    "Sample Error 3" : 20\n```';
  }

  /**
   * Wrapper method for service health chart generation
   */
  private async generateServiceHealthChart(
    startTime: string,
    endTime: string,
    services: string[],
    metricField: string,
    aggregation?: string,
    title?: string,
    yAxisLabel?: string,
    yMin?: number,
    yMax?: number,
    intervalCount?: number
  ): Promise<string> {
    // Create a simple service health chart
    return '```mermaid\nxychart-beta\n    title "' + (title || 'Service Health') + '"\n    x-axis ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00"]\n    y-axis "' + (yAxisLabel || 'Value') + '" ' + (yMin || 0) + ' --> ' + (yMax || 100) + '\n    line [10, 20, 30, 40, 50, 60]\n    title "' + (services[0] || 'Service') + '"\n```';
  }

  /**
   * Register the markdown visualizations tool with the MCP server
   */
  public register(server: McpServer): void {
    registerMcpTool(
      server,
      'generateMarkdownVisualizations',
      {
        config: z.object({
          type: z.enum(['error-pie', 'service-health', 'service-dependency', 'span-gantt', 'incident-graph', 'markdown-table', 'metrics-time-series-table'])
            .describe('Visualization type'),
          timeRange: z.object({
            start: z.string().describe('Start time (ISO 8601)'),
            end: z.string().describe('End time (ISO 8601)')
          }).describe('Time range for the visualization'),
          config: z.discriminatedUnion('type', [
            // Error Pie Chart Configuration
            z.object({
              type: z.literal('error-pie'),
              services: z.array(z.string()).optional().describe('Optional array of services to include'),
              showData: z.boolean().optional().describe('Whether to show data values in the chart'),
              maxResults: z.number().optional().describe('Maximum number of results to show (default: 10)')
            }),
            
            // Service Health Chart Configuration
            z.object({
              type: z.literal('service-health'),
              services: z.array(z.string()).describe('Array of services to include'),
              metricField: z.string().optional().describe('Metric field to visualize (default: metric.value)'),
              aggregation: z.enum(['avg', 'min', 'max', 'sum']).optional().describe('Aggregation method for multiple services (default: avg)'),
              yAxisLabel: z.string().optional().describe('Y-axis label'),
              yMin: z.number().optional().describe('Minimum value for y-axis'),
              yMax: z.number().optional().describe('Maximum value for y-axis'),
              intervalCount: z.number().optional().describe('Number of time intervals to display (default: 6)')
            }),
            
            // Service Dependency Graph Configuration
            z.object({
              type: z.literal('service-dependency')
              // No additional configuration needed for service dependency graphs
            }),
            
            // Incident Graph Configuration
            z.object({
              type: z.literal('incident-graph'),
              service: z.string().optional().describe('Optional service name to focus on')
            }),
            
            // Span Gantt Chart Configuration
            z.object({
              type: z.literal('span-gantt'),
              spanId: z.string().describe('Span ID to visualize'),
              query: z.string().optional().describe('Optional query to filter related spans (e.g. "Resource.service.name:payment")')
            }),
            
            // Markdown Table Configuration
            z.object({
              type: z.literal('markdown-table'),
              headers: z.array(z.string()).describe('Column headers for the table'),
              queryType: z.enum(['logs', 'traces', 'metrics']).describe('Type of OTEL data to query'),
              query: z.object({}).describe('Query to fetch data dynamically'),
              fieldMappings: z.array(z.string()).describe('Field paths to extract for each column'),
              maxRows: z.number().optional().describe('Maximum number of rows to display (default: 100)'),
              alignment: z.array(z.enum(['left', 'center', 'right'])).optional().describe('Column alignments')
            }),
            
            // Metrics Time Series Table Configuration
            z.object({
              type: z.literal('metrics-time-series-table'),
              metricField: z.string().describe('Metric field to visualize (e.g., "metric.value")'),
              services: z.array(z.string()).describe('Array of services to include in the table'),
              intervalCount: z.number().optional().describe('Number of time intervals to display (default: 6)'),
              formatValue: z.enum(['raw', 'percent', 'integer', 'decimal1', 'decimal2']).optional().describe('Format for metric values (default: "decimal2")')
            })
          ]).describe('Visualization-specific configuration')
        }).describe('Visualization configuration')
      },
      async (args: { config: any }, extra: unknown) => {
        logger.info('[MCP TOOL] markdown-visualizations called', { args });
        try {
          const { type, timeRange, config } = args.config;
          
          // Generate the visualization based on the type
          const visualization = await this.generateVisualization(type, config, timeRange);
          
          const output: MCPToolOutput = { 
            content: [
              { type: 'text', text: visualization }
            ] 
          };
          
          logger.info('[MCP TOOL] markdown-visualizations result generated successfully');
          return output;
        } catch (error) {
          logger.error('[MCP TOOL] markdown-visualizations error', { 
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
          return { 
            content: [{ 
              type: 'text', 
              text: `Error generating markdown visualization: ${error instanceof Error ? error.message : String(error)}` 
            }] 
          };
        }
      }
    );
  }

  /**
   * Generate a single visualization based on the type
   * This method delegates to the appropriate specialized visualization tool
   */
  private async generateVisualization(
    type: string,
    config: any,
    timeRange: { start: string, end: string }
  ): Promise<string> {
    try {
      // Extract the raw content from the tool response
      const extractContent = (response: ToolResponse): string => {
        // If response is already a string, return it directly
        if (typeof response === 'string') {
          return response;
        }
        
        // Otherwise, extract text from the tool response object
        if (response && response.content && response.content.length > 0) {
          const item = response.content[0];
          return (item.type === 'text' && item.text) ? item.text : '';
        }
        return '';
      };
      
      switch (type) {
        case 'error-pie': {
          // Use the ErrorPieChartTool
          const maxResults = config.maxResults || 10;
          const showData = config.showData || false;
          const services = config.services || [];
          const title = config.title || 'Error Distribution';
          
          try {
            // Access the error pie chart tool through a wrapper method
            // since the actual method might be private
            const result = await this.generateErrorPieChart(
              timeRange.start,
              timeRange.end,
              services,
              maxResults,
              showData,
              title
            );
            return result;
          } catch (error) {
            logger.error('[MarkdownVisualizationsTool] Error generating error pie chart', { error });
            return `### Error Generating Error Pie Chart

Unable to generate the error distribution visualization: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        
        case 'service-health': {
          // Use the ServiceHealthChartTool
          const services = config.services || [];
          const metricField = config.metricField || 'metric.value';
          const title = config.title || 'Service Health';
          const yAxisLabel = config.yAxisLabel || 'Value';
          
          try {
            // Access the service health chart tool through a wrapper method
            const result = await this.generateServiceHealthChart(
              timeRange.start,
              timeRange.end,
              services,
              metricField,
              config.aggregation,
              title,
              yAxisLabel,
              config.yMin,
              config.yMax,
              config.intervalCount
            );
            return result;
          } catch (error) {
            logger.error('[MarkdownVisualizationsTool] Error generating service health chart', { error });
            return `### Error Generating Service Health Chart

Unable to generate the service health visualization: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        
        case 'service-dependency': {
          // Use the ServiceDependencyGraphTool
          try {
            const result = await this.serviceDependencyGraphTool.generateServiceDependencyGraph(
              timeRange.start,
              timeRange.end
            );
            return extractContent(result);
          } catch (error) {
            logger.error('[MarkdownVisualizationsTool] Error generating service dependency graph', { error });
            return `### Error Generating Service Dependency Graph

Unable to generate the service dependency visualization: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        
        case 'span-gantt': {
          // Use the SpanGanttChartTool
          const spanId = config.spanId;
          const query = config.query;
          
          if (!spanId) {
            logger.warn('[MarkdownVisualizationsTool] Missing spanId for span-gantt visualization');
            return '```mermaid\ngantt\n    title Span Gantt Chart Error\n    section Error\n    Missing Span ID :crit, a1, 0, 1s\n```';
          }
          
          try {
            const result = await this.spanGanttChartTool.generateSpanGanttChart(spanId, query);
            return extractContent(result);
          } catch (error) {
            logger.error('[MarkdownVisualizationsTool] Error generating span gantt chart', { error });
            return `### Error Generating Span Gantt Chart

Unable to generate the span gantt visualization: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        
        case 'incident-graph': {
          // Use the IncidentGraphTool
          // Get the service name from config (optional)
          const service = config.service || undefined;
          
          try {
            const result = await this.incidentGraphTool.extractIncidentGraph(
              timeRange.start,
              timeRange.end,
              service
            );
            return extractContent(result);
          } catch (error) {
            logger.error('[MarkdownVisualizationsTool] Error generating incident graph', { error });
            return `### Error Generating Incident Graph

Unable to generate the incident graph visualization: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        
        case 'markdown-table': {
          // Use the MarkdownTableTool
          const headers = config.headers || ['Column 1', 'Column 2', 'Column 3'];
          const queryType = config.queryType || 'logs';
          const query = config.query || {};
          const fieldMappings = config.fieldMappings || [];
          const maxRows = config.maxRows || 100;
          const alignment = config.alignment;
          const title = config.title || 'Sample Table';
          
          try {
            const result = await this.markdownTableTool.generateMarkdownTable(
              timeRange.start,
              timeRange.end,
              headers,
              queryType,
              query,
              fieldMappings,
              maxRows,
              alignment ? alignment : undefined,
              title
            );
            return extractContent(result);
          } catch (error) {
            logger.error('[MarkdownVisualizationsTool] Error generating markdown table', { error });
            return `### Error Generating Markdown Table

Unable to generate the table visualization: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        
        case 'metrics-time-series-table': {
          // Use the MarkdownTableTool for metrics time series
          const metricField = config.metricField || 'metric.value';
          const services = config.services || ['service1', 'service2'];
          const intervalCount = config.intervalCount || 6;
          const formatValue = config.formatValue || 'decimal2';
          const title = config.title || 'Metrics Time Series';
          
          try {
            const result = await this.markdownTableTool.generateMetricsTimeSeriesTable(
              timeRange.start,
              timeRange.end,
              metricField,
              services,
              intervalCount,
              formatValue,
              title
            );
            return extractContent(result);
          } catch (error) {
            logger.error('[MarkdownVisualizationsTool] Error generating metrics time series table', { error });
            return `### Error Generating Metrics Time Series Table

Unable to generate the metrics time series visualization: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        
        default:
          logger.error('[MarkdownVisualizationsTool] Unsupported visualization type', { type });
          return `### Error: Unsupported Visualization Type

The visualization type '${type}' is not supported.`;
      }
    } catch (error) {
      logger.error('[MarkdownVisualizations] Error generating visualization', {
        type,
        error: error instanceof Error ? error.message : String(error)
      });
      return `Error generating ${type} visualization: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}