import { logger } from '../../../../utils/logger.js';
import { TracesAdapterCore } from '../core/adapter.js';

/**
 * Service Dependency Analysis using OpenSearch's ML capabilities
 * Detects anomalies in service dependency patterns
 */
export class ServiceDependencyAnalysis {
  /**
   * Detect anomalies in service dependency patterns
   * @param client The OpenSearch client to use for requests
   * @param startTime The start time for the analysis window
   * @param endTime The end time for the analysis window
   * @param options Additional options for anomaly detection
   */
  public static async detectDependencyAnomalies(
    client: TracesAdapterCore,
    startTime: string,
    endTime: string,
    options: {
      service?: string;
      maxResults?: number;
      minCallCount?: number;
      includeTraceIds?: boolean;
    } = {}
  ): Promise<any> {
    logger.info('[ServiceDependencyAnalysis] Detecting dependency anomalies', { 
      startTime, 
      endTime, 
      options 
    });
    
    try {
      // Default options
      const maxResults = options.maxResults || 20;
      const minCallCount = options.minCallCount || 5;
      const includeTraceIds = options.includeTraceIds !== undefined ? options.includeTraceIds : true;
      
      // First, build the service dependency graph
      const dependencyGraph = await this.buildServiceDependencyGraph(
        client,
        startTime,
        endTime,
        options
      );
      
      if (dependencyGraph.error) {
        return dependencyGraph;
      }
      
      // Extract the edges from the dependency graph
      const edges = dependencyGraph.edges || [];
      
      // Filter edges by minimum call count
      const filteredEdges = edges.filter((edge: any) => edge.callCount >= minCallCount);
      
      if (filteredEdges.length === 0) {
        return { 
          anomalies: [], 
          message: 'No service dependencies found with sufficient call count'
        };
      }
      
      // Calculate baseline metrics for each edge
      const edgeMetrics = filteredEdges.map((edge: any) => ({
        source: edge.source,
        target: edge.target,
        callCount: edge.callCount,
        errorCount: edge.errorCount,
        errorRate: edge.errorRate,
        avgDuration: edge.avgDuration,
        p95Duration: edge.p95Duration
      }));
      
      // Use OpenSearch's ML plugin for anomaly detection
      const mlEndpoint = '/_plugins/_ml';
      
      // Convert edge metrics to feature vectors
      const featureVectors = edgeMetrics.map((edge: any) => [
        edge.errorRate,
        edge.avgDuration,
        edge.p95Duration
      ]);
      
      // Use isolation forest for anomaly detection
      const isolationForestRequest = {
        algorithm: 'isolation_forest',
        parameters: {
          contamination: 0.1, // Expect 10% of edges to be anomalous
          n_estimators: 100,
          max_samples: 'auto',
          max_features: 1.0
        },
        input_data: {
          feature_vectors: featureVectors
        }
      };
      
      const isolationForestResponse = await client.request('POST', `${mlEndpoint}/execute_outlier`, isolationForestRequest);
      
      if (!isolationForestResponse.outlier_result || !isolationForestResponse.outlier_result.outlier_scores) {
        return { 
          anomalies: [], 
          error: 'Failed to get anomaly detection results',
          message: 'OpenSearch ML plugin failed to detect anomalies'
        };
      }
      
      // Process the anomaly scores
      const anomalyScores = isolationForestResponse.outlier_result.outlier_scores;
      
      // Identify anomalies (higher score = more anomalous)
      const anomalies = [];
      
      for (let i = 0; i < edgeMetrics.length; i++) {
        if (i < anomalyScores.length) {
          const edge = edgeMetrics[i];
          const anomalyScore = anomalyScores[i];
          
          // Higher score indicates more anomalous
          if (anomalyScore > 0.5) {
            const anomaly: any = {
              source: edge.source,
              target: edge.target,
              callCount: edge.callCount,
              errorCount: edge.errorCount,
              errorRate: edge.errorRate,
              avgDuration: edge.avgDuration,
              p95Duration: edge.p95Duration,
              anomalyScore
            };
            
            // Include trace IDs if requested
            if (includeTraceIds) {
              // Find the original edge to get trace IDs
              const originalEdge = filteredEdges.find((e: any) => 
                e.source === edge.source && e.target === edge.target
              );
              
              if (originalEdge && originalEdge.traceIds) {
                anomaly.traceIds = originalEdge.traceIds.slice(0, 10); // Limit to 10 trace IDs
              }
            }
            
            // Determine anomaly type
            if (edge.errorRate > 0.1) {
              anomaly.anomalyType = 'high_error_rate';
            } else if (edge.p95Duration > 1000) {
              anomaly.anomalyType = 'high_latency';
            } else {
              anomaly.anomalyType = 'unusual_pattern';
            }
            
            anomalies.push(anomaly);
          }
        }
      }
      
      // Sort anomalies by score (descending)
      anomalies.sort((a: any, b: any) => b.anomalyScore - a.anomalyScore);
      
      return {
        anomalies: anomalies.slice(0, maxResults),
        dependencyGraph: {
          nodeCount: dependencyGraph.nodes.length,
          edgeCount: filteredEdges.length
        },
        summary: {
          totalEdges: filteredEdges.length,
          anomalyCount: anomalies.length,
          anomalyRate: filteredEdges.length > 0 ? anomalies.length / filteredEdges.length : 0,
          avgAnomalyScore: anomalies.length > 0 
            ? anomalies.reduce((sum: number, anomaly: any) => sum + anomaly.anomalyScore, 0) / anomalies.length 
            : 0
        },
        message: `Detected ${anomalies.length} anomalous service dependencies`
      };
    } catch (error: any) {
      logger.error('[ServiceDependencyAnalysis] Error detecting dependency anomalies', { error });
      return { 
        anomalies: [], 
        error: error.message || String(error),
        message: 'Failed to detect dependency anomalies'
      };
    }
  }
  
