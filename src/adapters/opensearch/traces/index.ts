import { OpenSearchCore } from '../core/core.js';
import { logger } from '../../../utils/logger.js';

/**
 * OpenSearch Traces Adapter
 * Provides functionality for working with OpenTelemetry trace data in OpenSearch
 */
export class TracesAdapter extends OpenSearchCore {
  constructor(options: any) {
    super(options);
  }

  /**
   * Make a request to OpenSearch
   */
  public async request(method: string, url: string, body: any) {
    return this.callRequest(method, url, body);
  }

  /**
   * Analyze a trace by traceId
   */
  public async analyzeTrace(traceId: string): Promise<any> {
    logger.info('[OpenSearch TracesAdapter] Analyzing trace', { traceId });
    
    try {
      // OpenSearch query to find all spans for a trace
      const query = {
        query: {
          term: {
            "trace_id": traceId
          }
        },
        size: 1000, // Limit to 1000 spans per trace
        sort: [
          { "start_time": { "order": "asc" } }
        ]
      };
      
      // Use the index pattern for traces
      const indexPattern = 'traces-*';
      const response = await this.request('POST', `/${indexPattern}/_search`, query);
      
      if (!response.hits || response.hits.total.value === 0) {
        logger.warn('[OpenSearch TracesAdapter] No spans found for trace', { traceId });
        return { error: `No spans found for trace ID: ${traceId}` };
      }
      
      const spans = response.hits.hits.map((hit: any) => hit._source);
      
      // Find the root span (span without a parent)
      const rootSpan = spans.find((span: any) => !span.parent_id) || spans[0];
      
      return {
        traceId,
        rootSpan,
        spans,
        spanCount: spans.length
      };
    } catch (error: any) {
      logger.error('[OpenSearch TracesAdapter] Error analyzing trace', { traceId, error });
      return { error: `Failed to analyze trace: ${error.message || error}` };
    }
  }
  
  /**
   * Lookup a span by spanId
   */
  public async spanLookup(spanId: string): Promise<any | null> {
    logger.info('[OpenSearch TracesAdapter] Looking up span', { spanId });
    
    try {
      // OpenSearch query to find a specific span
      const query = {
        query: {
          term: {
            "span_id": spanId
          }
        },
        size: 1
      };
      
      // Use the index pattern for traces
      const indexPattern = 'traces-*';
      const response = await this.request('POST', `/${indexPattern}/_search`, query);
      
      if (!response.hits || response.hits.total.value === 0) {
        logger.warn('[OpenSearch TracesAdapter] Span not found', { spanId });
        return null;
      }
      
      return response.hits.hits[0]._source;
    } catch (error) {
      logger.error('[OpenSearch TracesAdapter] Error looking up span', { spanId, error });
      return null;
    }
  }
  
