import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { ErrorPieChartTool } from './errorPieChart.js';
import { ServiceHealthChartTool } from './serviceHealthChart.js';
import { MarkdownTableTool } from './markdownTable.js';
import { registerMcpTool } from '../../utils/registerTool.js';

// Define panel types
type PanelType = 'error-pie' | 'service-health' | 'service-dependency' | 'span-gantt' | 'markdown-table' | 'metrics-time-series-table';

// Define panel configuration
interface DashboardPanel {
  id: string;
  title: string;
  type: PanelType;
  config?: any;
}

// Define dashboard configuration
interface DashboardConfig {
  title: string;
  description?: string;
  timeRange: {
    start: string;
    end: string;
  };
  panels: DashboardPanel[];
}

/**
 * Tool for generating markdown dashboards with multiple visualizations
 */
export class MarkdownDashboardTool {
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
    timeseries: Array<{timestamp: string, value: number}>,
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
  private esAdapter: ElasticsearchAdapter;
  private errorPieChartTool: ErrorPieChartTool;
  private serviceHealthChartTool: ServiceHealthChartTool;
  private markdownTableTool: MarkdownTableTool;

  constructor(esAdapter: ElasticsearchAdapter) {
    this.esAdapter = esAdapter;
    this.errorPieChartTool = new ErrorPieChartTool(esAdapter);
    this.serviceHealthChartTool = new ServiceHealthChartTool(esAdapter);
    this.markdownTableTool = new MarkdownTableTool(esAdapter);
  }

