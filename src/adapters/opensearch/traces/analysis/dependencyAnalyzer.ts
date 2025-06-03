import { logger } from '../../../../utils/logger.js';
import { TracesAdapterCore } from '../core/adapter.js';
import { TraceAnalyzer, ServiceDependency, Trace } from './traceAnalyzer.js';

/**
 * Dependency analysis options
 */
export interface DependencyAnalysisOptions {
  timeRange?: { from: string; to: string };
  service?: string | string[];
  minCallCount?: number;
  includeInternal?: boolean;
  limit?: number;
}

/**
 * Service dependency with enhanced metrics
 */
export interface EnhancedServiceDependency extends ServiceDependency {
  latencyPercentiles: {
    p50: number;
    p95: number;
    p99: number;
  };
  throughput: number;
  criticalityScore: number;
}

/**
 * Service node in dependency graph
 */
export interface ServiceNode {
  name: string;
  type: 'service' | 'database' | 'cache' | 'external';
  metrics: {
    requestCount: number;
    avgDuration: number;
    errorRate: number;
    throughput: number;
  };
  dependencies: {
    upstream: string[];
    downstream: string[];
  };
}

/**
 * Dependency path
 */
export interface DependencyPath {
  path: string[];
  totalDuration: number;
  errorRate: number;
  callCount: number;
  criticalityScore: number;
}

/**
 * Service health based on dependencies
 */
export interface ServiceHealth {
  service: string;
  healthScore: number;
  issues: string[];
  recommendations: string[];
  impactedServices: string[];
}

/**
 * Clean service dependency analysis
 */
export class DependencyAnalyzer {
  constructor(
    private readonly adapter: TracesAdapterCore,
    private readonly analyzer: TraceAnalyzer
  ) {}

  /**
   * Analyze service dependencies
   */
  public async analyzeDependencies(
    options: DependencyAnalysisOptions = {}
  ): Promise<{
    dependencies: EnhancedServiceDependency[];
    serviceMap: Map<string, ServiceNode>;
    criticalPaths: DependencyPath[];
    healthAnalysis: ServiceHealth[];
    summary: string;
  }> {
    logger.info('[DependencyAnalyzer] Analyzing service dependencies', { options });

    try {
      // Fetch traces for analysis
      const traces = await this.fetchTraces(options);
      
      if (traces.length === 0) {
        return {
          dependencies: [],
          serviceMap: new Map(),
          criticalPaths: [],
          healthAnalysis: [],
          summary: 'No traces found in the specified time range'
        };
      }

      // Extract basic dependencies
      const basicDependencies = this.analyzer.analyzeServiceDependencies(traces);
      
      // Enhance dependencies with additional metrics
      const dependencies = await this.enhanceDependencies(basicDependencies, traces);
      
      // Build service map
      const serviceMap = this.buildServiceMap(dependencies, traces);
      
      // Find critical paths
      const criticalPaths = this.findCriticalPaths(serviceMap, traces);
      
      // Analyze service health
      const healthAnalysis = this.analyzeServiceHealth(serviceMap, dependencies);
      
      // Generate summary
      const summary = this.generateDependencySummary(
        dependencies,
        serviceMap,
        criticalPaths,
        healthAnalysis
      );

      return {
        dependencies: dependencies.slice(0, options.limit || 100),
        serviceMap,
        criticalPaths: criticalPaths.slice(0, options.limit || 20),
        healthAnalysis: healthAnalysis.slice(0, options.limit || 50),
        summary
      };
    } catch (error) {
      logger.error('[DependencyAnalyzer] Error analyzing dependencies', { error });
      throw error;
    }
  }

