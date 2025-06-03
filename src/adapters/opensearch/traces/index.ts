import { OpenSearchCore } from '../core/core.js';
import { logger } from '../../../utils/logger.js';
import { DependencyEvolutionAnalysis } from './analysis/dependencyEvolution.js';
import { TraceAttributeAnalysis } from './analysis/traceAttributeAnalysis.js';
import { TracesAdapterCore } from './core/adapter.js';
import { ConfigLoader } from '../../../config/index.js';
// We'll import the TraceAttributeClustering dynamically to avoid circular dependencies

/**
 * OpenSearch Traces Adapter
 * Provides functionality for working with OpenTelemetry trace data in OpenSearch
 */
export class TracesAdapter extends OpenSearchCore {
  private dependencyEvolution: DependencyEvolutionAnalysis;
  public attributeAnalysis: TraceAttributeAnalysis;
  public core: TracesAdapterCore;
  
  constructor(options: any) {
    super(options);
    this.dependencyEvolution = new DependencyEvolutionAnalysis(options);
    this.attributeAnalysis = new TraceAttributeAnalysis();
    this.core = new TracesAdapterCore(options);
  }
  
  /**
   * Search traces with a custom query
   * @param query The query object
   */
  public async queryTraces(query: any): Promise<any> {
    return this.searchTraces(query);
  }

  /**
   * Make a request to OpenSearch
   */
  public async request(method: string, url: string, body: any) {
    return this.callRequest(method, url, body);
  }

  /**
   * Query logs with custom query (required by OpenSearchCore)
   * @param query The query object
   */
  public async queryLogs(query: any): Promise<any> {
    logger.info('[OpenSearch TracesAdapter] queryLogs called but not implemented in this adapter');
    throw new Error('queryLogs not implemented in TracesAdapter');
  }
  
  /**
   * Get a trace by its ID
   * @param traceId The trace ID to retrieve
   */
  public async getTrace(traceId: string): Promise<any> {
    logger.info('[OpenSearch TracesAdapter] getTrace called', { traceId });
    
    try {
      // Query for all spans with this trace ID
      const response = await this.callRequest('POST', '/traces-*/_search', {
        query: {
          term: {
            'trace.id': traceId
          }
        },
        size: 10000, // Get all spans in the trace
        sort: [
          { 'timestamp': { order: 'asc' } }
        ]
      });
      
      // Process the response
      const hits = response.hits?.hits || [];
      if (hits.length === 0) {
        return null;
      }
      
      // Extract spans from the hits
      const spans = hits.map((hit: any) => {
        const source = hit._source;
        return {
          spanId: source.span?.id,
          parentSpanId: source.parent?.id,
          traceId: source.trace?.id,
          name: source.span?.name,
          serviceName: source.service?.name,
          kind: source.span?.kind,
          startTime: source.timestamp,
          duration: source.span?.duration?.us / 1000, // Convert to ms
          status: source.span?.status,
          attributes: source.attributes || {},
          events: source.span?.events || [],
          links: source.span?.links || [],
          resource: source.resource || {}
        };
      });
      
      // Calculate trace duration and error status
      let minTime = Number.MAX_VALUE;
      let maxTime = 0;
      let hasError = false;
      
      for (const span of spans) {
        const startTime = new Date(span.startTime).getTime();
        const endTime = startTime + span.duration;
        
        if (startTime < minTime) minTime = startTime;
        if (endTime > maxTime) maxTime = endTime;
        
        if (span.status?.code === 'ERROR') {
          hasError = true;
        }
      }
      
      // Construct the trace object
      return {
        traceId,
        spans,
        timestamp: new Date(minTime).toISOString(),
        duration: maxTime - minTime,
        error: hasError,
        spanCount: spans.length
      };
    } catch (error) {
      logger.error('[OpenSearch TracesAdapter] Error getting trace', { error, traceId });
      throw error;
    }
  }
  
