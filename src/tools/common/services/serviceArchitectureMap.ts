import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../../adapters/elasticsearch/index.js';
import { ElasticGuards } from '../../../utils/guards/index.js';
import { logger } from '../../../utils/logger.js';
import { registerMcpTool } from '../../../utils/registerTool.js';
import type { MCPToolOutput, MCPToolContentItem } from '../../../types.js';

// Define interfaces for the tree structure
interface ServiceMetrics {
  calls: number;
  errors: number;
  errorRate: number;
  errorRatePercentage: number;
}

interface PathMetrics {
  minLatency?: number;
  maxLatency?: number;
  avgLatency?: number;
  p95Latency?: number;
  p99Latency?: number;
}

interface ServiceChild {
  serviceName: string;
  metrics: ServiceMetrics;
  path: PathMetrics;
}

interface ServiceParent {
  serviceName: string;
  metrics: ServiceMetrics;
}

interface ServiceData {
  children: ServiceChild[];
  parents: ServiceParent[];
  metrics: {
    incomingCalls: number;
    outgoingCalls: number;
    errors: number;
    errorRate: number;
    errorRatePercentage: number;
  };
}

interface TreeNode {
  id: string;
  name: string;
  isRoot: boolean;
  children: {
    id: string;
    name: string;
    metrics: ServiceMetrics;
    path: PathMetrics;
  }[];
  parents: {
    id: string;
    name: string;
    metrics: ServiceMetrics;
  }[];
  metrics: {
    incomingCalls: number;
    outgoingCalls: number;
    errors: number;
    errorRate: number;
    errorRatePercentage: number;
  };
}

interface TreeData {
  rootServices: string[];
  serviceTree: Map<string, ServiceData>;
}

/**
 * Register the serviceArchitectureMap tool
 * @param server The MCP server instance
 * @param esAdapter The Elasticsearch adapter instance
 */
