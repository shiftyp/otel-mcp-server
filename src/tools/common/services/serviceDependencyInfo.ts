import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../../adapters/elasticsearch/index.js';
import { ElasticGuards } from '../../../utils/guards/index.js';
import { logger } from '../../../utils/logger.js';
import { registerMcpTool } from '../../../utils/registerTool.js';
import type { MCPToolOutput } from '../../../types.js';

/**
 * Register the serviceDependencyInfo tool
 * @param server The MCP server instance
 * @param esAdapter The Elasticsearch adapter instance
 */
export function registerServiceDependencyInfoTool(server: McpServer, esAdapter: ElasticsearchAdapter): void {
  registerMcpTool(
    server,
    'serviceDependencyInfo',
    {
      startTime: z.string().optional().describe('Start time for the time range in ISO format (e.g., "2023-01-01T00:00:00Z")'),
      endTime: z.string().optional().describe('End time for the time range in ISO format (e.g., "2023-01-02T00:00:00Z")'),
      sampleRate: z.number().min(0.01).max(1.0).optional().describe('Fraction of spans to sample (0.01 to 1.0, default 1.0)'),
    },
    async (args: {
      startTime?: string,
      endTime?: string,
      sampleRate?: number
    } = {}): Promise<MCPToolOutput> => {
      if (!args || typeof args !== 'object') args = {};
      logger.info('[MCP TOOL] serviceDependencyInfo called', { args });

      try {
        // Ensure trace data is available
        await ElasticGuards.checkTracesAvailability(esAdapter);

        // Use a wider time range if not specified
        const startTime = args.startTime || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 24 hours ago if not specified
        const endTime = args.endTime || new Date().toISOString(); // now if not specified
        const sampleRate = args.sampleRate ?? 1.0;

        // Get the service dependency graph with span counts
        const dependencyData = await esAdapter.serviceDependencyGraph(startTime, endTime, sampleRate);
        const { relationships, spanCounts } = dependencyData;

        // Calculate time range in milliseconds for rate calculations
        const timeRangeMs = new Date(endTime).getTime() - new Date(startTime).getTime();
        const minutesInRange = timeRangeMs / (1000 * 60);

        // Calculate total calls and errors across all services
        const totalCalls = relationships.reduce((sum: number, rel: { count: number }) => sum + rel.count, 0);
        const totalErrors = relationships.reduce((sum: number, rel: { errorCount?: number }) => sum + (rel.errorCount || 0), 0);
        const totalErrorRate = totalCalls > 0 ? totalErrors / totalCalls : 0;
        const totalErrorRatePercentage = (totalErrorRate * 100).toFixed(2);

        // Extract unique service names
        const serviceNames = new Set(relationships.flatMap((rel: { parent: string, child: string }) => [rel.parent, rel.child]));

        // Return the dependency information
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              timeRange: {
                start: startTime,
                end: endTime,
                durationMinutes: Math.round(minutesInRange),
                durationHours: Math.round(minutesInRange / 60)
              },
              services: {
                count: serviceNames.size,
                names: Array.from(serviceNames)
              },
              relationships: {
                count: relationships.length,
                details: relationships
              },
              metrics: {
                totalCalls,
                totalErrors,
                errorRate: totalErrorRate,
                errorRatePercentage: totalErrorRatePercentage,
                callsPerMinute: Math.round((totalCalls / minutesInRange) * 100) / 100
              },
              spanCounts: spanCounts
            })
          }]
        }

      } catch (error: unknown) {
        logger.error('[MCP TOOL] Error in serviceDependencyInfo', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });

        return {
          isError: true,
          content: [{
            type: "text",
            text: JSON.stringify({
              error: {
                message: error instanceof Error ? error.message : String(error),
                type: error instanceof Error ? error.constructor.name : 'Unknown'
              },
              timeRange: {
                start: args.startTime || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
                end: args.endTime || new Date().toISOString()
              }
            })
          }]
        };
      }
    }
  );
}