  /**
   * Build a service dependency graph for a time window
   */
  public async serviceDependencyGraph(startTime: string, endTime: string, sampleRate: number = 1.0): Promise<{ 
    relationships: { parent: string, child: string, count: number, errorCount?: number, errorRate?: number }[],
    spanCounts: { processed: number, total: number, percentage: string }
  }> {
    logger.info('[OpenSearch TracesAdapter] Building service dependency graph', { startTime, endTime, sampleRate });
    
    try {
      // OpenSearch query to find spans within the time range
      const query = {
        query: {
          bool: {
            filter: [
              {
                range: {
                  "@timestamp": {
                    gte: startTime,
                    lte: endTime
                  }
                }
              }
            ]
          }
        },
        size: 0, // We only need aggregations
        aggs: {
          service_relationships: {
            composite: {
              size: 10000,
              sources: [
                {
                  parent_service: {
                    terms: {
                      field: "resource.attributes.service.name"
                    }
                  }
                },
                {
                  child_service: {
                    terms: {
                      field: "resource.attributes.service.name"
                    }
                  }
                }
              ]
            },
            aggs: {
              error_count: {
                filter: {
                  term: {
                    "status.code": 2 // Error status in OpenTelemetry
                  }
                }
              }
            }
          },
          span_count: {
            value_count: {
              field: "span_id"
            }
          }
        }
      };
      
      // Use the index pattern for traces
      const indexPattern = 'traces-*';
      const response = await this.request('POST', `/${indexPattern}/_search`, query);
      
      // Extract relationships from the aggregation results
      const relationships: { parent: string, child: string, count: number, errorCount?: number, errorRate?: number }[] = [];
      
      if (response.aggregations && response.aggregations.service_relationships) {
        const buckets = response.aggregations.service_relationships.buckets || [];
        
        for (const bucket of buckets) {
          const parent = bucket.key.parent_service;
          const child = bucket.key.child_service;
          
          // Skip self-relationships
          if (parent === child) continue;
          
          const count = bucket.doc_count;
          const errorCount = bucket.error_count.doc_count;
          const errorRate = count > 0 ? errorCount / count : 0;
          
          relationships.push({
            parent,
            child,
            count,
            errorCount,
            errorRate
          });
        }
      }
      
      // Calculate span counts
      const totalSpans = response.aggregations?.span_count?.value || 0;
      const processedSpans = Math.floor(totalSpans * sampleRate);
      const percentage = totalSpans > 0 ? `${Math.floor((processedSpans / totalSpans) * 100)}%` : '0%';
      
      return {
        relationships,
        spanCounts: {
          processed: processedSpans,
          total: totalSpans,
          percentage
        }
      };
    } catch (error) {
      logger.error('[OpenSearch TracesAdapter] Error building service dependency graph', { error });
      return {
        relationships: [],
        spanCounts: {
          processed: 0,
          total: 0,
          percentage: '0%'
        }
      };
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
  }> {
    logger.info('[OpenSearch TracesAdapter] Building service dependency tree');
    
    // Create a set of all services
    const allServices = new Set<string>();
    for (const rel of directRelationships) {
      allServices.add(rel.parent);
      allServices.add(rel.child);
    }
    
    // Initialize the service tree with empty entries for all services
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
    
    for (const service of allServices) {
      serviceTree.set(service, {
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
    
    // Populate the service tree with relationship data
    for (const rel of directRelationships) {
      const { parent, child, count, errorCount = 0, errorRate = 0 } = rel;
      
      // Add child relationship
      const parentNode = serviceTree.get(parent);
      if (parentNode) {
        parentNode.children.push({
          serviceName: child,
          metrics: {
            calls: count,
            errors: errorCount,
            errorRate,
            errorRatePercentage: Math.round(errorRate * 100)
          },
          path: {} // Path metrics would be populated with actual latency data if available
        });
        
        // Update parent metrics
        parentNode.metrics.outgoingCalls += count;
        parentNode.metrics.errors += errorCount;
      }
      
      // Add parent relationship
      const childNode = serviceTree.get(child);
      if (childNode) {
        childNode.parents.push({
          serviceName: parent,
          metrics: {
            calls: count,
            errors: errorCount,
            errorRate,
            errorRatePercentage: Math.round(errorRate * 100)
          }
        });
        
        // Update child metrics
        childNode.metrics.incomingCalls += count;
      }
    }
    
    // Calculate error rates for each service
    for (const [service, node] of serviceTree.entries()) {
      const totalCalls = node.metrics.outgoingCalls;
      if (totalCalls > 0) {
        node.metrics.errorRate = node.metrics.errors / totalCalls;
        node.metrics.errorRatePercentage = Math.round(node.metrics.errorRate * 100);
      }
    }
    
    // Identify root services (those with no parents)
    const rootServices = Array.from(allServices).filter(service => {
      const node = serviceTree.get(service);
      return node && node.parents.length === 0;
    });
    
    return {
      rootServices,
      serviceTree
    };
  }
}
