import { logger } from '../../../../utils/logger.js';
import { TracesAdapterCore } from '../core/adapter.js';
import { ServiceNode, DependencyPath } from './dependencyAnalyzer.js';
import { Trace } from './traceAnalyzer.js';

/**
 * Graph analysis options
 */
export interface GraphAnalysisOptions {
  timeRange?: { from: string; to: string };
  service?: string | string[];
  maxDepth?: number;
  includeMetrics?: boolean;
  limit?: number;
}

/**
 * Graph node with enhanced metrics
 */
export interface GraphNode {
  id: string;
  label: string;
  type: 'service' | 'database' | 'cache' | 'external';
  metrics: {
    requests: number;
    avgDuration: number;
    errorRate: number;
    throughput: number;
  };
  position?: { x: number; y: number };
  size: number;
  color: string;
}

/**
 * Graph edge representing dependency
 */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
  metrics: {
    callCount: number;
    avgDuration: number;
    errorRate: number;
    latencyP95: number;
  };
  style: {
    width: number;
    color: string;
    animated: boolean;
  };
}

/**
 * Service graph representation
 */
export interface ServiceGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: ServiceCluster[];
  metrics: {
    totalNodes: number;
    totalEdges: number;
    avgDegree: number;
    density: number;
    diameter: number;
  };
}

/**
 * Service cluster
 */
export interface ServiceCluster {
  id: string;
  name: string;
  services: string[];
  cohesion: number;
  coupling: number;
  description: string;
}

/**
 * Graph centrality metrics
 */
export interface CentralityMetrics {
  service: string;
  degreeCentrality: number;
  betweennessCentrality: number;
  closenessCentrality: number;
  eigenvectorCentrality: number;
  pageRank: number;
}

/**
 * Clean graph analysis for service topology
 */
export class GraphAnalyzer {
  constructor(private readonly adapter: TracesAdapterCore) {}

  /**
   * Build service dependency graph
   */
  public async buildServiceGraph(
    options: GraphAnalysisOptions = {}
  ): Promise<{
    graph: ServiceGraph;
    layout: {
      algorithm: string;
      parameters: Record<string, any>;
    };
    visualization: {
      nodes: Array<GraphNode & { x: number; y: number }>;
      edges: GraphEdge[];
      viewBox: { width: number; height: number };
    };
    insights: string[];
  }> {
    logger.info('[GraphAnalyzer] Building service graph', { options });

    try {
      // Fetch traces for analysis
      const traces = await this.fetchTraces(options);
      
      if (traces.length === 0) {
        return {
          graph: this.getEmptyGraph(),
          layout: { algorithm: 'force-directed', parameters: {} },
          visualization: { nodes: [], edges: [], viewBox: { width: 800, height: 600 } },
          insights: ['No traces found in the specified time range']
        };
      }

      // Build graph structure
      const { nodes, edges } = this.extractGraphElements(traces, options);
      
      // Detect clusters
      const clusters = this.detectServiceClusters(nodes, edges);
      
      // Calculate graph metrics
      const metrics = this.calculateGraphMetrics(nodes, edges);
      
      // Create graph object
      const graph: ServiceGraph = {
        nodes,
        edges,
        clusters,
        metrics
      };
      
      // Apply layout algorithm
      const layout = this.applyForceDirectedLayout(nodes, edges);
      
      // Create visualization
      const visualization = this.createVisualization(nodes, edges, layout);
      
      // Generate insights
      const insights = this.generateGraphInsights(graph);

      return {
        graph,
        layout: {
          algorithm: 'force-directed',
          parameters: {
            linkDistance: 100,
            chargeStrength: -300,
            centerStrength: 0.05
          }
        },
        visualization,
        insights
      };
    } catch (error) {
      logger.error('[GraphAnalyzer] Error building service graph', { error });
      throw error;
    }
  }

  /**
   * Calculate centrality metrics for services
   */
  public async calculateCentrality(
    options: GraphAnalysisOptions = {}
  ): Promise<{
    centrality: CentralityMetrics[];
    keyServices: Array<{
      service: string;
      role: string;
      importance: number;
      reason: string;
    }>;
    recommendations: Array<{
      service: string;
      recommendation: string;
      priority: 'high' | 'medium' | 'low';
    }>;
  }> {
    logger.info('[GraphAnalyzer] Calculating centrality metrics', { options });

    const traces = await this.fetchTraces(options);
    const { nodes, edges } = this.extractGraphElements(traces, options);
    
    // Build adjacency matrix
    const adjacencyMatrix = this.buildAdjacencyMatrix(nodes, edges);
    
    // Calculate various centrality metrics
    const centrality: CentralityMetrics[] = [];
    
    for (const node of nodes) {
      const metrics = {
        service: node.id,
        degreeCentrality: this.calculateDegreeCentrality(node.id, edges, nodes.length),
        betweennessCentrality: this.calculateBetweennessCentrality(node.id, nodes, edges),
        closenessCentrality: this.calculateClosenessCentrality(node.id, nodes, adjacencyMatrix),
        eigenvectorCentrality: this.calculateEigenvectorCentrality(node.id, adjacencyMatrix),
        pageRank: this.calculatePageRank(node.id, edges, nodes)
      };
      
      centrality.push(metrics);
    }
    
    // Identify key services based on centrality
    const keyServices = this.identifyKeyServices(centrality);
    
    // Generate recommendations
    const recommendations = this.generateCentralityRecommendations(centrality, keyServices);

    return {
      centrality: centrality.sort((a, b) => b.pageRank - a.pageRank),
      keyServices,
      recommendations
    };
  }

