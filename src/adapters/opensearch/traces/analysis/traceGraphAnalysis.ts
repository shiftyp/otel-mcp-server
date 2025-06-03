import { logger } from '../../../../utils/logger.js';
import { TracesAdapterCore } from '../core/adapter.js';

/**
 * Trace Graph Analysis using OpenSearch's graph capabilities
 * Analyzes trace data as a graph to identify critical paths and bottlenecks
 */
export class TraceGraphAnalysis {
  /**
   * Analyze trace data as a graph using OpenSearch's graph capabilities
   * Identifies critical paths and bottlenecks in distributed traces
   * @param client The OpenSearch client to use for requests
   * @param traceId The trace ID to analyze
   * @param options Additional options for graph analysis
   */
  public static async analyzeTraceGraph(
    client: TracesAdapterCore,
    traceId: string,
    options: {
      includeAttributes?: boolean;
      maxPathLength?: number;
      minDuration?: number;
    } = {}
  ): Promise<any> {
    logger.info('[TraceGraphAnalysis] Analyzing trace graph', { traceId, options });
    
    try {
      // Default options
      const includeAttributes = options.includeAttributes !== undefined ? options.includeAttributes : true;
      const maxPathLength = options.maxPathLength || 20;
      const minDuration = options.minDuration || 0;
      
      // First, get all spans for the trace
      const indexPattern = 'traces-*';
      const spansQuery = {
        query: {
          term: {
            'trace_id': traceId
          }
        },
        size: 1000, // Assuming traces won't have more than 1000 spans
        sort: [
          { 'start_time': { order: 'asc' } }
        ]
      };
      
      const spansResponse = await client.request('POST', `/${indexPattern}/_search`, spansQuery);
      
      if (!spansResponse.hits || !spansResponse.hits.hits || spansResponse.hits.hits.length === 0) {
        return { error: 'Trace not found', message: `No spans found for trace ID ${traceId}` };
      }
      
      const spans = spansResponse.hits.hits.map((hit: any) => hit._source);
      
      // Build the graph structure
      const nodes: Record<string, any> = {};
      const edges: Array<{
        source: string;
        target: string;
        duration: number;
        spanId: string;
      }> = [];
      
      // Create nodes for each service
      for (const span of spans) {
        const serviceKey = span.service?.name || 'unknown';
        
        if (!nodes[serviceKey]) {
          nodes[serviceKey] = {
            id: serviceKey,
            name: serviceKey,
            type: 'service',
            spanCount: 0,
            totalDuration: 0,
            avgDuration: 0,
            maxDuration: 0,
            spans: []
          };
        }
        
        const duration = span.duration || 0;
        nodes[serviceKey].spanCount++;
        nodes[serviceKey].totalDuration += duration;
        nodes[serviceKey].maxDuration = Math.max(nodes[serviceKey].maxDuration, duration);
        
        if (includeAttributes) {
          nodes[serviceKey].spans.push({
            id: span.span_id,
            name: span.name,
            duration,
            startTime: span.start_time,
            attributes: span.attributes || {}
          });
        }
      }
      
      // Calculate average durations
      for (const nodeKey in nodes) {
        const node = nodes[nodeKey];
        node.avgDuration = node.spanCount > 0 ? node.totalDuration / node.spanCount : 0;
      }
      
      // Create edges based on parent-child relationships
      for (const span of spans) {
        if (span.parent_span_id) {
          // Find the parent span
          const parentSpan = spans.find((s: any) => s.span_id === span.parent_span_id);
          
          if (parentSpan) {
            const sourceKey = parentSpan.service?.name || 'unknown';
            const targetKey = span.service?.name || 'unknown';
            
            // Only create edges between different services
            if (sourceKey !== targetKey) {
              edges.push({
                source: sourceKey,
                target: targetKey,
                duration: span.duration || 0,
                spanId: span.span_id
              });
            }
          }
        }
      }
      
      // Find critical paths using OpenSearch's graph algorithms
      // OpenSearch doesn't have built-in graph algorithms, so we'll implement a simple one
      
      // Find all paths from root spans to leaf spans
      const rootSpans = spans.filter((span: any) => !span.parent_span_id || !spans.some((s: any) => s.span_id === span.parent_span_id));
      const leafSpans = spans.filter((span: any) => !spans.some((s: any) => s.parent_span_id === span.span_id));
      
      // Build a map of span IDs to their children
      const spanChildren: Record<string, string[]> = {};
      for (const span of spans) {
        if (span.parent_span_id) {
          if (!spanChildren[span.parent_span_id]) {
            spanChildren[span.parent_span_id] = [];
          }
          spanChildren[span.parent_span_id].push(span.span_id);
        }
      }
      
      // Find all paths using DFS
      const allPaths: Array<{
        path: string[];
        duration: number;
        spanIds: string[];
      }> = [];
      
      const findPaths = (
        currentSpanId: string,
        currentPath: string[] = [],
        currentDuration: number = 0,
        currentSpanIds: string[] = []
      ) => {
        const currentSpan = spans.find((s: any) => s.span_id === currentSpanId);
        if (!currentSpan) return;
        
        const serviceKey = currentSpan.service?.name || 'unknown';
        const newPath = [...currentPath, serviceKey];
        const newDuration = currentDuration + (currentSpan.duration || 0);
        const newSpanIds = [...currentSpanIds, currentSpanId];
        
        // Check if this is a leaf span
        if (!spanChildren[currentSpanId] || spanChildren[currentSpanId].length === 0) {
          allPaths.push({
            path: newPath,
            duration: newDuration,
            spanIds: newSpanIds
          });
          return;
        }
        
        // Continue DFS for each child
        for (const childId of spanChildren[currentSpanId] || []) {
          // Avoid cycles
          if (!currentSpanIds.includes(childId)) {
            findPaths(childId, newPath, newDuration, newSpanIds);
          }
        }
      };
      
      // Start DFS from each root span
      for (const rootSpan of rootSpans) {
        findPaths(rootSpan.span_id);
      }
      
      // Filter and sort paths
      const filteredPaths = allPaths
        .filter(path => path.path.length <= maxPathLength && path.duration >= minDuration)
        .sort((a, b) => b.duration - a.duration);
      
      // Identify bottlenecks (services that appear in many critical paths)
      const serviceFrequency: Record<string, number> = {};
      for (const path of filteredPaths) {
        for (const service of path.path) {
          serviceFrequency[service] = (serviceFrequency[service] || 0) + 1;
        }
      }
      
      // Sort services by frequency
      const bottlenecks = Object.entries(serviceFrequency)
        .map(([service, frequency]) => ({
          service,
          frequency,
          avgDuration: nodes[service]?.avgDuration || 0,
          maxDuration: nodes[service]?.maxDuration || 0
        }))
        .sort((a, b) => b.frequency - a.frequency);
      
      return {
        traceId,
        nodes: Object.values(nodes),
        edges,
        criticalPaths: filteredPaths.slice(0, 5), // Top 5 critical paths
        bottlenecks: bottlenecks.slice(0, 5), // Top 5 bottlenecks
        summary: {
          spanCount: spans.length,
          serviceCount: Object.keys(nodes).length,
          rootSpans: rootSpans.length,
          leafSpans: leafSpans.length,
          criticalPathCount: filteredPaths.length,
          maxPathDuration: filteredPaths.length > 0 ? filteredPaths[0].duration : 0
        },
        message: `Analyzed trace graph for trace ID ${traceId}`
      };
    } catch (error: any) {
      logger.error('[TraceGraphAnalysis] Error analyzing trace graph', { error, traceId });
      return { 
        error: error.message || String(error),
        message: `Failed to analyze trace graph for trace ID ${traceId}`
      };
    }
  }
  
