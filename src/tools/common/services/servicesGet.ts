import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../../adapters/elasticsearch/index.js';
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
        const allServices = await esAdapter.getServices(undefined, args.startTime, args.endTime);
        
        // Create a map of service names to their versions from the full service list
        const serviceVersionMap = new Map<string, string[]>();
        allServices.forEach(service => {
          serviceVersionMap.set(service.name, service.versions);
        });
        
        // Now get filtered services if a search was specified
        let services = allServices;
        if (originalSearch) {
          // Apply the original search filter
          args.search = originalSearch;
          services = await esAdapter.getServices(args.search, args.startTime, args.endTime);
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
            
            filteredServices = filteredServices.filter(([_, versions]) => {
              return Array.from(versions).some(version => regex.test(version));
            });
            
            logger.info('[MCP TOOL] servicesGet filtered services by version with wildcard pattern', { 
              count: filteredServices.length, 
              versionPattern: args.version,
              regexPattern
            });
          } else {
            // Use exact matching for non-wildcard version searches
            filteredServices = filteredServices.filter(([_, versions]) => {
              return versions.has(args.version!);
            });
            
            logger.info('[MCP TOOL] servicesGet filtered services by exact version', { 
              count: filteredServices.length, 
              version: args.version 
            });
          }
        }
        
        // Convert filtered services to array of objects for response
        const servicesList = filteredServices.map(([name, versions]) => ({
          name,
          versions: Array.from(versions)
        }));
        
        // Sort services by name
        const sortedServices = servicesList.sort((a, b) => a.name.localeCompare(b.name));
        
        // Add metadata about which telemetry types were used and service field paths
        const result: any = {
          services: sortedServices,
          telemetryUsed: availableTelemetry,
          serviceFields: {
            traces: ['Resource.service.name'],
            metrics: ['service.name', 'kubernetes.deployment.name'],
            logs: ['service.name', 'resource.service.name', 'Resource.service.name', 'kubernetes.deployment.name', 'k8s.deployment.name']
          }
        };
        
        // If trace data is available, include service dependency graph
        if (availableTelemetry.traces) {
          try {
            // Use a wider time range if not specified
            const graphStartTime = args.startTime || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 24 hours ago if not specified
            const graphEndTime = args.endTime || new Date().toISOString(); // now if not specified
            
            logger.info('[MCP TOOL] Generating service dependency graph', { 
              startTime: graphStartTime, 
              endTime: graphEndTime,
              userSpecifiedTimeRange: !!(args.startTime && args.endTime)
            });
            
            // Get the service dependency graph - returns direct relationships between services and span counts
            const dependencyData = await esAdapter.serviceDependencyGraph(graphStartTime, graphEndTime);
            const { relationships, spanCounts } = dependencyData;
            
            // If there are no dependencies, return a simplified graph structure
            if (!relationships || relationships.length === 0) {
              result.serviceGraph = {
                nodes: [],
                edges: [],
                tree: [],
                summary: {
                  overall: {
                    totalServices: 0,
                    totalRelationships: 0,
                    directRelationships: 0,
                    extendedRelationships: 0,
                    totalCalls: 0,
                    totalErrors: 0,
                    overallErrorRate: 0,
                    overallErrorRatePercentage: 0,
                    callsPerMinute: 0
                  },
                  timePeriod: {
                    start: graphStartTime,
                    end: graphEndTime
                  }
                },
                metadata: {
                  message: 'No service dependencies found in the specified time range'
                }
              };
              
              logger.info('[MCP TOOL] No service dependencies found in the time range');
            } else {
              // Extract unique service names from the dependency graph
              const serviceNames = new Set(relationships.flatMap((edge: any) => [edge.parent, edge.child]));
              
              // Create nodes array with additional metadata
              const nodes = Array.from(serviceNames).map(name => {
                // Get version info from the service version map
                const versions = serviceVersionMap.get(name) || ['unknown'];
                return { 
                  id: name, 
                  label: name,
                  version: versions[0] || 'unknown',
                  versions: versions,
                  metadata: {
                    telemetryTypes: [
                      // Check which telemetry types have this service
                      ...(availableTelemetry.traces ? ['traces'] : []),
                      ...(availableTelemetry.metrics ? ['metrics'] : []),
                      ...(availableTelemetry.logs ? ['logs'] : [])
                    ]
                  }
                };
              });
              
              // Calculate time range in milliseconds for rate calculations
              const timeRangeMs = new Date(graphEndTime).getTime() - new Date(graphStartTime).getTime();
              
              // Create edges with detailed metrics and version information
              const edges = relationships.map((edge: any) => {
                // Get source and target version info from the service version map
                const sourceVersions = serviceVersionMap.get(edge.parent) || ['unknown'];
                const targetVersions = serviceVersionMap.get(edge.child) || ['unknown'];
                
                // Calculate edge-specific statistics
                const errorCount = edge.errorCount || 0;
                const errorRate = edge.errorRate || 0;
                const callsPerMinute = Math.round((edge.count / timeRangeMs) * 60000 * 100) / 100;
                const errorRatePercentage = Math.round(errorRate * 10000) / 100;
                
                // Check if this is an extended relationship
                const isExtended = 'isExtended' in edge ? edge.isExtended : false;
                
                return {
                  source: edge.parent,
                  target: edge.child,
                  count: edge.count,
                  errorCount: errorCount,
                  errorRate: errorRate,
                  isExtended,
                  metrics: {
                    callsPerMinute: callsPerMinute,
                    errorRatePercentage: errorRatePercentage,
                  },
                  stats: {
                    // Traffic statistics
                    traffic: {
                      totalCalls: edge.count,
                      callsPerMinute: callsPerMinute,
                      callsPerHour: Math.round(callsPerMinute * 60 * 100) / 100,
                      callsPerDay: Math.round(callsPerMinute * 60 * 24 * 100) / 100
                    },
                    // Error statistics
                    errors: {
                      count: errorCount,
                      rate: errorRate,
                      percentage: errorRatePercentage
                    },
                    // Time period
                    timePeriod: {
                      start: graphStartTime,
                      end: graphEndTime,
                      durationMinutes: Math.round(timeRangeMs / (1000 * 60) * 100) / 100,
                      durationHours: Math.round(timeRangeMs / (1000 * 60 * 60) * 100) / 100
                    }
                  },
                  metadata: {
                    source: {
                      version: sourceVersions[0] || 'unknown',
                      versions: sourceVersions
                    },
                    target: {
                      version: targetVersions[0] || 'unknown',
                      versions: targetVersions
                    }
                  }
                };
              });
              
              // Calculate summary statistics
              const totalCalls = edges.reduce((sum: number, edge: any) => sum + edge.count, 0);
              const totalErrors = edges.reduce((sum: number, edge: any) => sum + (edge.errorCount || 0), 0);
              const overallErrorRate = totalCalls > 0 ? (totalErrors / totalCalls) : 0;
              const callsPerMinute = Math.round((totalCalls / timeRangeMs) * 60000 * 100) / 100;
              
              // Find the busiest and most error-prone services
              const serviceCallCounts = new Map<string, { 
                calls: number, 
                errors: number, 
                incomingCalls: number, 
                outgoingCalls: number,
                incomingErrors: number,
                outgoingErrors: number
              }>();
              
              // Count calls and errors for each service (both as source and target)
              edges.forEach(edge => {
                // Source service (outgoing calls)
                if (!serviceCallCounts.has(edge.source)) {
                  serviceCallCounts.set(edge.source, { 
                    calls: 0, 
                    errors: 0, 
                    incomingCalls: 0, 
                    outgoingCalls: 0,
                    incomingErrors: 0,
                    outgoingErrors: 0
                  });
                }
                const sourceStats = serviceCallCounts.get(edge.source)!;
                sourceStats.calls += edge.count;
                sourceStats.errors += edge.errorCount || 0;
                sourceStats.outgoingCalls += edge.count;
                sourceStats.outgoingErrors += edge.errorCount || 0;
                
                // Target service (incoming calls)
                if (!serviceCallCounts.has(edge.target)) {
                  serviceCallCounts.set(edge.target, { 
                    calls: 0, 
                    errors: 0, 
                    incomingCalls: 0, 
                    outgoingCalls: 0,
                    incomingErrors: 0,
                    outgoingErrors: 0
                  });
                }
                const targetStats = serviceCallCounts.get(edge.target)!;
                targetStats.calls += edge.count;
                targetStats.incomingCalls += edge.count;
                targetStats.incomingErrors += edge.errorCount || 0;
                // We don't add errors to total target errors as they're already counted in the source
              });
              
              // Calculate service-specific statistics
              const serviceStats = Array.from(serviceCallCounts.entries()).map(([name, stats]) => {
                const totalCalls = stats.calls;
                const errorRate = totalCalls > 0 ? (stats.errors / totalCalls) : 0;
                return {
                  name,
                  version: serviceVersionMap.get(name)?.[0] || 'unknown',
                  totalCalls,
                  incomingCalls: stats.incomingCalls,
                  outgoingCalls: stats.outgoingCalls,
                  errors: stats.errors,
                  incomingErrors: stats.incomingErrors,
                  outgoingErrors: stats.outgoingErrors,
                  errorRate,
                  errorRatePercentage: Math.round(errorRate * 10000) / 100,
                  callsPerMinute: Math.round((totalCalls / timeRangeMs) * 60000 * 100) / 100
                };
              }).sort((a, b) => b.totalCalls - a.totalCalls); // Sort by total calls descending
              
              // Find the most active relationships
              const topRelationships = [...edges]
                .sort((a, b) => b.count - a.count)
                .slice(0, 5)
                .map(edge => ({
                  source: edge.source,
                  sourceVersion: serviceVersionMap.get(edge.source)?.[0] || 'unknown',
                  target: edge.target,
                  targetVersion: serviceVersionMap.get(edge.target)?.[0] || 'unknown',
                  calls: edge.count,
                  errors: edge.errorCount || 0,
                  errorRate: edge.errorRate || 0,
                  errorRatePercentage: Math.round((edge.errorRate || 0) * 10000) / 100,
                  isExtended: edge.isExtended || false
                }));
              
              // Get tree structure
              let treeNodes: any[] = [];
              
              // Build the tree structure from the relationships data
              const treeData = await esAdapter.buildServiceDependencyTree(relationships);
              
              if (treeData) {
                // Convert the tree structure to a more JSON-friendly format
                treeData.serviceTree.forEach((serviceData: any, serviceName: string) => {
                  treeNodes.push({
                    id: serviceName,
                    name: serviceName,
                    version: serviceVersionMap.get(serviceName)?.[0] || 'unknown',
                    isRoot: treeData.rootServices.includes(serviceName),
                    children: serviceData.children.map((child: any) => ({
                      id: child.serviceName,
                      name: child.serviceName,
                      version: serviceVersionMap.get(child.serviceName)?.[0] || 'unknown',
                      metrics: child.metrics
                    })),
                    parents: serviceData.parents.map((parent: any) => ({
                      id: parent.serviceName,
                      name: parent.serviceName,
                      version: serviceVersionMap.get(parent.serviceName)?.[0] || 'unknown',
                      metrics: parent.metrics
                    })),
                    metrics: serviceData.metrics
                  });
                });
              }
              
              // Add the service dependency graph to the result
              result.serviceGraph = {
                nodes,
                edges,
                tree: treeNodes,
                summary: {
                  overall: {
                    totalServices: nodes.length,
                    totalRelationships: edges.length,
                    directRelationships: edges.filter(e => !e.isExtended).length,
                    extendedRelationships: edges.filter(e => e.isExtended).length,
                    totalCalls,
                    totalErrors,
                    overallErrorRate,
                    overallErrorRatePercentage: Math.round(overallErrorRate * 10000) / 100,
                    callsPerMinute
                  },
                  services: serviceStats,
                  topRelationships,
                  timePeriod: {
                    start: graphStartTime,
                    end: graphEndTime,
                    durationMinutes: Math.round(timeRangeMs / (1000 * 60) * 100) / 100,
                    durationHours: Math.round(timeRangeMs / (1000 * 60 * 60) * 100) / 100
                  }
                }
              };
            }
          } catch (error) {
            logger.error('[MCP TOOL] Error generating service dependency graph', { 
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined
            });
            
            // Add error information to the result
            result.serviceGraph = {
              error: {
                message: error instanceof Error ? error.message : String(error),
                type: error instanceof Error ? error.constructor.name : 'Unknown',
                stack: error instanceof Error ? error.stack : undefined
              }
            };
          }
        }
        
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      } catch (error) {
        return ElasticGuards.formatErrorResponse(error);
      }
    }
  );
}