  /**
   * Detect dependency anomalies
   */
  public async detectDependencyAnomalies(
    options: DependencyAnalysisOptions = {}
  ): Promise<{
    newDependencies: ServiceDependency[];
    missingDependencies: ServiceDependency[];
    performanceAnomalies: Array<{
      dependency: ServiceDependency;
      issue: string;
      impact: number;
    }>;
    topologyChanges: Array<{
      type: 'added' | 'removed' | 'changed';
      service: string;
      description: string;
    }>;
  }> {
    logger.info('[DependencyAnalyzer] Detecting dependency anomalies', { options });

    const windowSize = '1h';
    const now = new Date();
    const currentEnd = now.toISOString();
    const currentStart = new Date(now.getTime() - 3600000).toISOString();
    const baselineStart = new Date(now.getTime() - 7200000).toISOString();

    // Fetch traces for current and baseline periods
    const [currentTraces, baselineTraces] = await Promise.all([
      this.fetchTraces({
        ...options,
        timeRange: { from: currentStart, to: currentEnd }
      }),
      this.fetchTraces({
        ...options,
        timeRange: { from: baselineStart, to: currentStart }
      })
    ]);

    // Extract dependencies for both periods
    const currentDeps = this.analyzer.analyzeServiceDependencies(currentTraces);
    const baselineDeps = this.analyzer.analyzeServiceDependencies(baselineTraces);

    // Find new and missing dependencies
    const newDependencies = this.findNewDependencies(currentDeps, baselineDeps);
    const missingDependencies = this.findMissingDependencies(currentDeps, baselineDeps);

    // Detect performance anomalies
    const performanceAnomalies = this.detectPerformanceAnomalies(
      currentDeps,
      baselineDeps
    );

    // Detect topology changes
    const topologyChanges = this.detectTopologyChanges(
      currentTraces,
      baselineTraces
    );

    return {
      newDependencies,
      missingDependencies,
      performanceAnomalies,
      topologyChanges
    };
  }

  /**
   * Analyze dependency evolution over time
   */
  public async analyzeDependencyEvolution(
    timeRange: { from: string; to: string },
    intervalSize: string = '1h',
    options: Omit<DependencyAnalysisOptions, 'timeRange'> = {}
  ): Promise<{
    timeSeries: Array<{
      timestamp: string;
      dependencies: number;
      services: number;
      avgCallCount: number;
      avgErrorRate: number;
    }>;
    trends: {
      dependencyGrowth: number;
      serviceGrowth: number;
      complexityTrend: number;
    };
    volatileServices: Array<{
      service: string;
      volatilityScore: number;
      changes: number;
    }>;
  }> {
    logger.info('[DependencyAnalyzer] Analyzing dependency evolution', {
      timeRange,
      intervalSize
    });

    const intervals = this.generateTimeIntervals(timeRange, intervalSize);
    const timeSeries: Array<any> = [];
    const serviceChanges = new Map<string, number>();

    for (const interval of intervals) {
      const traces = await this.fetchTraces({
        ...options,
        timeRange: interval
      });

      const dependencies = this.analyzer.analyzeServiceDependencies(traces);
      const services = new Set<string>();
      
      let totalCallCount = 0;
      let totalErrorRate = 0;

      for (const dep of dependencies) {
        services.add(dep.source);
        services.add(dep.target);
        totalCallCount += dep.callCount;
        totalErrorRate += dep.errorRate;
      }

      timeSeries.push({
        timestamp: interval.from,
        dependencies: dependencies.length,
        services: services.size,
        avgCallCount: dependencies.length > 0 ? totalCallCount / dependencies.length : 0,
        avgErrorRate: dependencies.length > 0 ? totalErrorRate / dependencies.length : 0
      });

      // Track service changes
      for (const service of services) {
        serviceChanges.set(service, (serviceChanges.get(service) || 0) + 1);
      }
    }

    // Calculate trends
    const trends = this.calculateEvolutionTrends(timeSeries);

    // Identify volatile services
    const volatileServices = this.identifyVolatileServices(
      serviceChanges,
      intervals.length
    );

    return {
      timeSeries,
      trends,
      volatileServices
    };
  }