export function registerServiceArchitectureMapTool(server: McpServer, esAdapter: ElasticsearchAdapter): void {
  registerMcpTool(
    server,
    'serviceArchitectureMap',
    {
      startTime: z.string().optional().describe('Start time for the time range in ISO format (e.g., "2023-01-01T00:00:00Z")'),
      endTime: z.string().optional().describe('End time for the time range in ISO format (e.g., "2023-01-02T00:00:00Z")'),
      service: z.string().optional().describe('Filter paths to only those containing this service'),
      minCallCount: z.number().optional().describe('Minimum number of calls for a path to be included (default: 1)'),
      maxPaths: z.number().optional().describe('Maximum number of paths to return (default: 50)'),
      maxDepth: z.number().optional().describe('Maximum depth of service relationships to include (default: no limit)'),
      sortBy: z.enum(['calls', 'errors', 'errorRate']).optional().describe('Sort paths by this metric (default: calls)'),
      format: z.enum(['full', 'summary', 'compact']).optional().describe('Output format - full includes all details, summary provides aggregated statistics, compact returns minimal information (default: full)'),
      page: z.number().optional().describe('Page number for paginated results (default: 1)'),
      pageSize: z.number().optional().describe('Number of items per page (default: 20)')
    },
    async (args: { 
      startTime?: string, 
      endTime?: string, 
      service?: string, 
      minCallCount?: number, 
      maxPaths?: number,
      maxDepth?: number,
      sortBy?: 'calls' | 'errors' | 'errorRate',
      format?: 'full' | 'summary' | 'compact',
      page?: number,
      pageSize?: number
    } = {}): Promise<MCPToolOutput> => {
      if (!args || typeof args !== 'object') args = {};
      logger.info('[MCP TOOL] serviceArchitectureMap called', { args });
      
      try {
        // Ensure trace data is available
        await ElasticGuards.checkTracesAvailability(esAdapter);
        
        // Set default values
        const format = args.format || 'full';
        const page = args.page || 1;
        const pageSize = args.pageSize || 20;
        const minCallCount = args.minCallCount || 1;
        const maxPaths = args.maxPaths || 50;
        
        // Use a wider time range if not specified
        const startTime = args.startTime || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 24 hours ago if not specified
        const endTime = args.endTime || new Date().toISOString(); // now if not specified
        
        // Get the service dependency graph - this returns direct relationships between services and span counts
        const dependencyData = await esAdapter.serviceDependencyGraph(startTime, endTime);
        const { relationships, spanCounts } = dependencyData;
        
        // Build the tree structure from the relationships data
        const treeData: TreeData = await esAdapter.buildServiceDependencyTree(relationships);
        
        // Calculate time range in milliseconds for rate calculations
        const timeRangeMs = new Date(endTime).getTime() - new Date(startTime).getTime();
        
        // Prepare the response based on the requested format
        let result: any;
        
        if (format === 'full') {
          // Full format includes the complete tree structure with all metrics
          
          // Convert the tree structure to a more JSON-friendly format
          const treeNodes: TreeNode[] = [];
          treeData.serviceTree.forEach((serviceData, serviceName) => {
            // Skip services that don't match the filter if specified
            if (args.service && serviceName !== args.service && 
                !serviceData.children.some(child => child.serviceName === args.service) &&
                !serviceData.parents.some(parent => parent.serviceName === args.service)) {
              return;
            }
            
            treeNodes.push({
              id: serviceName,
              name: serviceName,
              isRoot: treeData.rootServices.includes(serviceName),
              children: serviceData.children.map(child => ({
                id: child.serviceName,
                name: child.serviceName,
                metrics: child.metrics,
                path: child.path
              })),
              parents: serviceData.parents.map(parent => ({
                id: parent.serviceName,
                name: parent.serviceName,
                metrics: parent.metrics
              })),
              metrics: serviceData.metrics
            });
          });
          
          // Calculate total calls and errors across all services
          const totalCalls = relationships.reduce((sum: number, rel: { count: number }) => sum + rel.count, 0);
          const totalErrors = relationships.reduce((sum: number, rel: { errorCount?: number }) => sum + (rel.errorCount || 0), 0);
          const totalErrorRate = totalCalls > 0 ? totalErrors / totalCalls : 0;
          const totalErrorRatePercentage = (totalErrorRate * 100).toFixed(2);
          
          // Get the top error paths
          const topErrorPaths = [...relationships]
            .filter((rel: { errorCount?: number }) => (rel.errorCount || 0) > 0)
            .sort((a: { errorCount?: number }, b: { errorCount?: number }) => (b.errorCount || 0) - (a.errorCount || 0))
            .slice(0, 5);
          
          result = {
            format: 'full',
            tree: treeNodes,
            rootServices: treeData.rootServices,
            summary: {
              totalServices: treeData.serviceTree.size,
              totalRelationships: relationships.length,
              totalCalls,
              totalErrors,
              totalErrorRate,
              totalErrorRatePercentage,
              callsPerMinute: Math.round((totalCalls / timeRangeMs) * 60000 * 100) / 100
            },
            spanCounts: spanCounts,
            pagination: {
              page,
              pageSize,
              totalItems: treeNodes.length,
              totalPages: Math.ceil(treeNodes.length / pageSize)
            },
            timeRange: {
              start: startTime,
              end: endTime,
              durationMinutes: Math.round(timeRangeMs / (1000 * 60) * 100) / 100,
              durationHours: Math.round(timeRangeMs / (1000 * 60 * 60) * 100) / 100
            }
          };
        } else if (format === 'summary') {
          // Summary format includes aggregated statistics without the detailed tree structure
          
          // Calculate service-level statistics
          const serviceStats: Array<{
            name: string;
            incomingCalls: number;
            outgoingCalls: number;
            errors: number;
            errorRate: number;
            errorRatePercentage: number;
          }> = [];
          
          treeData.serviceTree.forEach((serviceData, serviceName) => {
            // Skip services that don't match the filter if specified
            if (args.service && serviceName !== args.service) {
              return;
            }
            
            serviceStats.push({
              name: serviceName,
              incomingCalls: serviceData.metrics.incomingCalls,
              outgoingCalls: serviceData.metrics.outgoingCalls,
              errors: serviceData.metrics.errors,
              errorRate: serviceData.metrics.errorRate,
              errorRatePercentage: serviceData.metrics.errorRatePercentage
            });
          });
          
          // Sort by the requested metric
          if (args.sortBy === 'errors') {
            serviceStats.sort((a, b) => b.errors - a.errors);
          } else if (args.sortBy === 'errorRate') {
            serviceStats.sort((a, b) => b.errorRate - a.errorRate);
          } else {
            // Default sort by total calls
            serviceStats.sort((a, b) => (b.incomingCalls + b.outgoingCalls) - (a.incomingCalls + a.outgoingCalls));
          }
          
          // Apply pagination
          const paginatedStats = serviceStats.slice((page - 1) * pageSize, page * pageSize);
          
          // Calculate total calls and errors
          const totalCalls = relationships.reduce((sum: number, rel: any) => sum + rel.count, 0);
          const totalErrors = relationships.reduce((sum: number, rel: any) => sum + (rel.errorCount || 0), 0);
          const overallErrorRate = totalCalls > 0 ? totalErrors / totalCalls : 0;
          const overallErrorRatePercentage = (overallErrorRate * 100).toFixed(2);
          
          result = {
            format: 'summary',
            services: paginatedStats,
            rootServices: treeData.rootServices.filter(service => 
              !args.service || service === args.service
            ),
            summary: {
              totalServices: treeData.serviceTree.size,
              filteredServices: serviceStats.length,
              totalRelationships: relationships.length,
              totalCalls,
              totalErrors,
              overallErrorRate,
              overallErrorRatePercentage,
              callsPerMinute: Math.round((totalCalls / timeRangeMs) * 60000 * 100) / 100
            },
            pagination: {
              page,
              pageSize,
              totalItems: serviceStats.length,
              totalPages: Math.ceil(serviceStats.length / pageSize)
            },
            timeRange: {
              start: startTime,
              end: endTime,
              durationMinutes: Math.round(timeRangeMs / (1000 * 60) * 100) / 100,
              durationHours: Math.round(timeRangeMs / (1000 * 60 * 60) * 100) / 100
            }
          };
        } else {
          // Compact format returns minimal information
          
          // Just return the list of services and their direct relationships
          const compactRelationships = relationships
            .filter(rel => rel.count >= minCallCount)
            .filter(rel => !args.service || rel.parent === args.service || rel.child === args.service)
            .map(rel => ({
              source: rel.parent,
              target: rel.child,
              calls: rel.count,
              errors: rel.errorCount || 0,
              errorRate: rel.errorRate || 0
            }))
            .sort((a, b) => {
              if (args.sortBy === 'errors') {
                return b.errors - a.errors;
              } else if (args.sortBy === 'errorRate') {
                return b.errorRate - a.errorRate;
              } else {
                return b.calls - a.calls;
              }
            })
            .slice(0, maxPaths);
          
          // Calculate total calls and errors across all services
          const totalCalls = relationships.reduce((sum: number, rel: any) => sum + rel.count, 0);
          const totalErrors = relationships.reduce((sum: number, rel: any) => sum + (rel.errorCount || 0), 0);
          const totalErrorRate = totalCalls > 0 ? totalErrors / totalCalls : 0;
          
          result = {
            format: 'compact',
            relationships: compactRelationships,
            rootServices: treeData.rootServices.filter(service => 
              !args.service || service === args.service
            ),
            summary: {
              totalServices: treeData.serviceTree.size,
              totalRelationships: relationships.length,
              filteredRelationships: compactRelationships.length,
              totalCalls,
              totalErrors,
              totalErrorRate,
              totalErrorRatePercentage: Math.round(totalErrorRate * 10000) / 100
            },
            timeRange: {
              start: startTime,
              end: endTime
            }
          };
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