  /**
   * Get a span by its ID
   * @param spanId The span ID to retrieve
   */
  public async getSpan(spanId: string): Promise<any> {
    logger.info('[OpenSearch TracesAdapter] getSpan called', { spanId });
    
    try {
      // Query for the span with this ID
      const response = await this.callRequest('POST', '/traces-*/_search', {
        query: {
          term: {
            'span.id': spanId
          }
        },
        size: 1
      });
      
      // Process the response
      const hits = response.hits?.hits || [];
      if (hits.length === 0) {
        return null;
      }
      
      // Extract span from the hit
      const source = hits[0]._source;
      return {
        spanId: source.span?.id,
        parentSpanId: source.parent?.id,
        traceId: source.trace?.id,
        name: source.span?.name,
        serviceName: source.service?.name,
        kind: source.span?.kind,
        startTime: source.timestamp,
        duration: source.span?.duration?.us / 1000, // Convert to ms
        status: source.span?.status,
        attributes: source.attributes || {},
        events: source.span?.events || [],
        links: source.span?.links || [],
        resource: source.resource || {}
      };
    } catch (error) {
      logger.error('[OpenSearch TracesAdapter] Error getting span', { error, spanId });
      throw error;
    }
  }
  
  /**
   * Generate a timeline visualization for a trace
   * @param traceData The trace data
   */
  public async generateTraceTimeline(traceData: any): Promise<any> {
    logger.info('[OpenSearch TracesAdapter] generateTraceTimeline called');
    
    try {
      // Extract spans from the trace data
      const spans = traceData.spans || [];
      if (spans.length === 0) {
        return null;
      }
      
      // Sort spans by start time
      spans.sort((a: any, b: any) => {
        const aTime = new Date(a.startTime).getTime();
        const bTime = new Date(b.startTime).getTime();
        return aTime - bTime;
      });
      
      // Calculate the trace start time
      const traceStartTime = new Date(spans[0].startTime).getTime();
      
      // Generate timeline data
      const timelineData = spans.map((span: any) => {
        const startTime = new Date(span.startTime).getTime();
        const relativeStart = startTime - traceStartTime;
        
        return {
          id: span.spanId,
          parentId: span.parentSpanId,
          name: span.name,
          service: span.serviceName,
          startTime: relativeStart,
          duration: span.duration,
          endTime: relativeStart + span.duration,
          status: span.status?.code || 'OK'
        };
      });
      
      // Return the timeline visualization data
      return {
        type: 'trace_timeline',
        traceId: traceData.traceId,
        startTime: traceData.timestamp,
        duration: traceData.duration,
        spans: timelineData
      };
    } catch (error) {
      logger.error('[OpenSearch TracesAdapter] Error generating trace timeline', { error });
      throw error;
    }
  }
  
  /**
   * Identify the critical path in a trace
   * @param traceData The trace data
   */
  public async identifyCriticalPath(traceData: any): Promise<any> {
    logger.info('[OpenSearch TracesAdapter] identifyCriticalPath called');
    
    try {
      // Extract spans from the trace data
      const spans = traceData.spans || [];
      if (spans.length === 0) {
        return null;
      }
      
      // Build a span map for quick lookup
      const spanMap = new Map();
      for (const span of spans) {
        spanMap.set(span.spanId, span);
      }
      
      // Find the root span
      const rootSpan = spans.find((span: any) => !span.parentSpanId);
      if (!rootSpan) {
        return null;
      }
      
      // Build a tree structure
      const buildTree = (span: any) => {
        const children = spans.filter((s: any) => s.parentSpanId === span.spanId);
        return {
          ...span,
          children: children.map((child: any) => buildTree(child))
        };
      };
      
      const tree = buildTree(rootSpan);
      
      // Find the critical path (longest path from root to leaf)
      const findCriticalPath = (node: any): any[] => {
        if (!node.children || node.children.length === 0) {
          return [node];
        }
        
        let longestPath: any[] = [];
        let maxDuration = 0;
        
        for (const child of node.children) {
          const childPath = findCriticalPath(child);
          const pathDuration = childPath.reduce((sum: number, span: any) => sum + span.duration, 0);
          
          if (pathDuration > maxDuration) {
            maxDuration = pathDuration;
            longestPath = childPath;
          }
        }
        
        return [node, ...longestPath];
      };
      
      const criticalPath = findCriticalPath(tree);
      
      // Return the critical path
      return {
        path: criticalPath.map((span: any) => ({
          spanId: span.spanId,
          name: span.name,
          serviceName: span.serviceName,
          duration: span.duration
        })),
        totalDuration: criticalPath.reduce((sum: number, span: any) => sum + span.duration, 0),
        spanCount: criticalPath.length
      };
    } catch (error) {
      logger.error('[OpenSearch TracesAdapter] Error identifying critical path', { error });
      throw error;
    }
  }
  