  /**
   * Build a service dependency graph from trace data
   * @param client The OpenSearch client to use for requests
   * @param startTime The start time for the analysis window
   * @param endTime The end time for the analysis window
   * @param options Additional options for graph building
   */
  private static async buildServiceDependencyGraph(
    client: TracesAdapterCore,
    startTime: string,
    endTime: string,
    options: {
      service?: string;
      includeTraceIds?: boolean;
    } = {}
  ): Promise<any> {
    logger.info('[ServiceDependencyAnalysis] Building service dependency graph', { 
      startTime, 
      endTime, 
      options 
    });
    
    try {
      const includeTraceIds = options.includeTraceIds !== undefined ? options.includeTraceIds : true;
      
      // Get all spans within the time range
      const indexPattern = 'traces-*';
      const spansQuery: any = {
        query: {
          bool: {
            filter: [
              {
                range: {
                  'start_time': {
                    gte: startTime,
                    lte: endTime
                  }
                }
              }
            ]
          }
        },
        size: 10000, // Get up to 10000 spans
        _source: includeTraceIds 
          ? ['span_id', 'trace_id', 'parent_span_id', 'service.name', 'duration', 'status.code'] 
          : ['span_id', 'parent_span_id', 'service.name', 'duration', 'status.code']
      };
      
      // Add service filter if specified
      if (options.service) {
        spansQuery.query.bool.filter.push({
          term: {
            'service.name': options.service
          }
        });
      }
      
      const spansResponse = await client.request('POST', `/${indexPattern}/_search`, spansQuery);
      
      if (!spansResponse.hits || !spansResponse.hits.hits || spansResponse.hits.hits.length === 0) {
        return { 
          nodes: [], 
          edges: [], 
          message: 'No spans found in the specified time range'
        };
      }
      
      const spans = spansResponse.hits.hits.map((hit: any) => hit._source);
      
      // Build the graph structure
      const nodes: Record<string, any> = {};
      const edges: Record<string, any> = {};
      
      // Create nodes for each service
      for (const span of spans) {
        const serviceKey = span.service?.name || 'unknown';
        
        if (!nodes[serviceKey]) {
          nodes[serviceKey] = {
            id: serviceKey,
            name: serviceKey,
            spanCount: 0,
            errorCount: 0,
            durations: []
          };
        }
        
        nodes[serviceKey].spanCount++;
        
        // Check if this is an error span
        if (span.status?.code === 2) { // 2 = ERROR in OpenTelemetry
          nodes[serviceKey].errorCount++;
        }
        
        // Add duration for statistics
        if (span.duration) {
          nodes[serviceKey].durations.push(span.duration);
        }
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
              const edgeKey = `${sourceKey}|${targetKey}`;
              
              if (!edges[edgeKey]) {
                edges[edgeKey] = {
                  source: sourceKey,
                  target: targetKey,
                  callCount: 0,
                  errorCount: 0,
                  durations: [],
                  traceIds: []
                };
              }
              
              edges[edgeKey].callCount++;
              
              // Check if this is an error span
              if (span.status?.code === 2) { // 2 = ERROR in OpenTelemetry
                edges[edgeKey].errorCount++;
              }
              
              // Add duration for statistics
              if (span.duration) {
                edges[edgeKey].durations.push(span.duration);
              }
              
              // Add trace ID if requested
              if (includeTraceIds && span.trace_id && !edges[edgeKey].traceIds.includes(span.trace_id)) {
                edges[edgeKey].traceIds.push(span.trace_id);
              }
            }
          }
        }
      }
      
      // Calculate statistics for nodes
      for (const nodeKey in nodes) {
        const node = nodes[nodeKey];
        const durations = node.durations;
        
        node.errorRate = node.spanCount > 0 ? node.errorCount / node.spanCount : 0;
        node.avgDuration = durations.length > 0 
          ? durations.reduce((sum: number, duration: number) => sum + duration, 0) / durations.length 
          : 0;
        
        // Calculate p95 duration
        if (durations.length > 0) {
          durations.sort((a: number, b: number) => a - b);
          const p95Index = Math.floor(durations.length * 0.95);
          node.p95Duration = durations[p95Index];
        } else {
          node.p95Duration = 0;
        }
        
        // Remove the raw durations to reduce response size
        delete node.durations;
      }
      
      // Calculate statistics for edges
      for (const edgeKey in edges) {
        const edge = edges[edgeKey];
        const durations = edge.durations;
        
        edge.errorRate = edge.callCount > 0 ? edge.errorCount / edge.callCount : 0;
        edge.avgDuration = durations.length > 0 
          ? durations.reduce((sum: number, duration: number) => sum + duration, 0) / durations.length 
          : 0;
        
        // Calculate p95 duration
        if (durations.length > 0) {
          durations.sort((a: number, b: number) => a - b);
          const p95Index = Math.floor(durations.length * 0.95);
          edge.p95Duration = durations[p95Index];
        } else {
          edge.p95Duration = 0;
        }
        
        // Remove the raw durations to reduce response size
        delete edge.durations;
      }
      
      return {
        nodes: Object.values(nodes),
        edges: Object.values(edges),
        summary: {
          nodeCount: Object.keys(nodes).length,
          edgeCount: Object.keys(edges).length,
          spanCount: spans.length
        },
        message: `Built service dependency graph with ${Object.keys(nodes).length} nodes and ${Object.keys(edges).length} edges`
      };
    } catch (error: any) {
      logger.error('[ServiceDependencyAnalysis] Error building service dependency graph', { error });
      return { 
        nodes: [], 
        edges: [], 
        error: error.message || String(error),
        message: 'Failed to build service dependency graph'
      };
    }
  }
  
  /**
   * Detect changes in service dependency patterns over time
   * @param client The OpenSearch client to use for requests
   * @param startTime The start time for the analysis window
   * @param endTime The end time for the analysis window
   * @param options Additional options for change detection
   */
  public static async detectDependencyChanges(
    client: TracesAdapterCore,
    startTime: string,
    endTime: string,
    options: {
      service?: string;
      interval?: string;
      minChangePercent?: number;
      maxResults?: number;
    } = {}
  ): Promise<any> {
    logger.info('[ServiceDependencyAnalysis] Detecting dependency changes', { 
      startTime, 
      endTime, 
      options 
    });
    
    try {
      // Default options
      const interval = options.interval || '1h';
      const minChangePercent = options.minChangePercent || 20;
      const maxResults = options.maxResults || 20;
      
      // Split the time range into intervals
      const startDate = new Date(startTime);
      const endDate = new Date(endTime);
      const intervalMs = this.parseInterval(interval);
      
      const intervals = [];
      let currentDate = new Date(startDate);
      
      while (currentDate < endDate) {
        const intervalStart = new Date(currentDate);
        currentDate = new Date(currentDate.getTime() + intervalMs);
        const intervalEnd = new Date(Math.min(currentDate.getTime(), endDate.getTime()));
        
        intervals.push({
          start: intervalStart.toISOString(),
          end: intervalEnd.toISOString()
        });
      }
      
      if (intervals.length < 2) {
        return { 
          changes: [], 
          error: 'Time range too small for change detection',
          message: 'Please provide a larger time range for detecting dependency changes'
        };
      }
      
      // Build dependency graph for each interval
      const intervalGraphs = [];
      
      for (const interval of intervals) {
        const graph = await this.buildServiceDependencyGraph(
          client,
          interval.start,
          interval.end,
          { service: options.service, includeTraceIds: false }
        );
        
        if (!graph.error) {
          intervalGraphs.push({
            start: interval.start,
            end: interval.end,
            graph
          });
        }
      }
      
      if (intervalGraphs.length < 2) {
        return { 
          changes: [], 
          message: 'Not enough valid intervals for change detection'
        };
      }
      
      // Detect changes in dependency patterns
      const changes = [];
      
      // Compare each interval with the next
      for (let i = 0; i < intervalGraphs.length - 1; i++) {
        const currentGraph = intervalGraphs[i].graph;
        const nextGraph = intervalGraphs[i + 1].graph;
        
        // Check for new or removed edges
        const currentEdges = this.mapEdgesToKeys(currentGraph.edges);
        const nextEdges = this.mapEdgesToKeys(nextGraph.edges);
        
        // Find new edges
        for (const edgeKey in nextEdges) {
          if (!currentEdges[edgeKey]) {
            changes.push({
              type: 'new_edge',
              intervalStart: intervalGraphs[i + 1].start,
              intervalEnd: intervalGraphs[i + 1].end,
              source: nextEdges[edgeKey].source,
              target: nextEdges[edgeKey].target,
              callCount: nextEdges[edgeKey].callCount,
              errorRate: nextEdges[edgeKey].errorRate,
              avgDuration: nextEdges[edgeKey].avgDuration
            });
          }
        }
        
        // Find removed edges
        for (const edgeKey in currentEdges) {
          if (!nextEdges[edgeKey]) {
            changes.push({
              type: 'removed_edge',
              intervalStart: intervalGraphs[i].start,
              intervalEnd: intervalGraphs[i].end,
              source: currentEdges[edgeKey].source,
              target: currentEdges[edgeKey].target,
              callCount: currentEdges[edgeKey].callCount,
              errorRate: currentEdges[edgeKey].errorRate,
              avgDuration: currentEdges[edgeKey].avgDuration
            });
          }
        }
        
        // Check for significant changes in existing edges
        for (const edgeKey in currentEdges) {
          if (nextEdges[edgeKey]) {
            const currentEdge = currentEdges[edgeKey];
            const nextEdge = nextEdges[edgeKey];
            
            // Calculate percent changes
            const callCountChange = currentEdge.callCount > 0 
              ? ((nextEdge.callCount - currentEdge.callCount) / currentEdge.callCount) * 100 
              : 0;
            
            const errorRateChange = currentEdge.errorRate > 0 
              ? ((nextEdge.errorRate - currentEdge.errorRate) / currentEdge.errorRate) * 100 
              : (nextEdge.errorRate > 0 ? 100 : 0);
            
            const durationChange = currentEdge.avgDuration > 0 
              ? ((nextEdge.avgDuration - currentEdge.avgDuration) / currentEdge.avgDuration) * 100 
              : 0;
            
            // Check if any change exceeds the threshold
            if (Math.abs(callCountChange) >= minChangePercent || 
                Math.abs(errorRateChange) >= minChangePercent || 
                Math.abs(durationChange) >= minChangePercent) {
              
              // Determine the most significant change
              let changeType = 'traffic_change';
              let changeValue = callCountChange;
              
              if (Math.abs(errorRateChange) > Math.abs(callCountChange) && 
                  Math.abs(errorRateChange) > Math.abs(durationChange)) {
                changeType = 'error_rate_change';
                changeValue = errorRateChange;
              } else if (Math.abs(durationChange) > Math.abs(callCountChange) && 
                         Math.abs(durationChange) > Math.abs(errorRateChange)) {
                changeType = 'latency_change';
                changeValue = durationChange;
              }
              
              changes.push({
                type: changeType,
                intervalStart: intervalGraphs[i + 1].start,
                intervalEnd: intervalGraphs[i + 1].end,
                source: currentEdge.source,
                target: currentEdge.target,
                changePercent: changeValue,
                before: {
                  callCount: currentEdge.callCount,
                  errorRate: currentEdge.errorRate,
                  avgDuration: currentEdge.avgDuration
                },
                after: {
                  callCount: nextEdge.callCount,
                  errorRate: nextEdge.errorRate,
                  avgDuration: nextEdge.avgDuration
                }
              });
            }
          }
        }
      }
      
      // Sort changes by absolute change percent (descending)
      changes.sort((a: any, b: any) => {
        if (a.changePercent !== undefined && b.changePercent !== undefined) {
          return Math.abs(b.changePercent) - Math.abs(a.changePercent);
        }
        return 0;
      });
      
      return {
        changes: changes.slice(0, maxResults),
        intervals: intervals.length,
        summary: {
          totalChanges: changes.length,
          newEdges: changes.filter((c: any) => c.type === 'new_edge').length,
          removedEdges: changes.filter((c: any) => c.type === 'removed_edge').length,
          trafficChanges: changes.filter((c: any) => c.type === 'traffic_change').length,
          errorRateChanges: changes.filter((c: any) => c.type === 'error_rate_change').length,
          latencyChanges: changes.filter((c: any) => c.type === 'latency_change').length
        },
        message: `Detected ${changes.length} changes in service dependencies`
      };
    } catch (error: any) {
      logger.error('[ServiceDependencyAnalysis] Error detecting dependency changes', { error });
      return { 
        changes: [], 
        error: error.message || String(error),
        message: 'Failed to detect dependency changes'
      };
    }
  }
  
  /**
   * Map edges to a key-value object for easy lookup
   * @param edges Array of edges
   */
  private static mapEdgesToKeys(edges: any[]): Record<string, any> {
    const edgeMap: Record<string, any> = {};
    
    for (const edge of edges) {
      const key = `${edge.source}|${edge.target}`;
      edgeMap[key] = edge;
    }
    
    return edgeMap;
  }
  
  /**
   * Parse interval string to milliseconds
   * @param interval Interval string (e.g., '1h', '30m')
   */
  private static parseInterval(interval: string): number {
    const match = interval.match(/^(\d+)([smhd])$/);
    if (!match) return 3600000; // Default to 1 hour
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60000;
      case 'h': return value * 3600000;
      case 'd': return value * 86400000;
      default: return 3600000;
    }
  }
}