  /**
   * Find service bottlenecks in dependency graph
   */
  public async findServiceBottlenecks(
    options: DependencyAnalysisOptions = {}
  ): Promise<{
    bottlenecks: Array<{
      service: string;
      bottleneckScore: number;
      incomingLoad: number;
      outgoingLoad: number;
      avgResponseTime: number;
      errorRate: number;
      impactedPaths: DependencyPath[];
    }>;
    recommendations: Array<{
      service: string;
      recommendation: string;
      expectedImprovement: number;
    }>;
  }> {
    logger.info('[DependencyAnalyzer] Finding service bottlenecks', { options });

    const analysis = await this.analyzeDependencies(options);
    const { serviceMap, criticalPaths } = analysis;

    const bottlenecks: Array<any> = [];

    for (const [serviceName, node] of serviceMap) {
      const incomingLoad = node.dependencies.upstream.length * node.metrics.requestCount;
      const outgoingLoad = node.dependencies.downstream.length * node.metrics.requestCount;
      
      // Calculate bottleneck score based on multiple factors
      const bottleneckScore = this.calculateBottleneckScore(
        node,
        incomingLoad,
        outgoingLoad,
        criticalPaths
      );

      if (bottleneckScore > 0.5) {
        // Find impacted paths
        const impactedPaths = criticalPaths.filter(path => 
          path.path.includes(serviceName)
        );

        bottlenecks.push({
          service: serviceName,
          bottleneckScore,
          incomingLoad,
          outgoingLoad,
          avgResponseTime: node.metrics.avgDuration,
          errorRate: node.metrics.errorRate,
          impactedPaths
        });
      }
    }

    // Generate recommendations
    const recommendations = this.generateBottleneckRecommendations(bottlenecks);

    return {
      bottlenecks: bottlenecks
        .sort((a, b) => b.bottleneckScore - a.bottleneckScore)
        .slice(0, options.limit || 10),
      recommendations
    };
  }

  // Private helper methods

  private async fetchTraces(options: DependencyAnalysisOptions): Promise<Trace[]> {
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
    return this.analyzer.processTraceResponse(response);
  }

  private async enhanceDependencies(
    dependencies: ServiceDependency[],
    traces: Trace[]
  ): Promise<EnhancedServiceDependency[]> {
    const enhanced: EnhancedServiceDependency[] = [];

    for (const dep of dependencies) {
      // Collect durations for this dependency
      const durations: number[] = [];
      
      for (const trace of traces) {
        if (!trace.spans) continue;
        
        for (const span of trace.spans) {
          if (span.service === dep.target && span.parentSpanId) {
            const parentSpan = trace.spans.find(s => s.spanId === span.parentSpanId);
            if (parentSpan && parentSpan.service === dep.source) {
              durations.push(span.duration);
            }
          }
        }
      }

      durations.sort((a, b) => a - b);

      const throughput = dep.callCount / 
        ((new Date(traces[0]?.startTime).getTime() - 
          new Date(traces[traces.length - 1]?.startTime).getTime()) / 1000);

      enhanced.push({
        ...dep,
        latencyPercentiles: {
          p50: this.calculatePercentile(durations, 50),
          p95: this.calculatePercentile(durations, 95),
          p99: this.calculatePercentile(durations, 99)
        },
        throughput: Math.abs(throughput),
        criticalityScore: this.calculateCriticalityScore(dep, traces)
      });
    }

    return enhanced.sort((a, b) => b.criticalityScore - a.criticalityScore);
  }

  private buildServiceMap(
    dependencies: EnhancedServiceDependency[],
    traces: Trace[]
  ): Map<string, ServiceNode> {
    const serviceMap = new Map<string, ServiceNode>();

    // Initialize nodes from traces
    for (const trace of traces) {
      if (!trace.spans) continue;
      
      for (const span of trace.spans) {
        if (!serviceMap.has(span.service)) {
          serviceMap.set(span.service, {
            name: span.service,
            type: this.inferServiceType(span),
            metrics: {
              requestCount: 0,
              avgDuration: 0,
              errorRate: 0,
              throughput: 0
            },
            dependencies: {
              upstream: [],
              downstream: []
            }
          });
        }
        
        const node = serviceMap.get(span.service)!;
        node.metrics.requestCount++;
        node.metrics.avgDuration = 
          (node.metrics.avgDuration * (node.metrics.requestCount - 1) + span.duration) / 
          node.metrics.requestCount;
        
        if (span.error) {
          node.metrics.errorRate = 
            (node.metrics.errorRate * (node.metrics.requestCount - 1) + 1) / 
            node.metrics.requestCount;
        }
      }
    }

    // Add dependency relationships
    for (const dep of dependencies) {
      const sourceNode = serviceMap.get(dep.source);
      const targetNode = serviceMap.get(dep.target);
      
      if (sourceNode && !sourceNode.dependencies.downstream.includes(dep.target)) {
        sourceNode.dependencies.downstream.push(dep.target);
      }
      
      if (targetNode && !targetNode.dependencies.upstream.includes(dep.source)) {
        targetNode.dependencies.upstream.push(dep.source);
      }
    }

    return serviceMap;
  }