  /**
   * Find similar traces based on graph structure
   * @param client The OpenSearch client to use for requests
   * @param traceId The reference trace ID
   * @param options Additional options for similarity search
   */
  public static async findSimilarTraces(
    client: TracesAdapterCore,
    traceId: string,
    options: {
      startTime?: string;
      endTime?: string;
      maxResults?: number;
      minSimilarity?: number;
    } = {}
  ): Promise<any> {
    logger.info('[TraceGraphAnalysis] Finding similar traces', { traceId, options });
    
    try {
      // Default options
      const maxResults = options.maxResults || 10;
      const minSimilarity = options.minSimilarity || 0.7;
      
      // First, analyze the reference trace
      const referenceGraph = await TraceGraphAnalysis.analyzeTraceGraph(client, traceId);
      
      if (referenceGraph.error) {
        return referenceGraph;
      }
      
      // Get the service path signature of the reference trace
      const referenceSignature: any[] = referenceGraph.criticalPaths.map((path: any) => path.path.join('->'));
      
      // Find other traces within the time range
      const indexPattern = 'traces-*';
      const tracesQuery: any = {
        query: {
          bool: {
            must_not: [
              { term: { 'trace_id': traceId } } // Exclude the reference trace
            ],
            filter: []
          }
        },
        size: 0,
        aggs: {
          traces: {
            terms: {
              field: 'trace_id',
              size: 100 // Get top 100 traces
            }
          }
        }
      };
      
      // Add time range if specified
      if (options.startTime && options.endTime) {
        tracesQuery.query.bool.filter.push({
          range: {
            'start_time': {
              gte: options.startTime,
              lte: options.endTime
            }
          }
        });
      }
      
      const tracesResponse = await client.request('POST', `/${indexPattern}/_search`, tracesQuery);
      
      if (!tracesResponse.aggregations?.traces?.buckets || tracesResponse.aggregations.traces.buckets.length === 0) {
        return { 
          similarTraces: [],
          message: 'No other traces found for comparison'
        };
      }
      
      // Get the trace IDs to compare
      const traceIds = tracesResponse.aggregations.traces.buckets.map((bucket: any) => bucket.key);
      
      // Analyze each trace and calculate similarity
      const similarityResults = [];
      
      for (const candidateTraceId of traceIds) {
        const candidateGraph = await TraceGraphAnalysis.analyzeTraceGraph(client, candidateTraceId);
        
        if (candidateGraph.error) {
          continue;
        }
        
        // Get the service path signature of the candidate trace
        const candidateSignature = candidateGraph.criticalPaths.map((path: any) => path.path.join('->'));
        
        // Calculate Jaccard similarity between the signatures
        const intersection = referenceSignature.filter(path => candidateSignature.includes(path)).length;
        const union = new Set([...referenceSignature, ...candidateSignature]).size;
        const similarity = union > 0 ? intersection / union : 0;
        
        if (similarity >= minSimilarity) {
          similarityResults.push({
            traceId: candidateTraceId,
            similarity,
            serviceCount: candidateGraph.summary.serviceCount,
            spanCount: candidateGraph.summary.spanCount,
            maxPathDuration: candidateGraph.summary.maxPathDuration
          });
        }
      }
      
      // Sort by similarity (descending)
      similarityResults.sort((a, b) => b.similarity - a.similarity);
      
      return {
        referenceTraceId: traceId,
        similarTraces: similarityResults.slice(0, maxResults),
        summary: {
          comparedTraces: traceIds.length,
          similarTraces: similarityResults.length,
          averageSimilarity: similarityResults.length > 0 
            ? similarityResults.reduce((sum, result) => sum + result.similarity, 0) / similarityResults.length 
            : 0
        },
        message: `Found ${similarityResults.length} similar traces to trace ID ${traceId}`
      };
    } catch (error: any) {
      logger.error('[TraceGraphAnalysis] Error finding similar traces', { error, traceId });
      return { 
        error: error.message || String(error),
        message: `Failed to find similar traces for trace ID ${traceId}`
      };
    }
  }
}
