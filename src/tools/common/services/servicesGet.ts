import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../../adapters/elasticsearch/index.js';
import { createErrorResponse, ErrorResponse, isErrorResponse } from '../../../utils/errorHandling.js';
import { ElasticGuards } from '../../../utils/guards/index.js';
import { logger } from '../../../utils/logger.js';
import { registerMcpTool } from '../../../utils/registerTool.js';
import type { MCPToolOutput } from '../../../types.js';

/**
 * Register the servicesGet tool
 * @param server The MCP server instance
 * @param esAdapter The Elasticsearch adapter instance
 */
export function registerServicesGetTool(server: McpServer, esAdapter: ElasticsearchAdapter): void {
  registerMcpTool(
    server,
    'servicesGet',
    { 
      search: z.string().optional().describe('Filter services by name pattern. Supports wildcards (e.g., "front*", "*end"). Pass an empty string to get all services'),
      version: z.string().optional().describe('Filter services by version. Supports wildcards (e.g., "2.0.*", "v*"). Only returns services with matching versions'),
      startTime: z.string().optional().describe('Start time for the time range in ISO format (e.g., "2023-01-01T00:00:00Z")'),
      endTime: z.string().optional().describe('End time for the time range in ISO format (e.g., "2023-01-02T00:00:00Z")')
    },
    async (args: { search?: string, version?: string, startTime?: string, endTime?: string } = {}): Promise<MCPToolOutput> => {
      if (!args || typeof args !== 'object') args = {};
      logger.info('[MCP TOOL] servicesGet called', { args });
      
      try {
        // Track which telemetry types are available
        const availableTelemetry = {
          traces: false,
          metrics: false,
          logs: false
        };
        
        // Store the original search parameter
        const originalSearch = args.search;
        
        // First get all services without filtering to build the complete service map
        const tempArgs = { ...args };
        delete tempArgs.search; // Remove search filter temporarily
        
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
        
        // Get ALL services first without filtering
        const allServicesResult = await esAdapter.getServices(undefined, args.startTime, args.endTime);
        
        // Check if we got an error response
        if (isErrorResponse(allServicesResult)) {
          return {
            content: [{
              type: 'text',
              text: `Error: Failed to get services: ${allServicesResult.message}`
            }]
          };
        }
        
        const allServices = allServicesResult;
        
        // Create a map of service names to their versions from the full service list
        const serviceVersionMap = new Map<string, string[]>();
        allServices.forEach((service: {name: string, versions: string[]}) => {
          serviceVersionMap.set(service.name, service.versions);
        });
        
        // Now get filtered services if a search was specified
        let services = allServices;
        if (originalSearch) {
          // Apply the original search filter
          args.search = originalSearch;
          const filteredServicesResult = await esAdapter.getServices(args.search, args.startTime, args.endTime);
          
          // Check if we got an error response
          if (isErrorResponse(filteredServicesResult)) {
            return {
              content: [{
                type: 'text',
                text: `Error: Failed to get filtered services: ${filteredServicesResult.message}`
              }]
            };
          }
          
          services = filteredServicesResult;
        }
        
        // Convert to map for easier manipulation
        const servicesMap = new Map<string, Set<string>>();
        
        services.forEach((service: {name: string, versions: string[]}) => {
          if (!servicesMap.has(service.name)) {
            servicesMap.set(service.name, new Set<string>());
          }
          const versionSet = servicesMap.get(service.name)!;
          service.versions.forEach((version: string) => versionSet.add(version));
        });
        
        // Filter services by version if specified
        let filteredServices = Array.from(servicesMap.entries());
        
        if (args.version && args.version.trim() !== '') {
          // Check if the version search term contains wildcard characters (* or ?)
          const hasWildcards = args.version.includes('*') || args.version.includes('?');
          
          if (hasWildcards) {
            // Convert the wildcard pattern to a regular expression
            const regexPattern = args.version
              .replace(/\./g, '\\.')
              .replace(/\*/g, '.*')
              .replace(/\?/g, '.');
            const regex = new RegExp(`^${regexPattern}$`, 'i');
            
            filteredServices = filteredServices.filter((entry) => {
              const [_, versions] = entry;
              return Array.from(versions).some(version => regex.test(version));
            });
            
            logger.info('[MCP TOOL] servicesGet filtered services by version with wildcard pattern', { 
              count: filteredServices.length, 
              versionPattern: args.version,
              regexPattern
            });
          } else {
            // Use exact matching for non-wildcard version searches
            filteredServices = filteredServices.filter((entry) => {
              const [_, versions] = entry;
              return versions.has(args.version!);
            });
            
            logger.info('[MCP TOOL] servicesGet filtered services by exact version', { 
              count: filteredServices.length, 
              version: args.version 
            });
          }
        }
        
        // Convert filtered services to array of objects for response
        const servicesList = filteredServices.map((entry) => {
          const [name, versions] = entry;
          return {
            name,
            versions: Array.from(versions)
          };
        });
        
        // Sort services by name
        const sortedServices = servicesList.sort((a, b) => a.name.localeCompare(b.name));
        
        // Add metadata about which telemetry types were used and service field paths
        const result = {
          services: sortedServices,
          telemetryUsed: availableTelemetry,
          serviceFields: {
            traces: ['Resource.service.name'],
            metrics: ['service.name', 'kubernetes.deployment.name'],
            logs: ['service.name', 'resource.service.name', 'Resource.service.name', 'kubernetes.deployment.name', 'k8s.deployment.name']
          }
        };
        
        return {
          content: [
            { type: 'text', text: JSON.stringify(result) }
          ]
        };
      } catch (error) {
        logger.error('[MCP TOOL] servicesGet failed', { 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          args
        });
        
        return {
          content: [
            { type: 'text', text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
              details: {
                tool: 'servicesGet'
              }
            }) },
            { type: 'text', text: `Error retrieving services: ${error instanceof Error ? error.message : String(error)}` }
          ]
        };
      }
    }
  );
}
