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
import { FieldDistributionPieChartTool } from './fieldDistributionPieChart.js';

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
  private fieldDistributionPieChartTool: FieldDistributionPieChartTool;

  constructor(esAdapter: ElasticsearchAdapter) {
    this.esAdapter = esAdapter;
    this.errorPieChartTool = new ErrorPieChartTool(esAdapter);
    this.serviceHealthChartTool = new ServiceHealthChartTool(esAdapter);
    this.markdownTableTool = new MarkdownTableTool(esAdapter);
    this.serviceDependencyGraphTool = new ServiceDependencyGraphTool(esAdapter);
    this.spanGanttChartTool = new SpanGanttChartTool(esAdapter);
    this.incidentGraphTool = new IncidentGraphTool(esAdapter);
    this.fieldDistributionPieChartTool = new FieldDistributionPieChartTool(esAdapter);
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
    title: string,
    query?: string
  ): Promise<string> {
    const mermaidChart = await this.errorPieChartTool.generateErrorPieChart(
      startTime,
      endTime,
      services,
      title,
      showData,
      maxResults,
      query
    );
    
    // Return the mermaid chart wrapped in a code block
    return '```mermaid\n' + mermaidChart + '\n```';
  }

  /**
   * Wrapper method for service health chart generation
   */
  private async generateServiceHealthChart(
    startTime: string,
    endTime: string,
    services: string[],
    metricField: string,
    aggregation: 'avg' | 'min' | 'max' | 'sum' = 'avg',
    title?: string,
    yAxisLabel?: string,
    yMin?: number,
    yMax?: number,
    intervalCount?: number,
    query?: string
  ): Promise<string> {
    const mermaidChart = await this.serviceHealthChartTool.generateServiceHealthChart(
      startTime,
      endTime,
      services,
      metricField,
      aggregation,
      title,
      yAxisLabel,
      yMin,
      yMax,
      intervalCount,
      query
    );
    
    // Return the mermaid chart wrapped in a code block
    return '```mermaid\n' + mermaidChart + '\n```';
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
          timeRange: z.object({
            start: z.string().describe('Start time (ISO 8601)'),
            end: z.string().describe('End time (ISO 8601)')
          }).describe('Time range for the visualization'),
          config: z.discriminatedUnion('type', [
            // Field Distribution Pie Chart Configuration
            z.object({
              type: z.literal('field-distribution-pie').describe('Field distribution pie chart - Shows the distribution of values for a specific field'),
              field: z.string().describe('The field to analyze for distribution (e.g., "Resource.service.name", "http.status_code")'),
              dataType: z.enum(['logs', 'traces', 'metrics']).describe('Type of OTEL data to analyze'),
              showData: z.boolean().optional().describe('Whether to show data values in the chart'),
              maxSlices: z.number().optional().describe('Maximum number of slices to show (default: 10)'),
              query: z.string().optional().describe('Optional query to filter the data (e.g. "level:error")')
            }),
            
            // Error Pie Chart Configuration
            z.object({
              type: z.literal('error-pie').describe('Error distribution pie chart - Shows the distribution of errors by service or type'),
              services: z.array(z.string()).optional().describe('Optional array of services to include'),
              showData: z.boolean().optional().describe('Whether to show data values in the chart'),
              maxResults: z.number().optional().describe('Maximum number of results to show (default: 10)'),
              query: z.string().optional().describe('Optional query to filter errors (e.g. "level:error AND message:timeout")')
            }),
            
            // Service Health Chart Configuration
            z.object({
              type: z.literal('service-health').describe('Service health chart - Time series visualization of service health metrics'),
              services: z.array(z.string()).describe('Array of services to include'),
              metricField: z.string().optional().describe('Metric field to visualize (default: metric.value)'),
              aggregation: z.enum(['avg', 'min', 'max', 'sum']).optional().describe('Aggregation method for multiple services (default: avg)'),
              yAxisLabel: z.string().optional().describe('Y-axis label'),
              yMin: z.number().optional().describe('Minimum value for y-axis'),
              yMax: z.number().optional().describe('Maximum value for y-axis'),
              intervalCount: z.number().optional().describe('Number of time intervals to display (default: 6)'),
              query: z.string().optional().describe('Optional query to filter metrics (e.g. "name:http_requests_total")')
            }),
            
            // Service Dependency Graph Configuration
            z.object({
              type: z.literal('service-dependency').describe('Service dependency graph - Visualizes the relationships and call patterns between services'),
              query: z.string().optional().describe('Optional query to filter service dependencies (e.g. "Resource.service.name:payment")')
            }),
            
            // Incident Graph Configuration
            z.object({
              type: z.literal('incident-graph').describe('Incident graph - Visualizes the relationships between services during an incident'),
              service: z.string().optional().describe('Optional service name to focus on'),
              query: z.string().optional().describe('Optional query to filter incidents (e.g. "severity:high")')
            }),
            
            // Span Gantt Chart Configuration
            z.object({
              type: z.literal('span-gantt').describe('Span Gantt chart - Timeline visualization of spans in a distributed trace'),
              spanId: z.string().describe('Span ID to visualize'),
              query: z.string().optional().describe('Optional query to filter related spans (e.g. "Resource.service.name:payment")')
            }),
            
            // Markdown Table Configuration
            z.object({
              type: z.literal('markdown-table').describe('Markdown table - Tabular representation of OTEL data'),
              headers: z.array(z.string()).describe('Column headers for the table'),
              queryType: z.enum(['logs', 'traces', 'metrics']).describe('Type of OTEL data to query'),
              query: z.object({}).describe('Query to fetch data dynamically'),
              fieldMappings: z.array(z.string()).describe('Field paths to extract for each column'),
              maxRows: z.number().optional().describe('Maximum number of rows to display (default: 100)'),
              alignment: z.array(z.enum(['left', 'center', 'right'])).optional().describe('Column alignments'),
              queryString: z.string().optional().describe('Optional query string to further filter the data')
            }),
            
            // Metrics Time Series Table Configuration
            z.object({
              type: z.literal('metrics-time-series-table').describe('Metrics time series table - Tabular representation of metrics over time intervals'),
              metricField: z.string().describe('Metric field to visualize (e.g., "metric.value")'),
              services: z.array(z.string()).describe('Array of services to include in the table'),
              intervalCount: z.number().optional().describe('Number of time intervals to display (default: 6)'),
              formatValue: z.enum(['raw', 'percent', 'integer', 'decimal1', 'decimal2']).optional().describe('Format for metric values (default: "decimal2")'),
              query: z.string().optional().describe('Optional query to filter metrics (e.g. "name:http_requests_total")')
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
        case 'field-distribution-pie': {
          // Use the FieldDistributionPieChartTool
          const field = config.field || 'Resource.service.name';
          const dataType = config.dataType || 'logs';
          const maxSlices = config.maxSlices || 10;
          const showData = config.showData || false;
          const title = config.title || `Distribution of ${field}`;
          const query = config.query;
          
          try {
            const result = await this.fieldDistributionPieChartTool.generateFieldDistributionPieChart(
              timeRange.start,
              timeRange.end,
              field,
              dataType,
              query,
              title,
              showData,
              maxSlices
            );
            return '```mermaid\n' + result + '\n```';
          } catch (error) {
            logger.error('[MarkdownVisualizationsTool] Error generating field distribution pie chart', { error });
            return `### Error Generating Field Distribution Pie Chart\n\nUnable to generate the field distribution visualization: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        
        case 'error-pie': {
          // Use the ErrorPieChartTool
          const maxResults = config.maxResults || 10;
          const showData = config.showData || false;
          const services = config.services || [];
          const title = config.title || 'Error Distribution';
          const query = config.query;
          
          try {
            // Access the error pie chart tool through a wrapper method
            const result = await this.generateErrorPieChart(
              timeRange.start,
              timeRange.end,
              services,
              maxResults,
              showData,
              title,
              query
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
          const query = config.query;
          
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
              config.intervalCount,
              query
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
          const query = config.query;
          
          try {
            const result = await this.serviceDependencyGraphTool.generateServiceDependencyGraph(
              timeRange.start,
              timeRange.end,
              query
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
          const query = config.query;
          
          try {
            const result = await this.incidentGraphTool.extractIncidentGraph(
              timeRange.start,
              timeRange.end,
              service,
              query
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
          const query = config.query;
          
          try {
            const result = await this.markdownTableTool.generateMetricsTimeSeriesTable(
              timeRange.start,
              timeRange.end,
              metricField,
              services,
              intervalCount,
              formatValue,
              title,
              query
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