  /**
   * Get trace fields
   * @param search Optional search pattern to filter fields
   * @param serviceFilter Optional service or services to filter fields
   */
  public async getTraceFields(search?: string, serviceFilter?: string | string[]): Promise<any[]> {
    logger.info('[OpenSearch TracesAdapter] getTraceFields called', { search, serviceFilter });
    
    try {
      // Get field mappings from the traces index
      const mappings = await this.core.request('GET', '/traces-*/_mapping', undefined);
      
      // Extract fields from mappings
      const fields: any[] = [];
      const processedFields = new Set<string>();
      
      // Process each index's mappings
      for (const indexName of Object.keys(mappings)) {
        const indexMappings = mappings[indexName].mappings;
        if (!indexMappings || !indexMappings.properties) {
          logger.warn('[OpenSearch TracesAdapter] No properties found in mapping', { indexName });
          continue;
        }
        
        // Process the properties for this index
        const indexFields = this.processProperties(indexMappings.properties, '', processedFields);
        logger.info('[OpenSearch TracesAdapter] Processed fields for index', { 
          indexName, 
          fieldCount: indexFields.length,
          sampleFields: indexFields.slice(0, 5).map(f => f.name)
        });
        
        // Add the fields to our list
        fields.push(...indexFields);
      }
      
      // If we didn't find any fields, try a direct query to get sample documents
      if (fields.length === 0) {
        logger.info('[OpenSearch TracesAdapter] No fields found in mappings, trying direct query');
        
        // Query for a sample of documents
        const sampleQuery = {
          size: 10,
          query: { match_all: {} }
        };
        
        const response = await this.core.request('POST', '/traces-*/_search', sampleQuery);
        const hits = response.hits?.hits || [];
        
        if (hits.length > 0) {
          logger.info('[OpenSearch TracesAdapter] Found sample documents, extracting fields');
          
          // Extract fields from sample documents
          for (const hit of hits) {
            if (hit._source) {
              this.processProperties(hit._source, '', processedFields).forEach(field => {
                fields.push(field);
              });
            }
          }
        }
      }
      // Filter fields by search pattern if provided
      let filteredFields = fields;
      if (search && search.trim() !== '') {
        const searchPattern = new RegExp(search.replace(/\*/g, '.*'), 'i');
        filteredFields = fields.filter(field => searchPattern.test(field.name));
      }
      
      // Filter fields by service if provided
      if (serviceFilter) {
        // We would need to query for documents with the specified service(s)
        // and then filter fields to only those present in those documents
        // This is a simplified implementation
        logger.info('[OpenSearch TracesAdapter] Service filtering for fields is not fully implemented');
      }
      
      return filteredFields;
    } catch (error) {
      logger.error('[OpenSearch TracesAdapter] Error getting trace fields', { error, search, serviceFilter });
      throw error;
    }
  }
  
