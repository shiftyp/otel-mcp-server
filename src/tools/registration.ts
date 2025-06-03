import { globalToolRegistry } from './base/registry.js';
import { BaseSearchAdapter } from '../adapters/base/searchAdapter.js';
import { logger } from '../utils/logger.js';
import { BaseTool as NewBaseTool, ToolCategory } from './base/tool.js';

// Import all tool categories
import * as QueryTools from './query/index.js';
import * as DiscoveryTools from './discovery/index.js';
import * as AnalysisTools from './analysis/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Register all tools with the global registry
 */
export function registerAllToolClasses(): void {
  logger.info('Registering tool classes');

  // Register query tools
  globalToolRegistry.register(QueryTools.TracesQueryTool);
  globalToolRegistry.register(QueryTools.LogsQueryTool);
  globalToolRegistry.register(QueryTools.MetricsQueryTool);

  // Register discovery tools
  globalToolRegistry.register(DiscoveryTools.TraceFieldsGetTool);
  globalToolRegistry.register(DiscoveryTools.LogFieldsGetTool);
  globalToolRegistry.register(DiscoveryTools.ServicesGetTool);

  // Register analysis tools
  globalToolRegistry.register(AnalysisTools.LogAnomaliesDetectTool);
  globalToolRegistry.register(AnalysisTools.MetricAnomaliesDetectTool);
  globalToolRegistry.register(AnalysisTools.TraceAnomalyClassifierTool);
  globalToolRegistry.register(AnalysisTools.SystemHealthSummaryTool);
  globalToolRegistry.register(AnalysisTools.IncidentAnalysisTool);
  globalToolRegistry.register(AnalysisTools.ServiceBehaviorProfileTool);
  globalToolRegistry.register(AnalysisTools.PerformanceRegressionDetectorTool);
  globalToolRegistry.register(AnalysisTools.ErrorPropagationAnalyzerTool);
  globalToolRegistry.register(AnalysisTools.CriticalPathAnalysisTool);
  globalToolRegistry.register(AnalysisTools.CanaryAnalysisTool);
  globalToolRegistry.register(AnalysisTools.RetryStormDetectionTool);
  globalToolRegistry.register(AnalysisTools.DataPipelineHealthTool);
  globalToolRegistry.register(AnalysisTools.DependencyHealthMonitorTool);
  globalToolRegistry.register(AnalysisTools.PredictiveFailureAnalysisTool);
  globalToolRegistry.register(AnalysisTools.CostAnalysisByTraceTool);
  globalToolRegistry.register(AnalysisTools.SloComplianceMonitorTool);

  // Register ML tools (will only be available if backend supports them)
  globalToolRegistry.register(AnalysisTools.SemanticLogSearchTool);
  globalToolRegistry.register(AnalysisTools.TraceClusteringTool);
  globalToolRegistry.register(AnalysisTools.ForecastMetricsTool);

  const toolsByCategory = globalToolRegistry.getToolsByCategories();
  logger.info('Tool registration complete', {
    query: toolsByCategory.query.length,
    discovery: toolsByCategory.discovery.length,
    analysis: toolsByCategory.analysis.length,
    utility: toolsByCategory.utility.length
  });
}

/**
 * Register tools with MCP server
 */
export async function registerToolsWithMCPServer(server: McpServer, adapter: BaseSearchAdapter): Promise<void> {
  // Register tool classes if not already done
  if (globalToolRegistry.getAllToolNames().length === 0) {
    registerAllToolClasses();
  }

  // Create tool instances for this adapter
  const tools = globalToolRegistry.createTools(adapter);

  logger.info(`Registering ${tools.size} tools with MCP server for ${adapter.getType()}`);

  // Register each tool with the MCP server
  for (const [name, tool] of tools) {
    tool.getMetadata(); // Verify metadata is available
    const inputSchema = tool.getParameterSchema();

    // Register with MCP server
    server.tool(name,
      inputSchema,
      async (args: any) => {
        return await tool.execute(args);
      }
    );
  }

  // Also register the tool list tool
  server.tool('listTools',
    {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['query', 'discovery', 'analysis', 'utility', 'all'],
          description: 'Filter tools by category'
        }
      }
    },
    async (args: any) => {
      const toolsByCategory = globalToolRegistry.getToolsByCategories();

      if (args.category && args.category !== 'all') {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              category: args.category,
              tools: toolsByCategory[args.category as ToolCategory] || []
            }, null, 2)
          }]
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(toolsByCategory, null, 2)
        }]
      };
    }
  );
}