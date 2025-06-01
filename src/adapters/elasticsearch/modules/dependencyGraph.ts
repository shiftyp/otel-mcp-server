import { ElasticsearchCore, ElasticsearchAdapterOptions } from '../core/core.js';
import { logger } from '../../../utils/logger.js';
import { createErrorResponse, ErrorResponse, isErrorResponse } from '../../../utils/errorHandling.js';
import { createBoolQuery, createRangeQuery } from '../../../utils/queryBuilder.js';
import { parseTimeRange } from '../../../utils/timeRangeParser.js';

/**
 * Service dependency graph functionality for the Elasticsearch Adapter
 */
export class DependencyGraph {
  private coreAdapter: ElasticsearchCore;
  
  constructor(options: ElasticsearchAdapterOptions) {
    this.coreAdapter = new ElasticsearchCore(options);
  }
  
  /**
   * Get service dependency graph data
   * @param startTime Start time for the time range in ISO format
   * @param endTime End time for the time range in ISO format
   * @param sampleRate Sample rate for the query (0.0-1.0)
   * @returns Service dependency relationships and span counts
   */
  public async serviceDependencyGraph(
    startTime: string, 
    endTime: string, 
    sampleRate: number = 1.0
  ): Promise<{ 
    relationships: { parent: string, child: string, count: number, errorCount?: number, errorRate?: number }[],
    spanCounts: { processed: number, total: number, percentage: string }
  } | ErrorResponse> {
    try {
      logger.info('[DependencyGraph] Getting service dependency graph', { startTime, endTime, sampleRate });
      
      // Validate parameters
      if (!startTime || !endTime) {
        return createErrorResponse('Start time and end time are required');
      }
      
      if (sampleRate < 0 || sampleRate > 1) {
        return createErrorResponse('Sample rate must be between 0 and 1');
      }
      
      // Parse time range
      const timeRange = parseTimeRange(startTime, endTime);
      if (isErrorResponse(timeRange)) {
        return timeRange;
      }
      
      // Build query
      const must = [
        createRangeQuery('@timestamp', timeRange.startTime, timeRange.endTime)
      ];
      
      // Add sampling filter if needed
      let samplingScript = '';
      if (sampleRate < 1) {
        samplingScript = `
          double sampleRate = ${sampleRate};
          return Math.random() < sampleRate;
        `;
      }
      
      // Build query
      const query: any = {
        query: createBoolQuery({ must }),
        size: 10000,
        _source: [
          'Resource.service.name',
          'ParentSpanId',
          'SpanId',
          'Status.code'
        ]
      };
      
      // Add script filter if sampling is enabled
      if (samplingScript) {
        query.query.bool.filter = [
          {
            script: {
              script: {
                source: samplingScript,
                lang: 'painless'
              }
            }
          }
        ];
      }
      
      // Execute query
      const result = await this.coreAdapter.callEsRequest('POST', '/.ds-traces-*/_search', query);
      
      if (!result || result.error) {
        const errorMessage = result?.error?.reason || 'Unknown error';
        return createErrorResponse(`Error getting service dependency graph: ${errorMessage}`);
      }
      
      // Process results
      const hits = result.hits?.hits || [];
      const total = result.hits?.total?.value || 0;
      const processed = hits.length;
      
      // Build span map
      const spanMap = new Map<string, { service: string, error: boolean }>();
      for (const hit of hits) {
        const source = hit._source;
        const service = source.Resource?.service?.name;
        const spanId = source.SpanId;
        const hasError = source.Status?.code === 2; // 2 = ERROR in OpenTelemetry
        
        if (service && spanId) {
          spanMap.set(spanId, { service, error: hasError });
        }
      }
      
      // Build relationships
      const relationshipMap = new Map<string, { count: number, errorCount: number }>();
      
      for (const hit of hits) {
        const source = hit._source;
        const childService = source.Resource?.service?.name;
        const childSpanId = source.SpanId;
        const parentSpanId = source.ParentSpanId;
        const hasError = source.Status?.code === 2; // 2 = ERROR in OpenTelemetry
        
        if (childService && childSpanId && parentSpanId) {
          const parentInfo = spanMap.get(parentSpanId);
          
          if (parentInfo && parentInfo.service !== childService) {
            const key = `${parentInfo.service}|${childService}`;
            
            if (!relationshipMap.has(key)) {
              relationshipMap.set(key, { count: 0, errorCount: 0 });
            }
            
            const relationship = relationshipMap.get(key)!;
            relationship.count++;
            
            if (hasError) {
              relationship.errorCount++;
            }
          }
        }
      }
      
      // Convert to array
      const relationships = Array.from(relationshipMap.entries()).map(([key, value]) => {
        const [parent, child] = key.split('|');
        const errorRate = value.count > 0 ? value.errorCount / value.count : 0;
        
        return {
          parent,
          child,
          count: value.count,
          errorCount: value.errorCount,
          errorRate
        };
      });
      
      // Sort by count
      relationships.sort((a, b) => b.count - a.count);
      
      return {
        relationships,
        spanCounts: {
          processed,
          total,
          percentage: `${((processed / total) * 100).toFixed(2)}%`
        }
      };
    } catch (error) {
      return createErrorResponse(`Error getting service dependency graph: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Build a service dependency tree structure with relationship-specific metrics and nested paths
   * @param directRelationships The direct relationships between services
   * @returns A hierarchical tree structure representing service dependencies with detailed metrics
   */
  public async buildServiceDependencyTree(
    directRelationships: { parent: string, child: string, count: number, errorCount?: number, errorRate?: number }[]
  ): Promise<{ 
    rootServices: string[];
    serviceTree: Map<string, {
      children: {
        serviceName: string;
        metrics: {
          calls: number;
          errors: number;
          errorRate: number;
          errorRatePercentage: number;
        };
        path: {
          minLatency?: number;
          maxLatency?: number;
          avgLatency?: number;
          p95Latency?: number;
          p99Latency?: number;
        };
      }[];
      parents: {
        serviceName: string;
        metrics: {
          calls: number;
          errors: number;
          errorRate: number;
          errorRatePercentage: number;
        };
      }[];
      metrics: {
        incomingCalls: number;
        outgoingCalls: number;
        errors: number;
        errorRate: number;
        errorRatePercentage: number;
      };
    }>;
  } | ErrorResponse> {
    try {
      logger.info('[DependencyGraph] Building service dependency tree');
      
      // Create a map of services
      const serviceMap = new Map<string, {
        children: {
          serviceName: string;
          metrics: {
            calls: number;
            errors: number;
            errorRate: number;
            errorRatePercentage: number;
          };
          path: {
            minLatency?: number;
            maxLatency?: number;
            avgLatency?: number;
            p95Latency?: number;
            p99Latency?: number;
          };
        }[];
        parents: {
          serviceName: string;
          metrics: {
            calls: number;
            errors: number;
            errorRate: number;
            errorRatePercentage: number;
          };
        }[];
        metrics: {
          incomingCalls: number;
          outgoingCalls: number;
          errors: number;
          errorRate: number;
          errorRatePercentage: number;
        };
      }>();
      
      // Initialize service map
      const allServices = new Set<string>();
      
      for (const relationship of directRelationships) {
        allServices.add(relationship.parent);
        allServices.add(relationship.child);
      }
      
      for (const service of allServices) {
        serviceMap.set(service, {
          children: [],
          parents: [],
          metrics: {
            incomingCalls: 0,
            outgoingCalls: 0,
            errors: 0,
            errorRate: 0,
            errorRatePercentage: 0
          }
        });
      }
      
      // Process relationships
      for (const relationship of directRelationships) {
        const { parent, child, count, errorCount = 0 } = relationship;
        const errorRate = count > 0 ? errorCount / count : 0;
        const errorRatePercentage = errorRate * 100;
        
        // Add child to parent
        const parentService = serviceMap.get(parent)!;
        parentService.children.push({
          serviceName: child,
          metrics: {
            calls: count,
            errors: errorCount,
            errorRate,
            errorRatePercentage
          },
          path: {} // Latency metrics would be added here if available
        });
        parentService.metrics.outgoingCalls += count;
        
        // Add parent to child
        const childService = serviceMap.get(child)!;
        childService.parents.push({
          serviceName: parent,
          metrics: {
            calls: count,
            errors: errorCount,
            errorRate,
            errorRatePercentage
          }
        });
        childService.metrics.incomingCalls += count;
        childService.metrics.errors += errorCount;
      }
      
      // Calculate error rates for each service
      for (const [serviceName, service] of serviceMap.entries()) {
        const totalCalls = service.metrics.outgoingCalls;
        const totalErrors = service.children.reduce((sum, child) => sum + child.metrics.errors, 0);
        
        service.metrics.errors = totalErrors;
        service.metrics.errorRate = totalCalls > 0 ? totalErrors / totalCalls : 0;
        service.metrics.errorRatePercentage = service.metrics.errorRate * 100;
        
        // Sort children by calls
        service.children.sort((a, b) => b.metrics.calls - a.metrics.calls);
        
        // Sort parents by calls
        service.parents.sort((a, b) => b.metrics.calls - a.metrics.calls);
      }
      
      // Find root services (services with no parents)
      const rootServices = Array.from(serviceMap.entries())
        .filter(([_, service]) => service.parents.length === 0)
        .map(([serviceName]) => serviceName);
      
      return {
        rootServices,
        serviceTree: serviceMap
      };
    } catch (error) {
      return createErrorResponse(`Error building service dependency tree: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
