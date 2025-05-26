import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { ElasticGuards } from '../../utils/elasticGuards.js';
import { logger } from '../../utils/logger.js';
import { registerMcpTool } from '../../utils/registerTool.js';
import type { MCPToolOutput } from '../../types.js';

/**
 * Register common tools that work across different telemetry types
 * @param server The MCP server instance
 * @param esAdapter The Elasticsearch adapter instance
 */
export function registerCommonTools(server: McpServer, esAdapter: ElasticsearchAdapter) {
  // Services discovery tool
  registerMcpTool(
    server,
    'servicesGet',
    { search: z.string().optional().describe('Filter services by name pattern. Pass an empty string to get all services') },
    async (args: { search?: string } = {}) => {
      if (!args || typeof args !== 'object') args = {};
      logger.info('[MCP TOOL] servicesGet called', { args });
      
      try {
        // Track which telemetry types are available
        const availableTelemetry = {
          traces: false,
          metrics: false,
          logs: false
        };
        
        // Check trace availability
        try {
          await ElasticGuards.checkTracesAvailability(esAdapter);
          availableTelemetry.traces = true;
        } catch (error) {
          logger.warn('[MCP TOOL] servicesGet: Trace data not available', { 
            error: error instanceof Error ? error.message : String(error)
          });
        }
        
        // Check metrics availability
        try {
          await ElasticGuards.checkMetricsAvailability(esAdapter);
          availableTelemetry.metrics = true;
        } catch (error) {
          logger.warn('[MCP TOOL] servicesGet: Metric data not available', { 
            error: error instanceof Error ? error.message : String(error)
          });
        }
        
        // Check logs availability
        try {
          await ElasticGuards.checkLogsAvailability(esAdapter);
          availableTelemetry.logs = true;
        } catch (error) {
          logger.warn('[MCP TOOL] servicesGet: Log data not available', { 
            error: error instanceof Error ? error.message : String(error)
          });
        }
        
        // If no telemetry types are available, return an error
        if (!availableTelemetry.traces && !availableTelemetry.metrics && !availableTelemetry.logs) {
          throw new Error('No telemetry data available in Elasticsearch. Please ensure traces, metrics, or logs are being ingested properly.');
        }
        
        // Get services from all available telemetry types using the public getServices method
        // The getServices method already collates and dedupes services from all telemetry types
        // But we'll only call it if at least one telemetry type is available
        const services = await esAdapter.getServices(args.search);
        
        // Convert to map for easier manipulation
        const servicesMap = new Map<string, Set<string>>();
        
        services.forEach((service: {name: string, versions: string[]}) => {
          if (!servicesMap.has(service.name)) {
            servicesMap.set(service.name, new Set<string>());
          }
          const versionSet = servicesMap.get(service.name)!;
          service.versions.forEach((version: string) => versionSet.add(version));
        });
        
        logger.info('[MCP TOOL] servicesGet: Retrieved services', { 
          count: services.length,
          telemetryUsed: availableTelemetry
        });
        
        // Convert map back to array format
        const combinedServices = Array.from(servicesMap.entries()).map(([name, versions]) => ({
          name,
          versions: Array.from(versions)
        }));
        
        // Sort services by name
        const sortedServices = combinedServices.sort((a, b) => a.name.localeCompare(b.name));
        
        // Add metadata about which telemetry types were used
        const result = {
          services: sortedServices,
          telemetryUsed: availableTelemetry
        };
        
        const output: MCPToolOutput = { 
          content: [{ 
            type: 'text', 
            text: JSON.stringify(result, null, 2) 
          }] 
        };
        
        logger.info('[MCP TOOL] servicesGet result', { 
          args, 
          serviceCount: sortedServices.length,
          telemetryUsed: availableTelemetry
        });
        
        return output;
      } catch (error) {
        logger.error('[MCP TOOL] servicesGet error', { 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
        
        // Return structured error response using ElasticGuards utility
        return ElasticGuards.formatErrorResponse(error, {
          search: args.search
        });
      }
    }
  );
}
