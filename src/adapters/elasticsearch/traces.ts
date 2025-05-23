import { ElasticsearchCore } from './core.js';
import { logger } from '../../utils/logger.js';

export class TracesAdapter extends ElasticsearchCore {
  /**
   * Analyze a trace by traceId
   */
  public async analyzeTrace(traceId: string): Promise<any> {
    try {
      logger.info('[ES Adapter] analyzeTrace called', { traceId });
      
      // First, get the root span for this trace
      const rootSpan = await this.getRootSpan(traceId);
      if (!rootSpan) {
        logger.warn('[ES Adapter] No root span found for trace', { traceId });
        return { message: `No spans found for trace ID: ${traceId}` };
      }
      
      // Get all spans for this trace
      const spans = await this.getAllSpansForTrace(traceId);
      if (!spans || spans.length === 0) {
        logger.warn('[ES Adapter] No spans found for trace', { traceId });
        return { message: `No spans found for trace ID: ${traceId}` };
      }
      
      logger.info('[ES Adapter] Found spans for trace', { traceId, spanCount: spans.length });
      
      // Basic trace analysis
      const analysis = {
        traceId,
        rootSpan,
        spanCount: spans.length,
        serviceName: rootSpan.Resource?.service?.name || 'unknown',
        operationName: rootSpan.Name || 'unknown',
        status: rootSpan.TraceStatus || 'unknown',
        errorCount: spans.filter((span: any) => span.TraceStatus === 2).length,
        services: [...new Set(spans.map((span: any) => span.Resource?.service?.name || 'unknown'))],
      };
      
      return analysis;
    } catch (error) {
      logger.error('Error analyzing trace', { traceId, error });
      return { message: `Error analyzing trace: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  
  /**
   * Get the root span for a trace
   */
  private async getRootSpan(traceId: string): Promise<any> {
    logger.info('[ES Adapter] Getting root span for trace', { traceId });
    
    // First attempt: find spans with this trace ID and empty ParentSpanId
    const response = await this.request('POST', '/traces-*/_search', {
      size: 1,
      query: {
        bool: {
          must: [
            { term: { 'TraceId.keyword': traceId } },
            { term: { 'ParentSpanId.keyword': '' } }
          ]
        }
      }
    });
    
    if (response.hits?.hits?.length > 0) {
      logger.info('[ES Adapter] Found root span with empty ParentSpanId', { traceId });
      return response.hits.hits[0]._source;
    }
    
    // Second attempt: find spans with this trace ID and no ParentSpanId field
    const fallbackResponse = await this.request('POST', '/traces-*/_search', {
      size: 1,
      query: {
        bool: {
          must: [
            { term: { 'TraceId.keyword': traceId } }
          ],
          must_not: [
            { exists: { field: 'ParentSpanId' } }
          ]
        }
      }
    });
    
    if (fallbackResponse.hits?.hits?.length > 0) {
      logger.info('[ES Adapter] Found root span with no ParentSpanId field', { traceId });
      return fallbackResponse.hits.hits[0]._source;
    }
    
    // Third attempt: just get the first span of the trace as a fallback
    const lastFallbackResponse = await this.request('POST', '/traces-*/_search', {
      size: 1,
      query: {
        term: { 'TraceId.keyword': traceId }
      }
    });
    
    if (lastFallbackResponse.hits?.hits?.length > 0) {
      logger.info('[ES Adapter] Using first span as root (fallback)', { traceId });
      return lastFallbackResponse.hits.hits[0]._source;
    }
    
    logger.warn('[ES Adapter] No spans found for trace', { traceId });
    return null;
  }
  
  /**
   * Get all spans for a trace
   */
  private async getAllSpansForTrace(traceId: string): Promise<any[]> {
    logger.info('[ES Adapter] Getting all spans for trace', { traceId });
    
    const response = await this.request('POST', '/traces-*/_search', {
      size: 1000,
      query: {
        term: { 'TraceId.keyword': traceId }
      },
      sort: [
        { '@timestamp': { order: 'asc' } }
      ]
    });
    
    const spans = response.hits?.hits?.map((hit: any) => hit._source) || [];
    logger.info('[ES Adapter] Found spans for trace', { traceId, count: spans.length });
    return spans;
  }
  
  /**
   * Lookup a span by spanId
   */
  public async spanLookup(spanId: string): Promise<any | null> {
    logger.info('[ES Adapter] Looking up span', { spanId });
    
    const response = await this.request('POST', '/traces-*/_search', {
      size: 1,
      query: {
        term: { 'SpanId.keyword': spanId }
      }
    });
    
    if (response.hits?.hits?.length > 0) {
      logger.info('[ES Adapter] Found span', { spanId });
      return response.hits.hits[0]._source;
    }
    
    logger.warn('[ES Adapter] Span not found', { spanId });
    return null;
  }
  
  /**
   * Build a service dependency graph for a time window
   */
  public async serviceDependencyGraph(startTime: string, endTime: string): Promise<{ parent: string, child: string, count: number, errorCount?: number, errorRate?: number }[]> {
    logger.info('[ES Adapter] Building service dependency graph', { startTime, endTime });
    
    try {
      // Use a simpler, more efficient approach to build the service dependency graph
      // First, get the parent-child service relationships directly
      const response = await this.request('POST', '/traces-*/_search', {
        size: 0,
        query: {
          bool: {
            must: [
              {
                range: {
                  '@timestamp': {
                    gte: startTime,
                    lte: endTime
                  }
                }
              },
              {
                exists: {
                  field: 'ParentSpanId'
                }
              }
            ]
          }
        },
        aggs: {
          // Group by child service
          services: {
            terms: {
              field: 'Resource.service.name.keyword',
              size: 100 // Limit to top 100 services
            },
            aggs: {
              // For each child service, get the parent spans
              parent_services: {
                terms: {
                  field: 'ParentSpanId.keyword',
                  size: 100 // Limit to top 100 parent spans per service
                }
              },
              // Count errors for this service
              errors: {
                filter: {
                  bool: {
                    should: [
                      { term: { 'TraceStatus': 2 } },
                      { term: { 'Status.code': 'ERROR' } }
                    ]
                  }
                }
              }
            }
          }
        }
      });
    
      // Process the aggregation results to build the graph
      const edges: { parent: string, child: string, count: number, errorCount?: number, errorRate?: number }[] = [];
      const serviceMap = new Map<string, Map<string, {count: number, errors: number}>>(); 
      
      // Get the service buckets from the new aggregation structure
      const serviceBuckets = response.aggregations?.services?.buckets || [];
      
      // First pass: collect all parent span IDs and their child services
      const parentSpanToChildService = new Map<string, string>();
      for (const serviceBucket of serviceBuckets) {
        const childService = serviceBucket.key;
        const parentSpanBuckets = serviceBucket.parent_services?.buckets || [];
        
        for (const parentSpanBucket of parentSpanBuckets) {
          const parentSpanId = parentSpanBucket.key;
          parentSpanToChildService.set(parentSpanId, childService);
        }
      }
      
      // Second pass: for each child service, get its parent spans and find their services
      for (const serviceBucket of serviceBuckets) {
        const childService = serviceBucket.key;
        const errorCount = serviceBucket.errors?.doc_count || 0;
        const totalCount = serviceBucket.doc_count || 0;
        
        // Get the parent spans for this child service
        const parentSpanIds = serviceBucket.parent_services?.buckets.map((b: any) => b.key) || [];
        
        // For each parent span ID, find its service
        for (const parentSpanId of parentSpanIds) {
          // Query to find the service for this parent span ID
          const parentSpanResponse = await this.request('POST', '/traces-*/_search', {
            size: 1,
            query: {
              term: { 'SpanId.keyword': parentSpanId }
            },
            _source: ['Resource.service.name']
          });
          
          const parentService = parentSpanResponse.hits?.hits?.[0]?._source?.Resource?.service?.name;
          
          if (parentService && parentService !== childService) {
            // Add to the service map
            if (!serviceMap.has(parentService)) {
              serviceMap.set(parentService, new Map());
            }
            
            const parentMap = serviceMap.get(parentService)!;
            if (!parentMap.has(childService)) {
              parentMap.set(childService, {count: 0, errors: 0});
            }
            
            const stats = parentMap.get(childService)!;
            stats.count++;
          }
        }
      }
      
      // Convert the service map to edges
      for (const [parent, children] of serviceMap.entries()) {
        for (const [child, stats] of children.entries()) {
          edges.push({
            parent,
            child,
            count: stats.count,
            errorCount: stats.errors,
            errorRate: stats.errors > 0 ? stats.errors / stats.count : 0
          });
        }
      }
      
      return edges;
    } catch (error) {
      logger.error('[ES Adapter] Error building service dependency graph', { startTime, endTime, error });
      throw new Error(`Error building service dependency graph: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Helper method to find the service name for a span ID within trace buckets
   */
  private findServiceForSpan(traceBuckets: any[], spanId: string): string | null {
    for (const traceBucket of traceBuckets) {
      const spanBuckets = traceBucket.spans?.buckets || [];
      
      for (const spanBucket of spanBuckets) {
        if (spanBucket.key === spanId) {
          const serviceBucket = spanBucket.service?.buckets?.[0];
          if (serviceBucket) {
            return serviceBucket.key;
          }
        }
      }
    }
    
    return null;
  }
  
  /**
   * Query traces with a custom query
   */
  public async queryTraces(query: any): Promise<any> {
    return this.request('POST', '/traces-*/_search', query);
  }
  
  /**
   * Get services from trace data with their versions
   * @param search Optional search term to filter services by name
   * @returns Array of service objects with name and versions
   */
  public async getServices(search?: string): Promise<Array<{name: string, versions: string[]}>> {
    try {
      // Query for distinct service.name values across traces
      logger.info('[ES Adapter] getServices called', { search });
      
      // Use the correct field names based on the Elasticsearch mapping
      // Query for both services and their versions
      const query = {
        size: 0,
        aggs: {
          services: {
            terms: {
              field: 'Resource.service.name.keyword',
              size: 1000
            },
            aggs: {
              versions: {
                terms: {
                  field: 'Resource.service.version.keyword',
                  size: 100
                }
              }
            }
          }
        }
      };
      
      logger.info('[ES Adapter] getServices query', { query });
      
      // Query the traces index
      const response = await this.request('POST', '/traces-generic-default/_search', query);
      
      logger.info('[ES Adapter] getServices response', { 
        hasAggregations: !!response.aggregations,
        responseKeys: Object.keys(response || {}),
        aggregationKeys: response.aggregations ? Object.keys(response.aggregations) : [] 
      });
      
      // Process services and their versions from the aggregation
      let services: Array<{name: string, versions: string[]}> = [];
      
      if (response.aggregations?.services?.buckets?.length > 0) {
        logger.info('[ES Adapter] Found services in services aggregation', { 
          count: response.aggregations.services.buckets.length 
        });
        
        services = response.aggregations.services.buckets.map((bucket: any) => {
          // Get versions for this service
          const versions = bucket.versions?.buckets?.map((versionBucket: any) => versionBucket.key) || [];
          
          return {
            name: bucket.key,
            versions
          };
        });
      } else {
        logger.warn('[ES Adapter] No services found in aggregation');
      }
      
      logger.info('[ES Adapter] getServices raw services', { count: services.length, services });
      
      // Filter services by search term if provided
      if (search && search.trim() !== '') {
        const searchLower = search.toLowerCase();
        services = services.filter(service => 
          service.name.toLowerCase().includes(searchLower)
        );
        logger.info('[ES Adapter] getServices filtered services', { count: services.length, services, searchTerm: search });
      }
      
      return services;
    } catch (error) {
      logger.error('[ES Adapter] getServices error', { error });
      throw error;
    }
  }
  
  /**
   * Get operations for a specific service
   */
  public async getOperations(service: string): Promise<string[]> {
    // Query for distinct span names for a specific service
    const response = await this.request('POST', '/traces-*/_search', {
      size: 0,
      query: {
        bool: {
          must: [
            { term: { 'resource.attributes.service\\.name': service } }
          ]
        }
      },
      aggs: {
        operations: {
          terms: {
            field: 'name',
            size: 1000
          }
        }
      }
    });
    
    return response.aggregations?.operations?.buckets?.map((bucket: any) => bucket.key) || [];
  }
}