  /**
   * Analyze graph evolution over time
   */
  public async analyzeGraphEvolution(
    timeRange: { from: string; to: string },
    intervalSize: string = '1h',
    options: Omit<GraphAnalysisOptions, 'timeRange'> = {}
  ): Promise<{
    snapshots: Array<{
      timestamp: string;
      metrics: {
        nodes: number;
        edges: number;
        density: number;
        clustering: number;
      };
      changes: {
        addedNodes: string[];
        removedNodes: string[];
        addedEdges: Array<{ source: string; target: string }>;
        removedEdges: Array<{ source: string; target: string }>;
      };
    }>;
    trends: {
      growthRate: number;
      stabilityScore: number;
      complexityTrend: number;
    };
    predictions: {
      expectedNodes: number;
      expectedEdges: number;
      expectedDensity: number;
    };
  }> {
    logger.info('[GraphAnalyzer] Analyzing graph evolution', {
      timeRange,
      intervalSize
    });

    const intervals = this.generateTimeIntervals(timeRange, intervalSize);
    const snapshots: Array<any> = [];
    
    let previousNodes = new Set<string>();
    let previousEdges = new Set<string>();

    for (const interval of intervals) {
      const traces = await this.fetchTraces({
        ...options,
        timeRange: interval
      });

      const { nodes, edges } = this.extractGraphElements(traces, options);
      
      // Calculate metrics
      const metrics = {
        nodes: nodes.length,
        edges: edges.length,
        density: this.calculateDensity(nodes.length, edges.length),
        clustering: this.calculateClusteringCoefficient(nodes, edges)
      };

      // Track changes
      const currentNodes = new Set(nodes.map(n => n.id));
      const currentEdges = new Set(edges.map(e => `${e.source}->${e.target}`));
      
      const changes = {
        addedNodes: Array.from(currentNodes).filter(n => !previousNodes.has(n)),
        removedNodes: Array.from(previousNodes).filter(n => !currentNodes.has(n)),
        addedEdges: Array.from(currentEdges)
          .filter(e => !previousEdges.has(e))
          .map(e => {
            const [source, target] = e.split('->');
            return { source, target };
          }),
        removedEdges: Array.from(previousEdges)
          .filter(e => !currentEdges.has(e))
          .map(e => {
            const [source, target] = e.split('->');
            return { source, target };
          })
      };

      snapshots.push({
        timestamp: interval.from,
        metrics,
        changes
      });

      previousNodes = currentNodes;
      previousEdges = currentEdges;
    }

    // Calculate trends
    const trends = this.calculateEvolutionTrends(snapshots);
    
    // Make predictions
    const predictions = this.predictFutureState(snapshots, trends);

    return {
      snapshots,
      trends,
      predictions
    };
  }

  /**
   * Find optimal service groupings
   */
  public async findOptimalGroupings(
    options: GraphAnalysisOptions = {}
  ): Promise<{
    groupings: Array<{
      name: string;
      services: string[];
      cohesion: number;
      coupling: number;
      recommendation: string;
    }>;
    modularityScore: number;
    suggestions: Array<{
      type: 'merge' | 'split' | 'extract';
      services: string[];
      reason: string;
      expectedBenefit: number;
    }>;
  }> {
    logger.info('[GraphAnalyzer] Finding optimal service groupings', { options });

    const traces = await this.fetchTraces(options);
    const { nodes, edges } = this.extractGraphElements(traces, options);
    
    // Use community detection algorithm
    const communities = this.detectCommunities(nodes, edges);
    
    // Analyze each community
    const groupings = communities.map(community => {
      const cohesion = this.calculateCohesion(community.services, edges);
      const coupling = this.calculateCoupling(community.services, edges, nodes);
      
      return {
        name: community.name,
        services: community.services,
        cohesion,
        coupling,
        recommendation: this.generateGroupingRecommendation(cohesion, coupling)
      };
    });
    
    // Calculate modularity
    const modularityScore = this.calculateModularity(communities, edges, nodes);
    
    // Generate refactoring suggestions
    const suggestions = this.generateRefactoringSuggestions(groupings, edges);

    return {
      groupings,
      modularityScore,
      suggestions
    };
  }