  /**
   * Helper function to process properties recursively
   */
  private processProperties(properties: any, prefix: string = '', processedFields: Set<string> = new Set()) {
    const fields: any[] = [];
    
    for (const [fieldName, fieldInfo] of Object.entries(properties)) {
      const fullFieldName = prefix ? `${prefix}.${fieldName}` : fieldName;
      
      // If this is a nested field with properties, process recursively
      if ((fieldInfo as any).properties) {
        const nestedFields = this.processProperties((fieldInfo as any).properties, fullFieldName, processedFields);
        fields.push(...nestedFields);
      } else {
        // Check if we've already processed this field to avoid duplicates
        if (processedFields.has(fullFieldName)) continue;
        processedFields.add(fullFieldName);
        
        // Check if this is a text field that might have a keyword subfield
        let hasKeywordField = false;
        if ((fieldInfo as any).type === 'text' && (fieldInfo as any).fields && (fieldInfo as any).fields.keyword) {
          hasKeywordField = true;
        }
        
        // Add the field to our list
        fields.push({
          name: fullFieldName,
          type: (fieldInfo as any).type || 'unknown',
          format: (fieldInfo as any).format,
          searchable: true,
          aggregatable: (fieldInfo as any).type !== 'text',
          hasKeywordField: hasKeywordField,
          keywordField: hasKeywordField ? `${fullFieldName}.keyword` : undefined
        });
      }
    }
    
    return fields;
  }

  /**
   * List available log fields (required by OpenSearchCore)
   * @param includeSourceDoc Whether to include source document fields
   */
  public async listLogFields(prefix?: string): Promise<string[]> {
    logger.info('[OpenSearch TracesAdapter] listLogFields called but not implemented in this adapter');
    throw new Error('listLogFields not implemented in TracesAdapter');
  }

  /**
   * Query metrics with custom query (required by OpenSearchCore)
   * @param query The query object
   */
  public async searchMetrics(query: any): Promise<any> {
    logger.info('[OpenSearch TracesAdapter] searchMetrics called but not implemented in this adapter');
    throw new Error('searchMetrics not implemented in TracesAdapter');
  }