  private findCriticalPaths(
    serviceMap: Map<string, ServiceNode>,
    traces: Trace[]
  ): DependencyPath[] {
    const paths: DependencyPath[] = [];
    
    // Find entry point services (no upstream dependencies)
    const entryPoints = Array.from(serviceMap.values())
      .filter(node => node.dependencies.upstream.length === 0);

    for (const entryPoint of entryPoints) {
      // Use DFS to find all paths from this entry point
      const visited = new Set<string>();
      const currentPath: string[] = [];
      
      this.dfsPath(
        entryPoint.name,
        serviceMap,
        visited,
        currentPath,
        paths,
        traces
      );
    }

    return paths.sort((a, b) => b.criticalityScore - a.criticalityScore);
  }

  private dfsPath(
    service: string,
    serviceMap: Map<string, ServiceNode>,
    visited: Set<string>,
    currentPath: string[],
    paths: DependencyPath[],
    traces: Trace[]
  ): void {
    if (visited.has(service)) return;
    
    visited.add(service);
    currentPath.push(service);
    
    const node = serviceMap.get(service);
    if (!node) return;
    
    // If this is a leaf node or we've traced deep enough, save the path
    if (node.dependencies.downstream.length === 0 || currentPath.length >= 5) {
      const pathMetrics = this.calculatePathMetrics(currentPath, traces);
      paths.push({
        path: [...currentPath],
        ...pathMetrics
      });
    }
    
    // Continue DFS for downstream services
    for (const downstream of node.dependencies.downstream) {
      this.dfsPath(downstream, serviceMap, visited, currentPath, paths, traces);
    }
    
    currentPath.pop();
    visited.delete(service);
  }

  private calculatePathMetrics(
    path: string[],
    traces: Trace[]
  ): Omit<DependencyPath, 'path'> {
    let totalDuration = 0;
    let errorCount = 0;
    let pathCount = 0;

    for (const trace of traces) {
      if (!trace.spans) continue;
      
      // Check if trace contains this path
      const traceServices = trace.spans.map(s => s.service);
      let containsPath = true;
      let lastIndex = -1;
      
      for (const service of path) {
        const index = traceServices.indexOf(service, lastIndex + 1);
        if (index === -1) {
          containsPath = false;
          break;
        }
        lastIndex = index;
      }
      
      if (containsPath) {
        pathCount++;
        totalDuration += trace.duration;
        if (trace.spans.some(s => s.error)) {
          errorCount++;
        }
      }
    }

    return {
      totalDuration: pathCount > 0 ? totalDuration / pathCount : 0,
      errorRate: pathCount > 0 ? errorCount / pathCount : 0,
      callCount: pathCount,
      criticalityScore: pathCount / Math.max(traces.length, 1)
    };
  }

