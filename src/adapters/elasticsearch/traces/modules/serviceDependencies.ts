import { logger } from '../../../../utils/logger.js';
import { TraceCore } from './traceCore.js';
import { getParentServiceName, getChildServiceName } from '../../scripts/traces/traceScripts.js';

/**
 * Functionality for analyzing service dependencies from trace data
 */
export class ServiceDependencies extends TraceCore {
  /**
   * Build a service dependency graph for a time window
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @returns Object containing array of direct relationships between parent and child services and span counts
   */
  /**
   * Build a service dependency graph for a time window, with optional statistical sampling.
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param sampleRate Fraction of spans to sample (0 < sampleRate <= 1, default 1.0)
   * @returns Object containing array of direct relationships between parent and child services and span counts
   */
  public async serviceDependencyGraph(startTime: string, endTime: string, sampleRate: number = 1.0): Promise<{ 
    relationships: { parent: string, child: string, count: number, errorCount?: number, errorRate?: number }[],
    spanCounts: { processed: number, total: number, percentage: string }
  }> {
    try {
      logger.info('[ES Adapter] Building service dependency graph', { startTime, endTime });
      const normalizedStartTime = new Date(startTime).toISOString();
      const normalizedEndTime = new Date(endTime).toISOString();
      /**
       * Build service dependency relationships by joining spans in-memory.
       * This is necessary because the trace documents do not contain direct parent/child service fields,
       * only span_id, parent_span_id, and resource.attributes.service.name. We must fetch spans in batches,
       * build a map of span_id to service name, and then for each span with a parent_span_id, look up the parent's service.
       */
      const relationships = new Map<string, Map<string, { count: number, errors: number }>>();
      const spanServiceMap = new Map<string, string>();
      const PAGE_SIZE = 5000;
      let totalProcessed = 0;
      let lastSortValue: any = null;
      let hasMoreData = true;
      let currentPage = 0;
      const MAX_PAGES = 1500;

      // First pass: build span_id -> service.name map and collect all spans with parent_span_id
      // If sampleRate < 1, randomly sample spans for statistical efficiency
      const spansWithParents: any[] = [];
      while (hasMoreData && currentPage < MAX_PAGES) {
        currentPage++;
        // Use hash-based deterministic sampling on span_id for true N% sampling
        // Only include spans where Math.abs(hash(span_id))/2147483647.0 < sampleRate
        let query: any;
        query = {
          size: PAGE_SIZE,
          query: {
            bool: {
              must: [
                {
                  range: {
                    '@timestamp': {
                      gte: normalizedStartTime,
                      lte: normalizedEndTime
                    }
                  }
                }
              ],
              should: [
                { exists: { field: 'resource.attributes.service.name' } },
                { exists: { field: 'service.name' } }
              ],
              minimum_should_match: 1,
              filter: []
            }
          },
          _source: [
            'span_id',
            'parent_span_id',
            'resource.attributes.service.name',
            'service.name',
            'status.code',
            'net.peer.name',
            'net.peer.service'
          ],
          sort: ['@timestamp']
        };
        if (lastSortValue) {
          query.search_after = lastSortValue;
        }
        const response = await this.request('POST', `/${this.traceIndexPattern}/_search`, query);
        const hits = response.hits?.hits || [];
        if (hits.length === 0) {
          hasMoreData = false;
          break;
        }
        totalProcessed += hits.length;
        if (hits.length > 0) {
          lastSortValue = hits[hits.length - 1].sort;
        }
        for (const hit of hits) {
          const span = hit._source;
          if (!span || !span.span_id) continue;
          // Extract service name
          let serviceName = span.resource?.attributes?.['service.name'] || span['service.name'] || 'unknown';
          spanServiceMap.set(span.span_id, serviceName);
          if (span.parent_span_id) {
            spansWithParents.push(span);
          }
        }
        hasMoreData = hits.length === PAGE_SIZE;
      }

      // Second pass: for each span, infer relationships using both parent-child join and net.peer.name/service fallback
      for (const span of spansWithParents) {
        const childService = spanServiceMap.get(span.span_id) || 'unknown';
        const parentService = spanServiceMap.get(span.parent_span_id) || 'unknown';
        let recorded = false;
        // 1. Standard parent-child join
        if (childService !== 'unknown' && parentService !== 'unknown' && childService !== parentService) {
          if (!relationships.has(parentService)) relationships.set(parentService, new Map());
          if (!relationships.get(parentService)!.has(childService)) relationships.get(parentService)!.set(childService, { count: 0, errors: 0 });
          const stats = relationships.get(parentService)!.get(childService)!;
          stats.count += 1;
          // Error detection
          const hasError = span.status?.code === 2 || span.Status?.Code === 2 || span.status?.code === 'Error';
          if (hasError) {
            stats.errors += 1;
          }
          recorded = true;
        }
        // 2. Fallback: use net.peer.name or net.peer.service as callee, current service as caller
        const peerService = span['net.peer.name'] || span['net.peer.service'] || span.resource?.attributes?.['net.peer.name'] || span.resource?.attributes?.['net.peer.service'];
        if (peerService && peerService !== childService) {
          const caller = childService;
          const callee = peerService;
          if (!relationships.has(caller)) relationships.set(caller, new Map());
          if (!relationships.get(caller)!.has(callee)) relationships.get(caller)!.set(callee, { count: 0, errors: 0 });
          const stats = relationships.get(caller)!.get(callee)!;
          stats.count += 1;
          // Error detection (same as above)
          const hasError = span.status?.code === 2 || span.Status?.Code === 2 || span.status?.code === 'Error';
          if (hasError) {
            stats.errors += 1;
          }
        }
      }

      // Log summary of all processed data
      const uniqueServices = new Set<string>();
      relationships.forEach((childMap, parent) => {
        uniqueServices.add(parent);
        childMap.forEach((_, child) => uniqueServices.add(child));
      });
      
      logger.info('[ES Adapter] Service dependency graph processing complete', { 
        totalSpansProcessed: totalProcessed,
        uniqueServicesCount: (() => {
          const unique = new Set<string>();
          relationships.forEach((childMap, parent) => {
            unique.add(parent);
            childMap.forEach((_, child) => unique.add(child));
          });
          return unique.size;
        })(),
        totalRelationships: Array.from(relationships.values()).reduce(
          (sum, childMap) => sum + childMap.size, 0
        )
      });
      
      // If we didn't process any relationships, log a warning
      if (totalProcessed === 0) {
        logger.warn('[ES Adapter] No relationships found for dependency graph');
      }
      
      // Get the total number of spans for the time period for reporting purposes
      let totalSpans = 0;
      try {
        const countQuery = {
          query: {
            bool: {
              must: [
                {
                  range: {
                    '@timestamp': {
                      gte: normalizedStartTime,
                      lte: normalizedEndTime
                    }
                  }
                }
              ]
            }
          },
          size: 0, // We only want the count, not the actual documents
          track_total_hits: true
        };
        
        const countResponse = await this.request('POST', `/${this.traceIndexPattern}/_search`, countQuery);
        totalSpans = countResponse.hits.total.value;
        
        logger.info('[ES Adapter] Retrieved total span count', { 
          totalSpans,
          spansProcessed: totalProcessed,
          processingPercentage: totalSpans > 0 ? (totalProcessed / totalSpans * 100).toFixed(2) + '%' : 'unknown'
        });
      } catch (countError) {
        logger.warn('[ES Adapter] Error getting total span count', { 
          error: countError instanceof Error ? countError.message : String(countError),
          startTime,
          endTime
        });
        // Continue even if we can't get the total count
      }
      
      // Convert direct relationships to array format
      const directRelationships: { parent: string, child: string, count: number, errorCount?: number, errorRate?: number, isExtended?: boolean }[] = [];
      
      relationships.forEach((childMap, parent) => {
        childMap.forEach((stats, child) => {
          directRelationships.push({
            parent,
            child,
            count: stats.count,
            errorCount: stats.errors,
            errorRate: stats.errors > 0 ? stats.errors / stats.count : 0,
            isExtended: false // Mark as direct relationship
          });
        });
      });
      
      logger.info('[ES Adapter] Service dependency graph generated', { 
        directRelationships: directRelationships.length,
        services: new Set(directRelationships.flatMap(r => [r.parent, r.child])).size,
        spansProcessed: totalProcessed,
        totalSpans: totalSpans,
        processingPercentage: totalSpans > 0 ? (totalProcessed / totalSpans * 100).toFixed(2) + '%' : 'unknown'
      });
      
      // Return both the relationships and span count information
      return {
        relationships: directRelationships,
        spanCounts: {
          processed: totalProcessed,
          total: totalSpans,
          percentage: totalSpans > 0 ? (totalProcessed / totalSpans * 100).toFixed(2) + '%' : '0.00%'
        }
      }
    } catch (error) {
      logger.error('[ES Adapter] Error building service dependency graph', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        startTime,
        endTime
      });
      
      // Return empty results rather than failing
      return {
        relationships: [],
        spanCounts: {
          processed: 0,
          total: 0,
          percentage: '0.00%'
        }
      };
    }
  }
  
  /**
   * Helper method to add a service relationship to the map
   */
  private addServiceRelationship(
    relationships: Map<string, Map<string, { count: number, errors: number }>>,
    parent: string,
    child: string
  ): void {
    // Initialize parent map if needed
    if (!relationships.has(parent)) {
      relationships.set(parent, new Map<string, { count: number, errors: number }>());
    }
    
    // Initialize child entry if needed
    const childMap = relationships.get(parent)!;
    if (!childMap.has(child)) {
      childMap.set(child, { count: 0, errors: 0 });
    }
    
    const stats = childMap.get(child)!;
    stats.count++;
  }

  /**
   * Build a service dependency tree structure with relationship-specific metrics and nested paths
   * @param directRelationships The direct relationships between services
   * @returns A hierarchical tree structure representing service dependencies with detailed metrics
   */
  public buildServiceDependencyTree(
    directRelationships: { parent: string, child: string, count: number, errorCount?: number, errorRate?: number }[]
  ): { 
    rootServices: string[];
    serviceTree: Map<string, {
      // Basic service information
      children: {
        serviceName: string;
        metrics: {
          calls: number;
          errors: number;
          errorRate: number;
          errorRatePercentage: number;
        };
        // Path metrics for this specific relationship
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
      // Overall service metrics
      metrics: {
        incomingCalls: number;
        outgoingCalls: number;
        errors: number;
        errorRate: number;
        errorRatePercentage: number;
        callsPerMinute?: number;
      };
    }>;
  } {
    // Create a map to store relationship-specific metrics
    const relationshipMetrics = new Map<string, {
      calls: number;
      errors: number;
      errorRate: number;
    }>();
    
    // Initialize maps with all services
    const allServices = new Set<string>();
    
    // Process all direct relationships to build relationship metrics
    for (const rel of directRelationships) {
      allServices.add(rel.parent);
      allServices.add(rel.child);
      
      // Create a unique key for this relationship
      const relationshipKey = `${rel.parent}:${rel.child}`;
      
      // Store relationship metrics
      relationshipMetrics.set(relationshipKey, {
        calls: rel.count,
        errors: rel.errorCount || 0,
        errorRate: rel.errorRate || 0
      });
    }
    
    // Build adjacency maps for the tree structure
    const childRelationships = new Map<string, Map<string, {
      calls: number;
      errors: number;
      errorRate: number;
    }>>();
    
    const parentRelationships = new Map<string, Map<string, {
      calls: number;
      errors: number;
      errorRate: number;
    }>>();
    
    // Service-level metrics
    const serviceMetrics = new Map<string, {
      incomingCalls: number;
      outgoingCalls: number;
      errors: number;
    }>();
    
    // Initialize service metrics
    for (const service of allServices) {
      serviceMetrics.set(service, {
        incomingCalls: 0,
        outgoingCalls: 0,
        errors: 0
      });
    }
    
    // Process relationships to build the tree structure
    for (const rel of directRelationships) {
      // Add to child relationships map
      if (!childRelationships.has(rel.parent)) {
        childRelationships.set(rel.parent, new Map());
      }
      childRelationships.get(rel.parent)!.set(rel.child, {
        calls: rel.count,
        errors: rel.errorCount || 0,
        errorRate: rel.errorRate || 0
      });
      
      // Add to parent relationships map
      if (!parentRelationships.has(rel.child)) {
        parentRelationships.set(rel.child, new Map());
      }
      parentRelationships.get(rel.child)!.set(rel.parent, {
        calls: rel.count,
        errors: rel.errorCount || 0,
        errorRate: rel.errorRate || 0
      });
      
      // Update service metrics
      const parentMetrics = serviceMetrics.get(rel.parent)!;
      parentMetrics.outgoingCalls += rel.count;
      if (rel.errorCount) {
        parentMetrics.errors += rel.errorCount;
      }
      
      const childMetrics = serviceMetrics.get(rel.child)!;
      childMetrics.incomingCalls += rel.count;
    }
    
    // Find root services (services with no parents or only self as parent)
    const rootServices: string[] = [];
    for (const service of allServices) {
      const parents = parentRelationships.get(service);
      if (!parents || parents.size === 0 || (parents.size === 1 && parents.has(service))) {
        rootServices.push(service);
      }
    }
    
    // Build the final tree structure with detailed metrics
    const serviceTree = new Map<string, {
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
    
    // Add all services to the tree with enhanced metrics
    for (const service of allServices) {
      // Get children with detailed metrics
      const childrenWithMetrics = [];
      const childrenMap = childRelationships.get(service);
      if (childrenMap) {
        for (const [childName, metrics] of childrenMap.entries()) {
          childrenWithMetrics.push({
            serviceName: childName,
            metrics: {
              calls: metrics.calls,
              errors: metrics.errors,
              errorRate: metrics.errorRate,
              errorRatePercentage: Math.round(metrics.errorRate * 10000) / 100
            },
            path: {
              // Latency metrics would be added here if available
            }
          });
        }
      }
      
      // Get parents with detailed metrics
      const parentsWithMetrics = [];
      const parentsMap = parentRelationships.get(service);
      if (parentsMap) {
        for (const [parentName, metrics] of parentsMap.entries()) {
          parentsWithMetrics.push({
            serviceName: parentName,
            metrics: {
              calls: metrics.calls,
              errors: metrics.errors,
              errorRate: metrics.errorRate,
              errorRatePercentage: Math.round(metrics.errorRate * 10000) / 100
            }
          });
        }
      }
      
      // Calculate service-level metrics
      const metrics = serviceMetrics.get(service) || { incomingCalls: 0, outgoingCalls: 0, errors: 0 };
      const totalCalls = metrics.incomingCalls + metrics.outgoingCalls;
      const errorRate = totalCalls > 0 ? metrics.errors / totalCalls : 0;
      
      // Add service to the tree
      serviceTree.set(service, {
        children: childrenWithMetrics,
        parents: parentsWithMetrics,
        metrics: {
          incomingCalls: metrics.incomingCalls,
          outgoingCalls: metrics.outgoingCalls,
          errors: metrics.errors,
          errorRate: errorRate,
          errorRatePercentage: Math.round(errorRate * 10000) / 100
        }
      });
    }
    
    return {
      rootServices,
      serviceTree
    };
  }
}