  /**
   * Execute a raw search against the traces index
   * @param query The raw OpenSearch query object
   */
  public async searchTraces(query: any): Promise<any> {
    logger.info('[OpenSearch TracesAdapter] Searching traces', { query });
    
    try {
      // Default index pattern for trace data
      const indexPattern = 'traces-*';
      
      // If the query has a search property, convert it to a query_string query
      if (query.search && typeof query.search === 'string') {
        query.query = {
          query_string: {
            query: query.search,
            default_field: "*",
            fields: ["name", "span.name", "service.name", "resource.attributes.*"]
          }
        };
        delete query.search;
      }
      
      // Add default sort if not specified
      if (!query.sort) {
        query.sort = [{ '@timestamp': { order: 'desc' } }];
      }
      
      // Add default size if not specified
      if (!query.size) {
        query.size = 100;
      }
      
      // Execute the search
      const response = await this.callRequest('POST', `/${indexPattern}/_search`, query);
      
      return response;
    } catch (error) {
      logger.error('[OpenSearch TracesAdapter] Error searching traces', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        query
      });
      throw error;
    }
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
            "trace.id": traceId
          }
        },
        size: 1000, // Limit to 1000 spans per trace
        sort: [
          { "@timestamp": { "order": "asc" } }
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
            "span.id": spanId
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
   * Get services from traces
   */
  public async getServices(search?: string, startTime?: string, endTime?: string): Promise<any[]> {
    logger.info('[OpenSearch TracesAdapter] Getting services', { search, startTime, endTime });
    
    try {
      // Build query to get services
      const query: any = {
        size: 0,
        aggs: {
          services: {
            terms: {
              field: 'service.name',
              size: 1000
            }
          }
        }
      };
      
      // Add search filter if specified
      if (search) {
        query.query = {
          wildcard: {
            'service.name': `*${search}*`
          }
        };
      }
      
      // Add time range filter if specified
      if (startTime || endTime) {
        if (!query.query) {
          query.query = { bool: { filter: [] } };
        } else if (!query.query.bool) {
          const existingQuery = query.query;
          query.query = { bool: { must: [existingQuery], filter: [] } };
        } else if (!query.query.bool.filter) {
          query.query.bool.filter = [];
        }
        
        const config = ConfigLoader.get();
        const timestampField = config.telemetry.fields.timestamp;
        const rangeFilter: any = { range: { [timestampField]: {} } };
        if (startTime) rangeFilter.range[timestampField].gte = startTime;
        if (endTime) rangeFilter.range[timestampField].lte = endTime;
        
        query.query.bool.filter.push(rangeFilter);
      }
      
      // Use the index pattern for traces
      const indexPattern = 'traces-*';
      const response = await this.request('POST', `/${indexPattern}/_search`, query);
      
      if (!response.aggregations || !response.aggregations.services) {
        return [];
      }
      
      // Extract services from aggregation
      const services = response.aggregations.services.buckets.map((bucket: any) => ({
        name: bucket.key,
        count: bucket.doc_count
      }));
      
      return services;
    } catch (error: any) {
      logger.error('[OpenSearch TracesAdapter] Error getting services', { error });
      return [];
    }
  }
  
  /**
   * Analyze how service dependencies have evolved between two time periods
   * This leverages OpenSearch's ML capabilities for dependency analysis
   * @param startTime1 Start time for first time range
   * @param endTime1 End time for first time range
   * @param startTime2 Start time for second time range
   * @param endTime2 End time for second time range
   * @param options Additional options for the analysis
   */
  public async analyzeDependencyEvolution(
    startTime1: string,
    endTime1: string,
    startTime2: string,
    endTime2: string,
    options: {
      service?: string;
      queryString?: string;
      minCallCount?: number;
      significantChangeThreshold?: number;
      errorRateChangeThreshold?: number;
      // Embedding configuration
      useEmbeddings?: boolean;
      embeddingProviderConfig?: import('../ml/embeddingProvider.js').EmbeddingProviderConfig;
    } = {}
  ): Promise<any> {
    logger.info('[TracesAdapter] Analyzing dependency evolution', {
      startTime1,
      endTime1,
      startTime2,
      endTime2,
      options
    });
    
    try {
      // Use the DependencyEvolutionAnalysis adapter for implementation
      return this.dependencyEvolution.analyzeDependencyEvolution(
        startTime1,
        endTime1,
        startTime2,
        endTime2,
        options
      );
    } catch (error: any) {
      logger.error('[TracesAdapter] Error analyzing dependency evolution', {
        error: error.message,
        stack: error.stack,
        startTime1,
        endTime1,
        startTime2,
        endTime2,
        options
      });
      
      throw error;
    }
  }
  
  /**
   * Cluster trace attributes
   * 
   * @param attributeKey Attribute key to cluster
   * @param startTime Start time (ISO8601)
   * @param endTime End time (ISO8601)
   * @param options Clustering options
   * @returns Clustering results
   */
  public async clusterTraceAttributes(
    attributeKey: string,
    startTime: string,
    endTime: string,
    options: {
      service?: string;
      queryString?: string;
      clusterCount?: number;
      minClusterSize?: number;
      includeOutliers?: boolean;
      // Sampling parameters for embedding generation
      enableSampling?: boolean;
      samplingPercent?: number;
      maxSamples?: number;
      embeddingBatchSize?: number;
      // Embedding provider configuration
      embeddingProviderConfig?: import('../ml/embeddingProvider.js').EmbeddingProviderConfig;
    } = {}
  ): Promise<any> {
    logger.info('[TracesAdapter] Clustering trace attributes', {
      attributeKey,
      startTime,
      endTime,
      options
    });
    
    try {
      // Import the TraceAttributeClustering dynamically to avoid circular dependencies
      const { TraceAttributeClustering } = await import('./clustering/index.js');
      return await TraceAttributeClustering.clusterTraceAttributes(
        this.core,
        attributeKey,
        startTime,
        endTime,
        options
      );
    } catch (error: any) {
      logger.error('[TracesAdapter] Error clustering trace attributes', {
        error: error.message || String(error),
        attributeKey
      });
      throw error;
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
                      field: "service.name"
                    }
                  }
                },
                {
                  child_service: {
                    terms: {
                      field: "service.name"
                    }
                  }
                }
              ]
            },
            aggs: {
              error_count: {
                filter: {
                  term: {
                    "span.status.code": "ERROR" // Error status in OpenTelemetry
                  }
                }
              }
            }
          },
          span_count: {
            value_count: {
              field: "span.id"
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