  private analyzeServiceHealth(
    serviceMap: Map<string, ServiceNode>,
    dependencies: EnhancedServiceDependency[]
  ): ServiceHealth[] {
    const healthAnalysis: ServiceHealth[] = [];

    for (const [serviceName, node] of serviceMap) {
      const issues: string[] = [];
      const recommendations: string[] = [];
      const impactedServices: string[] = [];
      
      // Check error rate
      if (node.metrics.errorRate > 0.05) {
        issues.push(`High error rate: ${(node.metrics.errorRate * 100).toFixed(1)}%`);
        recommendations.push('Investigate and fix error causes');
      }
      
      // Check response time
      if (node.metrics.avgDuration > 1000) {
        issues.push(`Slow response time: ${node.metrics.avgDuration.toFixed(0)}ms`);
        recommendations.push('Optimize service performance');
      }
      
      // Check dependency health
      const downstreamDeps = dependencies.filter(d => d.source === serviceName);
      for (const dep of downstreamDeps) {
        if (dep.errorRate > 0.1) {
          issues.push(`Unhealthy dependency: ${dep.target}`);
          impactedServices.push(dep.target);
        }
      }
      
      // Calculate health score
      const healthScore = 1 - (
        node.metrics.errorRate * 0.4 +
        Math.min(node.metrics.avgDuration / 5000, 1) * 0.3 +
        (issues.length / 10) * 0.3
      );
      
      healthAnalysis.push({
        service: serviceName,
        healthScore: Math.max(0, Math.min(1, healthScore)),
        issues,
        recommendations,
        impactedServices: [...new Set(impactedServices)]
      });
    }

    return healthAnalysis.sort((a, b) => a.healthScore - b.healthScore);
  }

  private findNewDependencies(
    current: ServiceDependency[],
    baseline: ServiceDependency[]
  ): ServiceDependency[] {
    return current.filter(curr => 
      !baseline.some(base => 
        base.source === curr.source && base.target === curr.target
      )
    );
  }

  private findMissingDependencies(
    current: ServiceDependency[],
    baseline: ServiceDependency[]
  ): ServiceDependency[] {
    return baseline.filter(base => 
      !current.some(curr => 
        curr.source === base.source && curr.target === base.target
      )
    );
  }

  private detectPerformanceAnomalies(
    current: ServiceDependency[],
    baseline: ServiceDependency[]
  ): Array<any> {
    const anomalies: Array<any> = [];

    for (const currDep of current) {
      const baseDep = baseline.find(b => 
        b.source === currDep.source && b.target === currDep.target
      );
      
      if (baseDep) {
        const durationChange = (currDep.avgDuration - baseDep.avgDuration) / 
          Math.max(baseDep.avgDuration, 1);
        const errorRateChange = currDep.errorRate - baseDep.errorRate;
        
        if (durationChange > 0.5) {
          anomalies.push({
            dependency: currDep,
            issue: `Response time increased by ${(durationChange * 100).toFixed(0)}%`,
            impact: durationChange
          });
        }
        
        if (errorRateChange > 0.1) {
          anomalies.push({
            dependency: currDep,
            issue: `Error rate increased by ${(errorRateChange * 100).toFixed(1)}%`,
            impact: errorRateChange
          });
        }
      }
    }

    return anomalies.sort((a, b) => b.impact - a.impact);
  }