  // Private helper methods

  private async fetchTraces(options: GraphAnalysisOptions): Promise<Trace[]> {
    const query: any = {
      size: 5000,
      query: { bool: { must: [], filter: [] } },
      sort: [{ startTime: { order: 'desc' } }]
    };

    if (options.timeRange) {
      query.query.bool.filter.push({
        range: {
          startTime: {
            gte: options.timeRange.from,
            lte: options.timeRange.to
          }
        }
      });
    }

    if (options.service) {
      const services = Array.isArray(options.service) ? options.service : [options.service];
      query.query.bool.filter.push({
        terms: { 'resource.service.name': services }
      });
    }

    const response = await this.adapter.searchTraces(query);
    
    // Process response to extract traces
    const traces: Trace[] = [];
    const spansByTrace = new Map<string, any[]>();
    
    for (const hit of response.hits?.hits || []) {
      const source = hit._source;
      const traceId = source.traceId || source.trace_id;
      
      if (!spansByTrace.has(traceId)) {
        spansByTrace.set(traceId, []);
      }
      spansByTrace.get(traceId)!.push(source);
    }
    
    for (const [traceId, spans] of spansByTrace) {
      traces.push({
        traceId,
        startTime: spans[0].startTime || spans[0].start_time,
        endTime: spans[0].endTime || spans[0].end_time,
        duration: spans[0].duration || 0,
        service: spans[0].resource?.service?.name || 'unknown',
        spans: spans.map(s => ({
          spanId: s.spanId || s.span_id,
          parentSpanId: s.parentSpanId || s.parent_span_id,
          traceId,
          name: s.name || s.operationName,
          service: s.resource?.service?.name || s.service?.name || 'unknown',
          startTime: s.startTime || s.start_time,
          endTime: s.endTime || s.end_time,
          duration: s.duration || 0,
          error: s.status?.code === 2 || s.error === true
        }))
      });
    }
    
    return traces;
  }

  private extractGraphElements(
    traces: Trace[],
    options: GraphAnalysisOptions
  ): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodeMap = new Map<string, GraphNode>();
    const edgeMap = new Map<string, GraphEdge>();

    for (const trace of traces) {
      if (!trace.spans) continue;

      // Build span relationships
      const spanMap = new Map<string, any>();
      for (const span of trace.spans) {
        spanMap.set(span.spanId, span);
      }

      for (const span of trace.spans) {
        // Add/update node
        if (!nodeMap.has(span.service)) {
          nodeMap.set(span.service, {
            id: span.service,
            label: span.service,
            type: this.inferServiceType(span),
            metrics: {
              requests: 0,
              avgDuration: 0,
              errorRate: 0,
              throughput: 0
            },
            size: 20,
            color: this.getNodeColor('service')
          });
        }

        const node = nodeMap.get(span.service)!;
        node.metrics.requests++;
        node.metrics.avgDuration = 
          (node.metrics.avgDuration * (node.metrics.requests - 1) + span.duration) / 
          node.metrics.requests;
        if (span.error) {
          node.metrics.errorRate = 
            (node.metrics.errorRate * (node.metrics.requests - 1) + 1) / 
            node.metrics.requests;
        }

        // Add edges for parent-child relationships
        if (span.parentSpanId) {
          const parentSpan = spanMap.get(span.parentSpanId);
          if (parentSpan && parentSpan.service !== span.service) {
            const edgeId = `${parentSpan.service}->${span.service}`;
            
            if (!edgeMap.has(edgeId)) {
              edgeMap.set(edgeId, {
                id: edgeId,
                source: parentSpan.service,
                target: span.service,
                weight: 0,
                metrics: {
                  callCount: 0,
                  avgDuration: 0,
                  errorRate: 0,
                  latencyP95: 0
                },
                style: {
                  width: 1,
                  color: '#999',
                  animated: false
                }
              });
            }

            const edge = edgeMap.get(edgeId)!;
            edge.metrics.callCount++;
            edge.metrics.avgDuration = 
              (edge.metrics.avgDuration * (edge.metrics.callCount - 1) + span.duration) / 
              edge.metrics.callCount;
            if (span.error) {
              edge.metrics.errorRate = 
                (edge.metrics.errorRate * (edge.metrics.callCount - 1) + 1) / 
                edge.metrics.callCount;
            }
          }
        }
      }
    }

    // Update node sizes and edge styles based on metrics
    for (const node of nodeMap.values()) {
      node.size = 20 + Math.min(node.metrics.requests / 100, 30);
      node.color = this.getNodeColor(node.type, node.metrics.errorRate);
    }