  /**
   * Register the markdown dashboard tool with the MCP server
   */
  public register(server: McpServer): void {
    // Register individual visualization tools
    this.errorPieChartTool.register(server);
    this.serviceHealthChartTool.register(server);
    this.markdownTableTool.register(server);

    // Register the dashboard tool
    registerMcpTool(
      server,
      'generateMarkdownDashboard',
      {
        config: z.object({
          title: z.string().describe('Dashboard title'),
          description: z.string().optional().describe('Dashboard description'),
          timeRange: z.object({
            start: z.string().describe('Start time (ISO 8601)'),
            end: z.string().describe('End time (ISO 8601)')
          }).describe('Time range for the dashboard'),
          panels: z.array(
            z.discriminatedUnion('type', [
              // Error Pie Chart Panel
              z.object({
                id: z.string().describe('Panel ID'),
                title: z.string().describe('Panel title'),
                type: z.literal('error-pie').describe('Panel type'),
                config: z.object({
                  services: z.array(z.string()).optional().describe('Optional array of services to include'),
                  showData: z.boolean().optional().describe('Whether to show data values in the chart'),
                  maxResults: z.number().optional().describe('Maximum number of results to show (default: 10)')
                }).describe('Error pie chart configuration')
              }),
              
              // Service Health Chart Panel
              z.object({
                id: z.string().describe('Panel ID'),
                title: z.string().describe('Panel title'),
                type: z.literal('service-health').describe('Panel type'),
                config: z.object({
                  services: z.array(z.string()).describe('Array of services to include'),
                  metricField: z.string().optional().describe('Metric field to visualize (default: metric.value)'),
                  aggregation: z.enum(['avg', 'min', 'max', 'sum']).optional().describe('Aggregation method for multiple services (default: avg)'),
                  yAxisLabel: z.string().optional().describe('Y-axis label'),
                  yMin: z.number().optional().describe('Minimum value for y-axis'),
                  yMax: z.number().optional().describe('Maximum value for y-axis'),
                  intervalCount: z.number().optional().describe('Number of time intervals to display (default: 6)')
                }).describe('Service health chart configuration')
              }),
              
              // Service Dependency Graph Panel
              z.object({
                id: z.string().describe('Panel ID'),
                title: z.string().describe('Panel title'),
                type: z.literal('service-dependency').describe('Panel type'),
                config: z.object({}).describe('Service dependency graph configuration')
              }),
              
              // Span Gantt Chart Panel
              z.object({
                id: z.string().describe('Panel ID'),
                title: z.string().describe('Panel title'),
                type: z.literal('span-gantt').describe('Panel type'),
                config: z.object({
                  spanId: z.string().describe('Span ID to visualize'),
                  query: z.string().optional().describe('Optional query to filter related spans (e.g. "Resource.service.name:payment")')
                }).describe('Span gantt chart configuration')
              }),
              
              // Markdown Table Panel
              z.object({
                id: z.string().describe('Panel ID'),
                title: z.string().describe('Panel title'),
                type: z.literal('markdown-table').describe('Panel type'),
                config: z.object({
                  headers: z.array(z.string()).describe('Column headers for the table'),
                  queryType: z.enum(['logs', 'traces', 'metrics']).describe('Type of OTEL data to query'),
                  query: z.object({}).describe('Query to fetch data dynamically'),
                  fieldMappings: z.array(z.string()).describe('Field paths to extract for each column'),
                  maxRows: z.number().optional().describe('Maximum number of rows to display (default: 100)'),
                  alignment: z.array(z.enum(['left', 'center', 'right'])).optional().describe('Column alignments')
                }).describe('Markdown table configuration')
              }),
              
              // Metrics Time Series Table Panel
              z.object({
                id: z.string().describe('Panel ID'),
                title: z.string().describe('Panel title'),
                type: z.literal('metrics-time-series-table').describe('Panel type'),
                config: z.object({
                  metricField: z.string().describe('Metric field to visualize (e.g., "metric.value")'),
                  services: z.array(z.string()).describe('Array of services to include in the table'),
                  intervalCount: z.number().optional().describe('Number of time intervals to display (default: 6)'),
                  formatValue: z.enum(['raw', 'percent', 'integer', 'decimal1', 'decimal2']).optional().describe('Format for metric values (default: "decimal2")')
                }).describe('Metrics time series table configuration')
              })
            ])
          ).describe('Dashboard panels')
        }).describe('Dashboard configuration')
      },
      async (args: {
        config: {
          title: string;
          description?: string;
          timeRange: {
            start: string;
            end: string;
          };
          panels: {
            id: string;
            title: string;
            type: PanelType;
            width: 'full' | 'half' | 'third';
            height: 'small' | 'medium' | 'large';
            config?: any;
          }[];
          refreshInterval?: number;
        }
      }, extra: unknown) => {
        logger.info('[MCP TOOL] markdown-dashboard called', { args });
        try {
          const dashboard = await this.generateMarkdownDashboard(args.config);
          
          const output: MCPToolOutput = { 
            content: [
              { type: 'text', text: dashboard }
            ] 
          };
          
          logger.info('[MCP TOOL] markdown-dashboard result generated successfully');
          return output;
        } catch (error) {
          logger.error('[MCP TOOL] markdown-dashboard error', { 
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
          return { 
            content: [{ 
              type: 'text', 
              text: `Error generating markdown dashboard: ${error instanceof Error ? error.message : String(error)}` 
            }] 
          };
        }
      }
    );
  }

  /**
   * Generate a markdown dashboard with multiple visualizations
   */
  private async generateMarkdownDashboard(config: DashboardConfig): Promise<string> {
    // Start building the markdown
    let markdown = `# ${config.title}\n\n`;
    
    if (config.description) {
      markdown += `${config.description}\n\n`;
    }
    
    markdown += `*Time Range: ${new Date(config.timeRange.start).toLocaleString()} to ${new Date(config.timeRange.end).toLocaleString()}*\n\n`;
    
    // Generate each panel in a simple top-down layout
    for (const panel of config.panels) {
      markdown += `## ${panel.title}\n\n`;
      
      // Generate the specific panel content based on type
      const panelContent = await this.generatePanelContent(panel, config.timeRange);
      markdown += panelContent;
      
      markdown += '\n\n---\n\n';
    }
    
    // Remove the last separator
    markdown = markdown.replace(/---\n\n$/, '');
    
    return markdown;
  }

  /**
   * Generate content for a specific panel
   */
  private async generatePanelContent(
    panel: DashboardPanel, 
    timeRange: {start: string, end: string}
  ): Promise<string> {
    try {
      switch (panel.type) {
        case 'error-pie':
          return this.generateErrorPieChart(panel.config, timeRange);
        case 'service-health':
          return this.generateServiceHealthChart(panel.config, timeRange);
        case 'service-dependency':
          return this.generateServiceDependencyGraph(panel.config, timeRange);
        case 'span-gantt':
          return this.generateSpanGanttChart(panel.config);
        case 'markdown-table':
          return this.markdownTableTool.generateMarkdownTable(
            timeRange.start,
            timeRange.end,
            panel.config.headers,
            panel.config.queryType,
            panel.config.query,
            panel.config.fieldMappings,
            panel.config.maxRows,
            panel.config.alignment,
            panel.title
          );
        case 'metrics-time-series-table':
          return this.markdownTableTool.generateMetricsTimeSeriesTable(
            timeRange.start,
            timeRange.end,
            panel.config.metricField,
            panel.config.services,
            panel.config.intervalCount,
            panel.config.formatValue,
            panel.title
          );
        default:
          return `Unsupported panel type: ${panel.type}`;
      }
    } catch (error) {
      logger.error('[MarkdownDashboard] Error generating panel content', {
        panelType: panel.type,
        error: error instanceof Error ? error.message : String(error)
      });
      return `Error generating panel: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Generate error pie chart
   */
  private async generateErrorPieChart(
    config: any, 
    timeRange: {start: string, end: string}
  ): Promise<string> {
    // Get top errors from the logs adapter
    const errors = await this.esAdapter.topErrors(
      timeRange.start,
      timeRange.end,
      config.maxResults || 10,
      config.services
    );

    if (!errors || errors.length === 0) {
      return '```mermaid\npie title No Errors Found\n    "No Errors" : 1\n```';
    }

    // Group errors by service
    const serviceErrors = new Map<string, number>();
    
    for (const error of errors) {
      // Cast to any to access properties that TypeScript doesn't know about
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
    mermaidLines.push(config.showData ? 'pie showData' : 'pie');
    
    // Add title
    const chartTitle = config.title || 'Error Distribution by Service';
    mermaidLines.push(`    title ${chartTitle}`);
    
    // Add data points
    for (const [service, count] of sortedServices) {
      mermaidLines.push(`    "${service}" : ${count}`);
    }
    
    return '```mermaid\n' + mermaidLines.join('\n') + '\n```';
  }

  /**
   * Generate service health chart
   */
  private async generateServiceHealthChart(
    config: any, 
    timeRange: {start: string, end: string}
  ): Promise<string> {
    // Generate time intervals for the x-axis
    const intervalCount = config.intervalCount || 6;
    const intervals = this.generateTimeIntervals(timeRange.start, timeRange.end, intervalCount);
    
    // Query metrics data for each service
    const servicesData = await Promise.all(
      (config.services || []).map(async (service: string) => {
        try {
          // Use the aggregateOtelMetricsRange method to get metrics for this service
          const metricsResults = await this.esAdapter.aggregateOtelMetricsRange(
            timeRange.start,
            timeRange.end,
            config.metricField,
            service
          );
          
          // Parse the JSON strings returned by the adapter
          const parsedResults = metricsResults.map(result => JSON.parse(result));
          
          // If we have results, use the first one (assuming it's the most relevant)
          if (parsedResults.length > 0) {
            const metrics = parsedResults[0];
            
            // Extract the timeseries data
            const timeseries = metrics.timeseries || [];
            
            // Interpolate values for our specific intervals
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
          logger.error('[MarkdownDashboard] Error getting metrics for service', { 
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
    
    // Build the Mermaid chart
    const mermaidLines = ['xychart-beta'];
    
    // Add title
    const chartTitle = config.title || 'Service Metrics';
    mermaidLines.push(`    title "${chartTitle}"`);
    
    // Format x-axis with time intervals
    const xAxisLabels = intervals.map(interval => 
      new Date(interval).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
    );
    mermaidLines.push(`    x-axis [${xAxisLabels.map(l => `"${l}"`).join(', ')}]`);
    
    // Format y-axis
    const yAxisText = config.yAxisLabel || 'Value';
    const yMinValue = config.yMin !== undefined ? config.yMin : 0;
    const yMaxValue = config.yMax !== undefined ? config.yMax : 'auto';
    mermaidLines.push(`    y-axis "${yAxisText}" ${yMinValue} --> ${yMaxValue}`);
    
    // Add each service as a line
    servicesData.forEach(({ service, metrics }) => {
      const dataPoints = metrics.map((m: {value?: number}) => m.value || 0).join(', ');
      mermaidLines.push(`    line [${dataPoints}]`);
      mermaidLines.push(`    title "${service}"`);
    });
    
    return '```mermaid\n' + mermaidLines.join('\n') + '\n```';
  }

  /**
   * Generate service dependency graph
   */
  private async generateServiceDependencyGraph(
    config: any, 
    timeRange: {start: string, end: string}
  ): Promise<string> {
    const edges = await this.esAdapter.serviceDependencyGraph(
      timeRange.start, 
      timeRange.end
    );
    
    if (!edges || edges.length === 0) {
      return '```mermaid\ngraph TD\n  A[No Dependencies Found]\n```';
    }
    
    // Build mermaid syntax for the service map
    const mermaidLines = ["graph TD"];
    
    // Create a map of service names to simple IDs
    const serviceIds = new Map<string, string>();
    const serviceHasError = new Map<string, boolean>();
    
    // First pass: collect all unique services and assign simple IDs
    const allServices = new Set<string>();
    for (const edge of edges) {
      allServices.add(edge.parent);
      allServices.add(edge.child);
      
      // Track services with errors
      if (edge.errorRate && edge.errorRate > 0) {
        serviceHasError.set(edge.parent, true);
        serviceHasError.set(edge.child, true);
      }
    }
    
    // Assign simple sequential IDs to services
    Array.from(allServices).forEach((service, index) => {
      // Create a simple sequential ID
      const simpleId = `service${index + 1}`;
      serviceIds.set(service, simpleId);
    });
    
    // Second pass: add node definitions with descriptive labels
    for (const service of allServices) {
      const id = serviceIds.get(service) || `service${serviceIds.size + 1}`;
      mermaidLines.push(`  ${id}["${service}"]`);
    }
    
    // Third pass: add edges between services
    for (const edge of edges) {
      const fromId = serviceIds.get(edge.parent) || 'unknown';
      const toId = serviceIds.get(edge.child) || 'unknown';
      
      // Build the edge label
      let label = '';
      const countLabel = typeof edge.count === 'number' ? `${edge.count}` : '';
      let errorLabel = '';
      
      if (typeof edge.count === 'number' && edge.count > 0) {
        const errorPct = Math.round((edge.errorRate || 0) * 100);
        
        if (edge.errorRate && edge.errorRate > 0) {
          errorLabel = ` (${errorPct}% err)`;
        }
      }
      
      if (countLabel || errorLabel) {
        label = `|${countLabel}${errorLabel}|`;
      }
      
      // Add the edge
      mermaidLines.push(`  ${fromId} -->${label} ${toId}`);
    }
    
    // Add styling for services with errors
    mermaidLines.push('  classDef error fill:#f96,stroke:#333,stroke-width:2');
    
    // Apply error styling to services with errors
    const errorServices = Array.from(serviceHasError.entries())
      .filter(([_, hasError]) => hasError)
      .map(([service, _]) => serviceIds.get(service))
      .filter(id => id) // Filter out undefined IDs
      .join(',');
    
    if (errorServices) {
      mermaidLines.push(`  class ${errorServices} error`);
    }
    
    return '```mermaid\n' + mermaidLines.join('\n') + '\n```';
  }

  /**
   * Generate span Gantt chart
   */
  private async generateSpanGanttChart(config: any): Promise<string> {
    if (!config.spanId) {
      return '```mermaid\ngantt\n  title No Span ID Provided\n  dateFormat X\n  section Error\n  No Span ID :0, 0\n```';
    }
    
    try {
      // Get the target span
      const span = await this.esAdapter.spanLookup(config.spanId);
      if (!span) {
        return '```mermaid\ngantt\n  title Span Not Found\n  dateFormat X\n  section Error\n  Span Not Found :0, 0\n```';
      }
      
      // Get the trace ID for this span
      const traceId = span.TraceId;
      if (!traceId) {
        return '```mermaid\ngantt\n  title No Trace ID\n  dateFormat X\n  section Error\n  No Trace ID :0, 0\n```';
      }
      
      // Get all spans in this trace
      const query: any = {
        size: 1000,
        query: {
          bool: {
            must: [
              { term: { 'TraceId.keyword': traceId } }
            ]
          }
        },
        sort: [
          { 'Resource.service.name.keyword': { order: 'asc' } },
          { 'Name.keyword': { order: 'asc' } }
        ]
      };
      
      // Add additional query if provided
      if (config.query && config.query.trim() !== '') {
        query.query.bool.must.push({
          query_string: {
            query: config.query
          }
        });
      }
      
      // Execute the query
      const response = await this.esAdapter.queryTraces(query);
      
      // Extract the spans
      const allSpans = response.hits?.hits?.map((hit: any) => hit._source) || [];
      
      if (!allSpans || allSpans.length === 0) {
        return '```mermaid\ngantt\n  title No Spans Found\n  dateFormat X\n  section Error\n  No Spans Found :0, 0\n```';
      }
      
      // Start building the Mermaid Gantt chart
      const mermaidLines = ['gantt'];
      mermaidLines.push('  dateFormat X');  // Use Unix timestamp format
      mermaidLines.push('  axisFormat %s');  // Show seconds on axis
      mermaidLines.push(`  title Trace Timeline: ${traceId.substring(0, 8)}`);
      
      // Find the earliest start time to use as reference
      let earliestTime = Number.MAX_SAFE_INTEGER;
      for (const span of allSpans) {
        if (span.StartTimeUnixNano && typeof span.StartTimeUnixNano === 'number' && !isNaN(span.StartTimeUnixNano)) {
          if (span.StartTimeUnixNano < earliestTime) {
            earliestTime = span.StartTimeUnixNano;
          }
        }
      }
      
      // If we couldn't find a valid earliest time, default to 0
      if (earliestTime === Number.MAX_SAFE_INTEGER) {
        earliestTime = 0;
      }
      
      // Group spans by service
      const serviceSpans = new Map<string, any[]>();
      for (const span of allSpans) {
        const service = this.getServiceName(span);
        if (!serviceSpans.has(service)) {
          serviceSpans.set(service, []);
        }
        const spans = serviceSpans.get(service) || [];
        spans.push(span);
        serviceSpans.set(service, spans);
      }
      
      // Add spans grouped by service
      for (const [service, spans] of serviceSpans.entries()) {
        mermaidLines.push(`  section ${service}`);
        
        for (const span of spans) {
          const name = span.Name || 'unnamed';
          
          // Calculate relative times in seconds
          let startTime = 0;
          let duration = 0.1; // Default 100ms duration
          
          if (span.StartTimeUnixNano && typeof span.StartTimeUnixNano === 'number' && !isNaN(span.StartTimeUnixNano)) {
            startTime = (span.StartTimeUnixNano - earliestTime) / 1_000_000_000; // to seconds
          }
          
          if (span.EndTimeUnixNano && typeof span.EndTimeUnixNano === 'number' && !isNaN(span.EndTimeUnixNano)) {
            const endTime = (span.EndTimeUnixNano - earliestTime) / 1_000_000_000;
            if (endTime > startTime) {
              duration = endTime - startTime;
            }
          }
          
          // Format the span entry
          const spanId = span.SpanId ? span.SpanId.substring(0, 6) : '';
          mermaidLines.push(`  ${name} (${spanId}) :${startTime}, ${duration}s`);
        }
      }
      
      return '```mermaid\n' + mermaidLines.join('\n') + '\n```';
    } catch (error) {
      logger.error('[MarkdownDashboard] Error generating span Gantt chart', {
        spanId: config.spanId,
        error: error instanceof Error ? error.message : String(error)
      });
      
      return '```mermaid\ngantt\n  title Error Generating Chart\n  dateFormat X\n  section Error\n  Error :0, 0\n```';
    }
  }
  
  /**
   * Get service name from a span
   */
  private getServiceName(span: any): string {
    return span.Resource?.service?.name || 
           span.resource?.service?.name || 
           span.service?.name || 
           'unknown';
  }


}