  private detectTopologyChanges(
    currentTraces: Trace[],
    baselineTraces: Trace[]
  ): Array<any> {
    const changes: Array<any> = [];
    
    const currentServices = new Set<string>();
    const baselineServices = new Set<string>();
    
    for (const trace of currentTraces) {
      trace.spans?.forEach(span => currentServices.add(span.service));
    }
    
    for (const trace of baselineTraces) {
      trace.spans?.forEach(span => baselineServices.add(span.service));
    }
    
    // Find added services
    for (const service of currentServices) {
      if (!baselineServices.has(service)) {
        changes.push({
          type: 'added' as const,
          service,
          description: 'New service detected'
        });
      }
    }
    
    // Find removed services
    for (const service of baselineServices) {
      if (!currentServices.has(service)) {
        changes.push({
          type: 'removed' as const,
          service,
          description: 'Service no longer active'
        });
      }
    }
    
    return changes;
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

  private calculateEvolutionTrends(timeSeries: Array<any>): any {
    if (timeSeries.length < 2) {
      return {
        dependencyGrowth: 0,
        serviceGrowth: 0,
        complexityTrend: 0
      };
    }

    const first = timeSeries[0];
    const last = timeSeries[timeSeries.length - 1];

    return {
      dependencyGrowth: (last.dependencies - first.dependencies) / 
        Math.max(first.dependencies, 1),
      serviceGrowth: (last.services - first.services) / 
        Math.max(first.services, 1),
      complexityTrend: (last.dependencies / Math.max(last.services, 1)) - 
        (first.dependencies / Math.max(first.services, 1))
    };
  }

  private identifyVolatileServices(
    serviceChanges: Map<string, number>,
    totalIntervals: number
  ): Array<any> {
    const volatileServices: Array<any> = [];

    for (const [service, changes] of serviceChanges) {
      const volatilityScore = changes / totalIntervals;
      if (volatilityScore < 0.8) { // Service not present in 20% of intervals
        volatileServices.push({
          service,
          volatilityScore: 1 - volatilityScore,
          changes
        });
      }
    }

    return volatileServices.sort((a, b) => b.volatilityScore - a.volatilityScore);
  }

  private calculateBottleneckScore(
    node: ServiceNode,
    incomingLoad: number,
    outgoingLoad: number,
    criticalPaths: DependencyPath[]
  ): number {
    // Factor 1: High fan-in (many services depend on this)
    const fanInScore = Math.min(node.dependencies.upstream.length / 10, 1);
    
    // Factor 2: Slow response time
    const latencyScore = Math.min(node.metrics.avgDuration / 5000, 1);
    
    // Factor 3: High error rate
    const errorScore = node.metrics.errorRate;
    
    // Factor 4: On critical paths
    const criticalPathCount = criticalPaths.filter(p => 
      p.path.includes(node.name)
    ).length;
    const criticalScore = Math.min(criticalPathCount / 10, 1);
    
    // Weighted combination
    return (
      fanInScore * 0.3 +
      latencyScore * 0.3 +
      errorScore * 0.2 +
      criticalScore * 0.2
    );
  }

  private generateBottleneckRecommendations(
    bottlenecks: Array<any>
  ): Array<any> {
    const recommendations: Array<any> = [];

    for (const bottleneck of bottlenecks) {
      if (bottleneck.avgResponseTime > 2000) {
        recommendations.push({
          service: bottleneck.service,
          recommendation: 'Implement caching to reduce response time',
          expectedImprovement: 0.4
        });
      }
      
      if (bottleneck.errorRate > 0.05) {
        recommendations.push({
          service: bottleneck.service,
          recommendation: 'Add circuit breaker and retry logic',
          expectedImprovement: 0.3
        });
      }
      
      if (bottleneck.incomingLoad > 10000) {
        recommendations.push({
          service: bottleneck.service,
          recommendation: 'Scale horizontally to handle load',
          expectedImprovement: 0.5
        });
      }
    }

    return recommendations;
  }

  private inferServiceType(span: any): 'service' | 'database' | 'cache' | 'external' {
    const attrs = span.attributes || {};
    
    if (attrs.db || attrs['db.system']) return 'database';
    if (attrs['cache.hit'] !== undefined || span.name.includes('cache')) return 'cache';
    if (attrs.http?.url?.includes('external') || attrs['peer.service']) return 'external';
    
    return 'service';
  }

  private calculateCriticalityScore(
    dep: ServiceDependency,
    traces: Trace[]
  ): number {
    // Simple criticality based on call count and error impact
    const callRatio = dep.callCount / Math.max(traces.length, 1);
    const errorImpact = dep.errorRate * dep.callCount;
    
    return Math.min(callRatio + errorImpact / 100, 1);
  }

  private calculatePercentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, index)];
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

  private generateDependencySummary(
    dependencies: EnhancedServiceDependency[],
    serviceMap: Map<string, ServiceNode>,
    criticalPaths: DependencyPath[],
    healthAnalysis: ServiceHealth[]
  ): string {
    const parts = [];
    
    parts.push(`Found ${dependencies.length} service dependencies across ${serviceMap.size} services.`);
    
    if (criticalPaths.length > 0) {
      const mostCritical = criticalPaths[0];
      parts.push(`Most critical path: ${mostCritical.path.join(' → ')} (${mostCritical.callCount} calls).`);
    }
    
    const unhealthyServices = healthAnalysis.filter(h => h.healthScore < 0.7);
    if (unhealthyServices.length > 0) {
      parts.push(`${unhealthyServices.length} services need attention.`);
    }
    
    return parts.join(' ');
  }
}