    for (const edge of edgeMap.values()) {
      edge.weight = edge.metrics.callCount;
      edge.style.width = Math.min(1 + edge.metrics.callCount / 100, 5);
      edge.style.color = this.getEdgeColor(edge.metrics.errorRate);
      edge.style.animated = edge.metrics.errorRate > 0.1;
    }

    return {
      nodes: Array.from(nodeMap.values()),
      edges: Array.from(edgeMap.values())
    };
  }

  private detectServiceClusters(
    nodes: GraphNode[],
    edges: GraphEdge[]
  ): ServiceCluster[] {
    // Simple clustering based on connectivity
    const clusters: ServiceCluster[] = [];
    const visited = new Set<string>();

    for (const node of nodes) {
      if (!visited.has(node.id)) {
        const cluster = this.dfsCluster(node.id, edges, visited);
        if (cluster.length > 1) {
          const cohesion = this.calculateCohesion(cluster, edges);
          const coupling = this.calculateCoupling(cluster, edges, nodes);
          
          clusters.push({
            id: `cluster-${clusters.length + 1}`,
            name: `Service Group ${clusters.length + 1}`,
            services: cluster,
            cohesion,
            coupling,
            description: this.describeCluster(cluster, nodes)
          });
        }
      }
    }

    return clusters;
  }

  private dfsCluster(
    nodeId: string,
    edges: GraphEdge[],
    visited: Set<string>
  ): string[] {
    if (visited.has(nodeId)) return [];
    
    visited.add(nodeId);
    const cluster = [nodeId];
    
    // Find connected nodes
    const connectedEdges = edges.filter(e => 
      e.source === nodeId || e.target === nodeId
    );
    
    for (const edge of connectedEdges) {
      const nextNode = edge.source === nodeId ? edge.target : edge.source;
      cluster.push(...this.dfsCluster(nextNode, edges, visited));
    }
    
    return cluster;
  }

  private calculateGraphMetrics(
    nodes: GraphNode[],
    edges: GraphEdge[]
  ): ServiceGraph['metrics'] {
    const n = nodes.length;
    const m = edges.length;
    
    // Calculate average degree
    const degrees = new Map<string, number>();
    for (const edge of edges) {
      degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1);
      degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1);
    }
    
    const avgDegree = Array.from(degrees.values()).reduce((a, b) => a + b, 0) / n;
    
    // Calculate density
    const maxEdges = n * (n - 1);
    const density = maxEdges > 0 ? m / maxEdges : 0;
    
    // Calculate diameter (simplified)
    const diameter = this.calculateGraphDiameter(nodes, edges);

    return {
      totalNodes: n,
      totalEdges: m,
      avgDegree,
      density,
      diameter
    };
  }

  private calculateGraphDiameter(
    nodes: GraphNode[],
    edges: GraphEdge[]
  ): number {
    // Simplified diameter calculation using BFS
    let maxDistance = 0;
    
    for (const startNode of nodes) {
      const distances = this.bfsDistances(startNode.id, nodes, edges);
      const nodeMaxDistance = Math.max(...Array.from(distances.values()));
      maxDistance = Math.max(maxDistance, nodeMaxDistance);
    }
    
    return maxDistance;
  }

  private bfsDistances(
    startId: string,
    nodes: GraphNode[],
    edges: GraphEdge[]
  ): Map<string, number> {
    const distances = new Map<string, number>();
    const queue = [startId];
    distances.set(startId, 0);
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentDistance = distances.get(current)!;
      
      const neighbors = edges
        .filter(e => e.source === current || e.target === current)
        .map(e => e.source === current ? e.target : e.source);
      
      for (const neighbor of neighbors) {
        if (!distances.has(neighbor)) {
          distances.set(neighbor, currentDistance + 1);
          queue.push(neighbor);
        }
      }
    }
    
    // Set infinite distance for unreachable nodes
    for (const node of nodes) {
      if (!distances.has(node.id)) {
        distances.set(node.id, Infinity);
      }
    }
    
    return distances;
  }

  private applyForceDirectedLayout(
    nodes: GraphNode[],
    edges: GraphEdge[]
  ): Record<string, { x: number; y: number }> {
    const layout: Record<string, { x: number; y: number }> = {};
    
    // Initialize random positions
    for (const node of nodes) {
      layout[node.id] = {
        x: Math.random() * 800,
        y: Math.random() * 600
      };
    }
    
    // Simple force-directed simulation (simplified)
    const iterations = 50;
    const k = Math.sqrt((800 * 600) / nodes.length);
    
    for (let i = 0; i < iterations; i++) {
      // Repulsive forces between all nodes
      for (const n1 of nodes) {
        for (const n2 of nodes) {
          if (n1.id !== n2.id) {
            const dx = layout[n1.id].x - layout[n2.id].x;
            const dy = layout[n1.id].y - layout[n2.id].y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist > 0) {
              const force = k * k / dist;
              layout[n1.id].x += (dx / dist) * force * 0.1;
              layout[n1.id].y += (dy / dist) * force * 0.1;
            }
          }
        }
      }
      
      // Attractive forces along edges
      for (const edge of edges) {
        const dx = layout[edge.target].x - layout[edge.source].x;
        const dy = layout[edge.target].y - layout[edge.source].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist > 0) {
          const force = dist * dist / k;
          const fx = (dx / dist) * force * 0.1;
          const fy = (dy / dist) * force * 0.1;
          
          layout[edge.source].x += fx;
          layout[edge.source].y += fy;
          layout[edge.target].x -= fx;
          layout[edge.target].y -= fy;
        }
      }
    }
    
    return layout;
  }

  private createVisualization(
    nodes: GraphNode[],
    edges: GraphEdge[],
    layout: Record<string, { x: number; y: number }>
  ): any {
    const visualNodes = nodes.map(node => ({
      ...node,
      x: layout[node.id].x,
      y: layout[node.id].y
    }));
    
    return {
      nodes: visualNodes,
      edges,
      viewBox: {
        width: 800,
        height: 600
      }
    };
  }

  private generateGraphInsights(graph: ServiceGraph): string[] {
    const insights: string[] = [];
    
    // Graph size insight
    insights.push(
      `Service topology contains ${graph.nodes.length} services with ${graph.edges.length} dependencies.`
    );
    
    // Density insight
    if (graph.metrics.density > 0.3) {
      insights.push('High service coupling detected - consider reducing dependencies.');
    } else if (graph.metrics.density < 0.1) {
      insights.push('Low service coupling - good microservice separation.');
    }
    
    // Cluster insight
    if (graph.clusters.length > 0) {
      insights.push(
        `Identified ${graph.clusters.length} service clusters that could be organized as bounded contexts.`
      );
    }
    
    // Error rate insight
    const highErrorNodes = graph.nodes.filter(n => n.metrics.errorRate > 0.05);
    if (highErrorNodes.length > 0) {
      insights.push(
        `${highErrorNodes.length} services have error rates above 5% and need attention.`
      );
    }
    
    return insights;
  }

  private buildAdjacencyMatrix(
    nodes: GraphNode[],
    edges: GraphEdge[]
  ): number[][] {
    const n = nodes.length;
    const matrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
    const nodeIndex = new Map<string, number>();
    
    nodes.forEach((node, i) => nodeIndex.set(node.id, i));
    
    for (const edge of edges) {
      const i = nodeIndex.get(edge.source)!;
      const j = nodeIndex.get(edge.target)!;
      matrix[i][j] = edge.weight;
    }
    
    return matrix;
  }

  private calculateDegreeCentrality(
    nodeId: string,
    edges: GraphEdge[],
    totalNodes: number
  ): number {
    const degree = edges.filter(e => 
      e.source === nodeId || e.target === nodeId
    ).length;
    
    return degree / (totalNodes - 1);
  }

  private calculateBetweennessCentrality(
    nodeId: string,
    nodes: GraphNode[],
    edges: GraphEdge[]
  ): number {
    // Simplified betweenness centrality
    let betweenness = 0;
    
    // This is a simplified calculation
    // In production, use proper shortest path algorithms
    const connectedEdges = edges.filter(e => 
      e.source === nodeId || e.target === nodeId
    );
    
    betweenness = connectedEdges.length / edges.length;
    
    return Math.min(betweenness, 1);
  }

  private calculateClosenessCentrality(
    nodeId: string,
    nodes: GraphNode[],
    adjacencyMatrix: number[][]
  ): number {
    const nodeIndex = nodes.findIndex(n => n.id === nodeId);
    if (nodeIndex === -1) return 0;
    
    const distances = this.dijkstra(nodeIndex, adjacencyMatrix);
    const reachableNodes = distances.filter(d => d < Infinity && d > 0).length;
    const sumDistances = distances.reduce((sum, d) => sum + (d < Infinity ? d : 0), 0);
    
    if (sumDistances === 0) return 0;
    
    return reachableNodes / sumDistances;
  }

  private calculateEigenvectorCentrality(
    nodeId: string,
    adjacencyMatrix: number[][]
  ): number {
    // Simplified eigenvector centrality
    // In production, use proper matrix operations
    const n = adjacencyMatrix.length;
    const nodeIndex = adjacencyMatrix.findIndex((_, i) => i.toString() === nodeId);
    
    if (nodeIndex === -1) return 0;
    
    let score = 0;
    for (let i = 0; i < n; i++) {
      score += adjacencyMatrix[i][nodeIndex];
    }
    
    return Math.min(score / n, 1);
  }

  private calculatePageRank(
    nodeId: string,
    edges: GraphEdge[],
    nodes: GraphNode[]
  ): number {
    // Simplified PageRank
    const damping = 0.85;
    const iterations = 20;
    
    const pageRank = new Map<string, number>();
    const n = nodes.length;
    
    // Initialize
    for (const node of nodes) {
      pageRank.set(node.id, 1 / n);
    }
    
    // Iterate
    for (let i = 0; i < iterations; i++) {
      const newPageRank = new Map<string, number>();
      
      for (const node of nodes) {
        let rank = (1 - damping) / n;
        
        const incomingEdges = edges.filter(e => e.target === node.id);
        for (const edge of incomingEdges) {
          const sourceRank = pageRank.get(edge.source) || 0;
          const outDegree = edges.filter(e => e.source === edge.source).length;
          rank += damping * (sourceRank / outDegree);
        }
        
        newPageRank.set(node.id, rank);
      }
      
      pageRank.clear();
      for (const [id, rank] of newPageRank) {
        pageRank.set(id, rank);
      }
    }
    
    return pageRank.get(nodeId) || 0;
  }

  private dijkstra(start: number, adjacencyMatrix: number[][]): number[] {
    const n = adjacencyMatrix.length;
    const distances = Array(n).fill(Infinity);
    const visited = Array(n).fill(false);
    
    distances[start] = 0;
    
    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      let minIndex = -1;
      
      for (let j = 0; j < n; j++) {
        if (!visited[j] && distances[j] < minDist) {
          minDist = distances[j];
          minIndex = j;
        }
      }
      
      if (minIndex === -1) break;
      
      visited[minIndex] = true;
      
      for (let j = 0; j < n; j++) {
        if (!visited[j] && adjacencyMatrix[minIndex][j] > 0) {
          const newDist = distances[minIndex] + 1; // Using unit distance
          if (newDist < distances[j]) {
            distances[j] = newDist;
          }
        }
      }
    }
    
    return distances;
  }

  private identifyKeyServices(centrality: CentralityMetrics[]): Array<any> {
    const keyServices: Array<any> = [];
    
    // Sort by different metrics
    const byDegree = [...centrality].sort((a, b) => b.degreeCentrality - a.degreeCentrality);
    const byBetweenness = [...centrality].sort((a, b) => b.betweennessCentrality - a.betweennessCentrality);
    const byPageRank = [...centrality].sort((a, b) => b.pageRank - a.pageRank);
    
    // Gateway services (high degree)
    if (byDegree[0].degreeCentrality > 0.5) {
      keyServices.push({
        service: byDegree[0].service,
        role: 'Gateway/Hub',
        importance: byDegree[0].degreeCentrality,
        reason: 'High connectivity - central to many service interactions'
      });
    }
    
    // Bridge services (high betweenness)
    if (byBetweenness[0].betweennessCentrality > 0.3) {
      keyServices.push({
        service: byBetweenness[0].service,
        role: 'Bridge/Mediator',
        importance: byBetweenness[0].betweennessCentrality,
        reason: 'Critical for connecting different parts of the system'
      });
    }
    
    // Authority services (high PageRank)
    if (byPageRank[0].pageRank > 0.2) {
      keyServices.push({
        service: byPageRank[0].service,
        role: 'Core Service',
        importance: byPageRank[0].pageRank,
        reason: 'Highly depended upon by other important services'
      });
    }
    
    return keyServices;
  }

  private generateCentralityRecommendations(
    centrality: CentralityMetrics[],
    keyServices: Array<any>
  ): Array<any> {
    const recommendations: Array<any> = [];
    
    for (const key of keyServices) {
      const metrics = centrality.find(c => c.service === key.service);
      if (!metrics) continue;
      
      if (metrics.degreeCentrality > 0.7) {
        recommendations.push({
          service: key.service,
          recommendation: 'Consider breaking down this service to reduce coupling',
          priority: 'high' as const
        });
      }
      
      if (metrics.betweennessCentrality > 0.5) {
        recommendations.push({
          service: key.service,
          recommendation: 'Add redundancy or caching to prevent bottlenecks',
          priority: 'high' as const
        });
      }
    }
    
    // Find isolated services
    const isolated = centrality.filter(c => c.degreeCentrality < 0.1);
    for (const service of isolated) {
      recommendations.push({
        service: service.service,
        recommendation: 'Review if this service is still needed or properly integrated',
        priority: 'low' as const
      });
    }
    
    return recommendations;
  }

  private detectCommunities(
    nodes: GraphNode[],
    edges: GraphEdge[]
  ): ServiceCluster[] {
    // Simplified community detection using modularity optimization
    const communities: ServiceCluster[] = [];
    const nodeComm = new Map<string, number>();
    
    // Initially, each node is its own community
    nodes.forEach((node, i) => nodeComm.set(node.id, i));
    
    // Merge communities based on edge density
    let improved = true;
    while (improved) {
      improved = false;
      
      for (const edge of edges) {
        const comm1 = nodeComm.get(edge.source)!;
        const comm2 = nodeComm.get(edge.target)!;
        
        if (comm1 !== comm2) {
          // Check if merging improves modularity (simplified)
          const shouldMerge = Math.random() < 0.3; // Simplified decision
          
          if (shouldMerge) {
            // Merge communities
            for (const [node, comm] of nodeComm) {
              if (comm === comm2) {
                nodeComm.set(node, comm1);
              }
            }
            improved = true;
          }
        }
      }
    }
    
    // Build final communities
    const commMap = new Map<number, string[]>();
    for (const [node, comm] of nodeComm) {
      if (!commMap.has(comm)) {
        commMap.set(comm, []);
      }
      commMap.get(comm)!.push(node);
    }
    
    let i = 0;
    for (const [, services] of commMap) {
      if (services.length > 1) {
        const cohesion = this.calculateCohesion(services, edges);
        const coupling = this.calculateCoupling(services, edges, nodes);
        
        communities.push({
          id: `community-${i++}`,
          name: `Service Community ${i}`,
          services,
          cohesion,
          coupling,
          description: `Group of ${services.length} related services`
        });
      }
    }
    
    return communities;
  }

  private calculateCohesion(services: string[], edges: GraphEdge[]): number {
    if (services.length < 2) return 1;
    
    const internalEdges = edges.filter(e => 
      services.includes(e.source) && services.includes(e.target)
    );
    
    const maxEdges = services.length * (services.length - 1);
    return maxEdges > 0 ? internalEdges.length / maxEdges : 0;
  }

  private calculateCoupling(
    services: string[],
    edges: GraphEdge[],
    nodes: GraphNode[]
  ): number {
    const externalEdges = edges.filter(e => 
      (services.includes(e.source) && !services.includes(e.target)) ||
      (!services.includes(e.source) && services.includes(e.target))
    );
    
    const totalEdges = edges.filter(e => 
      services.includes(e.source) || services.includes(e.target)
    );
    
    return totalEdges.length > 0 ? externalEdges.length / totalEdges.length : 0;
  }

  private calculateModularity(
    communities: ServiceCluster[],
    edges: GraphEdge[],
    nodes: GraphNode[]
  ): number {
    // Simplified modularity calculation
    let modularity = 0;
    const m = edges.length;
    
    for (const community of communities) {
      const internalEdges = edges.filter(e => 
        community.services.includes(e.source) && 
        community.services.includes(e.target)
      ).length;
      
      const totalDegree = edges.filter(e => 
        community.services.includes(e.source) || 
        community.services.includes(e.target)
      ).length;
      
      modularity += (internalEdges / m) - Math.pow(totalDegree / (2 * m), 2);
    }
    
    return modularity;
  }

  private generateRefactoringSuggestions(
    groupings: Array<any>,
    edges: GraphEdge[]
  ): Array<any> {
    const suggestions: Array<any> = [];
    
    for (const group of groupings) {
      if (group.cohesion < 0.3 && group.services.length > 3) {
        suggestions.push({
          type: 'split' as const,
          services: group.services,
          reason: 'Low cohesion - services may not belong together',
          expectedBenefit: 0.4
        });
      }
      
      if (group.coupling > 0.7) {
        suggestions.push({
          type: 'extract' as const,
          services: group.services.slice(0, 2),
          reason: 'High coupling - consider extracting shared functionality',
          expectedBenefit: 0.3
        });
      }
    }
    
    return suggestions;
  }

  private generateTimeIntervals(
    timeRange: { from: string; to: string },
    intervalSize: string
  ): Array<{ from: string; to: string }> {
    const intervals: Array<{ from: string; to: string }> = [];
    const intervalMs = this.parseInterval(intervalSize);
    
    const start = new Date(timeRange.from).getTime();
    const end = new Date(timeRange.to).getTime();
    
    let current = start;
    while (current < end) {
      const intervalEnd = Math.min(current + intervalMs, end);
      intervals.push({
        from: new Date(current).toISOString(),
        to: new Date(intervalEnd).toISOString()
      });
      current = intervalEnd;
    }
    
    return intervals;
  }

  private calculateDensity(nodes: number, edges: number): number {
    if (nodes < 2) return 0;
    const maxEdges = nodes * (nodes - 1);
    return edges / maxEdges;
  }

  private calculateClusteringCoefficient(
    nodes: GraphNode[],
    edges: GraphEdge[]
  ): number {
    // Simplified clustering coefficient
    let totalCoeff = 0;
    
    for (const node of nodes) {
      const neighbors = edges
        .filter(e => e.source === node.id || e.target === node.id)
        .map(e => e.source === node.id ? e.target : e.source);
      
      if (neighbors.length < 2) continue;
      
      let triangles = 0;
      for (let i = 0; i < neighbors.length; i++) {
        for (let j = i + 1; j < neighbors.length; j++) {
          if (edges.some(e => 
            (e.source === neighbors[i] && e.target === neighbors[j]) ||
            (e.source === neighbors[j] && e.target === neighbors[i])
          )) {
            triangles++;
          }
        }
      }
      
      const possibleTriangles = neighbors.length * (neighbors.length - 1) / 2;
      totalCoeff += triangles / possibleTriangles;
    }
    
    return totalCoeff / nodes.length;
  }

  private calculateEvolutionTrends(snapshots: Array<any>): any {
    if (snapshots.length < 2) {
      return {
        growthRate: 0,
        stabilityScore: 1,
        complexityTrend: 0
      };
    }

    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    
    // Calculate growth rate
    const nodeGrowth = (last.metrics.nodes - first.metrics.nodes) / 
      Math.max(first.metrics.nodes, 1);
    const edgeGrowth = (last.metrics.edges - first.metrics.edges) / 
      Math.max(first.metrics.edges, 1);
    
    // Calculate stability (based on changes)
    let totalChanges = 0;
    for (const snapshot of snapshots) {
      totalChanges += snapshot.changes.addedNodes.length + 
                     snapshot.changes.removedNodes.length;
    }
    const stabilityScore = 1 - Math.min(totalChanges / (snapshots.length * 10), 1);
    
    // Calculate complexity trend
    const complexityTrend = last.metrics.density - first.metrics.density;

    return {
      growthRate: (nodeGrowth + edgeGrowth) / 2,
      stabilityScore,
      complexityTrend
    };
  }

  private predictFutureState(snapshots: Array<any>, trends: any): any {
    if (snapshots.length < 2) {
      return {
        expectedNodes: 0,
        expectedEdges: 0,
        expectedDensity: 0
      };
    }

    const last = snapshots[snapshots.length - 1];
    
    // Simple linear prediction
    const expectedNodes = Math.round(
      last.metrics.nodes * (1 + trends.growthRate * 0.1)
    );
    const expectedEdges = Math.round(
      last.metrics.edges * (1 + trends.growthRate * 0.15)
    );
    const expectedDensity = expectedEdges / (expectedNodes * (expectedNodes - 1));

    return {
      expectedNodes,
      expectedEdges,
      expectedDensity
    };
  }

  private inferServiceType(span: any): GraphNode['type'] {
    const attrs = span.attributes || {};
    
    if (attrs.db || attrs['db.system']) return 'database';
    if (attrs['cache.hit'] !== undefined || span.name.includes('cache')) return 'cache';
    if (attrs.http?.url?.includes('external') || attrs['peer.service']) return 'external';
    
    return 'service';
  }

  private getNodeColor(type: string, errorRate: number = 0): string {
    if (errorRate > 0.1) return '#ff4444';
    
    switch (type) {
      case 'database': return '#4CAF50';
      case 'cache': return '#FF9800';
      case 'external': return '#9C27B0';
      default: return '#2196F3';
    }
  }

  private getEdgeColor(errorRate: number): string {
    if (errorRate > 0.1) return '#ff4444';
    if (errorRate > 0.05) return '#ff9800';
    return '#999999';
  }

  private describeCluster(services: string[], nodes: GraphNode[]): string {
    const types = new Set<string>();
    for (const service of services) {
      const node = nodes.find(n => n.id === service);
      if (node) types.add(node.type);
    }
    
    return `Cluster containing ${services.length} services (${Array.from(types).join(', ')})`;
  }

  private generateGroupingRecommendation(cohesion: number, coupling: number): string {
    if (cohesion > 0.7 && coupling < 0.3) {
      return 'Well-designed bounded context';
    } else if (cohesion < 0.3) {
      return 'Consider splitting - low internal cohesion';
    } else if (coupling > 0.7) {
      return 'High external coupling - review boundaries';
    }
    return 'Monitor for changes';
  }

  private parseInterval(interval: string): number {
    const match = interval.match(/^(\d+)([smhd])$/);
    if (!match) return 3600000; // Default 1 hour
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 3600000;
    }
  }

  private getEmptyGraph(): ServiceGraph {
    return {
      nodes: [],
      edges: [],
      clusters: [],
      metrics: {
        totalNodes: 0,
        totalEdges: 0,
        avgDegree: 0,
        density: 0,
        diameter: 0
      }
    };
  }
}