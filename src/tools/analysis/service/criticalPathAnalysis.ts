import { z } from 'zod';
import { BaseTool, ToolCategory } from '../../base/tool.js';
import { BaseSearchAdapter } from '../../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../../config/index.js';
import { MCPToolSchema } from '../../../types.js';
import { TraceDocument } from '../../../types/opensearch-types.js';

// Define the Zod schema
const CriticalPathAnalysisArgsSchema = {
  service: z.string().optional().describe('Service to analyze critical paths for'),
  operation: z.string().optional().describe('Specific operation to analyze'),
  from: z.string().describe('Start time for analysis (ISO 8601 format or relative like "now-1h")'),
  to: z.string().describe('End time for analysis (ISO 8601 format or relative like "now")'),
  traceId: z.string().optional().describe('Specific trace ID to analyze'),
  percentile: z.number().optional().describe('Percentile for critical path analysis (default: 95)'),
  minDuration: z.number().optional().describe('Minimum duration in ms to consider (default: 100)')
};

type CriticalPathAnalysisArgs = MCPToolSchema<typeof CriticalPathAnalysisArgsSchema>;

/**
 * Tool for analyzing critical paths in distributed traces to identify performance bottlenecks
 */
export class CriticalPathAnalysisTool extends BaseTool<typeof CriticalPathAnalysisArgsSchema> {
  // Static schema property
  static readonly schema = CriticalPathAnalysisArgsSchema;
  
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'analyzeCriticalPath',
      category: ToolCategory.ANALYSIS,
      description: 'Identify performance bottlenecks in distributed traces and optimization opportunities',
      requiredCapabilities: []
    });
  }
  
  protected getSchema() {
    return CriticalPathAnalysisArgsSchema;
  }
  
  protected async executeImpl(args: CriticalPathAnalysisArgs): Promise<any> {
    const config = ConfigLoader.get();
    const percentile = args.percentile || 95;
    const minDuration = args.minDuration || 100;
    const timeRange = { from: args.from, to: args.to };
    
    let traces: any[] = [];
    
    // If specific trace ID provided, analyze that trace
    if (args.traceId) {
      const trace = await this.getTraceById(args.traceId);
      if (trace) {
        traces = [trace];
      }
    } else {
      // Find traces matching criteria
      traces = await this.findTraces(timeRange, args.service, args.operation, percentile);
    }
    
    if (traces.length === 0) {
      return this.formatJsonOutput({
        message: 'No traces found matching the criteria',
        criteria: {
          timeRange: timeRange,
          service: args.service,
          operation: args.operation
        }
      });
    }
    
    // Analyze critical paths for each trace
    const criticalPaths = traces.map(trace => this.analyzeCriticalPath(trace, minDuration));
    
    // Aggregate critical path statistics
    const aggregatedStats = this.aggregateCriticalPathStats(criticalPaths);
    
    // Identify common bottlenecks
    const bottlenecks = this.identifyBottlenecks(criticalPaths);
    
    // Calculate optimization opportunities
    const optimizationOpportunities = this.calculateOptimizationOpportunities(
      criticalPaths,
      bottlenecks
    );
    
    // Generate performance insights
    const performanceInsights = this.generatePerformanceInsights(
      aggregatedStats,
      bottlenecks,
      optimizationOpportunities
    );
    
    return this.formatJsonOutput({
      analysis: {
        tracesAnalyzed: traces.length,
        timeRange: timeRange,
        service: args.service,
        operation: args.operation,
        percentile
      },
      criticalPathStats: {
        avgCriticalPathDuration: aggregatedStats.avgDuration,
        p50Duration: aggregatedStats.p50Duration,
        p95Duration: aggregatedStats.p95Duration,
        p99Duration: aggregatedStats.p99Duration,
        avgCriticalPathLength: aggregatedStats.avgLength,
        mostCommonPath: aggregatedStats.mostCommonPath
      },
      bottlenecks: {
        services: bottlenecks.services,
        operations: bottlenecks.operations,
        dependencies: bottlenecks.dependencies
      },
      optimizationOpportunities: {
        totalPotentialSaving: optimizationOpportunities.totalSaving,
        opportunities: optimizationOpportunities.opportunities,
        prioritizedActions: optimizationOpportunities.prioritizedActions
      },
      pathBreakdown: this.generatePathBreakdown(criticalPaths),
      insights: performanceInsights,
      recommendations: this.generateRecommendations(
        bottlenecks,
        optimizationOpportunities,
        aggregatedStats
      ),
      summary: this.generateCriticalPathSummary(
        aggregatedStats,
        bottlenecks,
        optimizationOpportunities
      )
    });
  }
  
  private async getTraceById(traceId: string): Promise<any> {
    const config = ConfigLoader.get();
    
    const query = {
      term: { [config.telemetry.fields.traceId]: traceId }
    };
    
    const result = await this.adapter.query<TraceDocument>(
      config.telemetry.indices.traces,
      query,
      {
        size: 1000,
        sort: [{ [config.telemetry.fields.timestamp]: 'asc' }]
      }
    );
    
    if (result.hits.total.value === 0) {
      return null;
    }
    
    const spans = result.hits.hits.map(hit => hit._source);
    
    return {
      traceId,
      spans,
      rootSpan: spans.find((s: any) => !s['span.parent_id'] || s['span.parent_id'] === s['span.id']),
      duration: this.calculateTraceDuration(spans)
    };
  }
  
  private async findTraces(
    timeRange: any,
    service?: string,
    operation?: string,
    percentile?: number
  ): Promise<any[]> {
    const config = ConfigLoader.get();
    
    const query: any = {
      bool: {
        must: [
          { range: { [config.telemetry.fields.timestamp]: timeRange } }
        ],
        filter: []
      }
    };
    
    if (service) {
      query.bool.filter.push({ term: { [config.telemetry.fields.service]: service } });
    }
    
    if (operation) {
      query.bool.filter.push({ term: { 'span.name.keyword': operation } });
    }
    
    // Get high-latency traces around the specified percentile
    const traceAggResult = await this.adapter.query(
      config.telemetry.indices.traces,
      query,
      {
        size: 0,
        aggregations: {
          traces: {
            terms: {
              field: config.telemetry.fields.traceId,
              size: 100,
              order: { total_duration: 'desc' }
            },
            aggs: {
              total_duration: {
                sum: { field: 'duration' }
              },
              span_count: {
                value_count: { field: 'span.id' }
              }
            }
          },
          duration_percentiles: {
            percentiles: {
              field: 'duration',
              percents: [50, 75, 90, 95, 99]
            }
          }
        }
      }
    );
    
    const traceIds = traceAggResult.aggregations?.traces?.buckets || [];
    const durationPercentiles = traceAggResult.aggregations?.duration_percentiles?.values || {};
    const targetDuration = durationPercentiles[`${percentile}.0`] || 0;
    
    // Filter traces around the target percentile
    const targetTraceIds = traceIds
      .filter((t: any) => t.total_duration.value >= targetDuration * 0.9)
      .slice(0, 20)
      .map((t: any) => t.key);
    
    // Get full trace data
    const traces = [];
    for (const traceId of targetTraceIds) {
      const trace = await this.getTraceById(traceId);
      if (trace) {
        traces.push(trace);
      }
    }
    
    return traces;
  }
  
  private calculateTraceDuration(spans: any[]): number {
    if (spans.length === 0) return 0;
    
    const timestamps = spans.map(s => new Date(s['@timestamp']).getTime());
    const durations = spans.map(s => s.duration || 0);
    
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps.map((t, i) => t + durations[i]));
    
    return maxTime - minTime;
  }
  
  private analyzeCriticalPath(trace: any, minDuration: number): any {
    const spanMap = new Map<string, any>();
    const childrenMap = new Map<string, any[]>();
    
    // Build span relationships
    trace.spans.forEach((span: any) => {
      const spanId = span['span.id'];
      const parentId = span['span.parent_id'];
      
      spanMap.set(spanId, span);
      
      if (parentId && parentId !== spanId) {
        if (!childrenMap.has(parentId)) {
          childrenMap.set(parentId, []);
        }
        childrenMap.get(parentId)?.push(span);
      }
    });
    
    // Find root span
    const rootSpan = trace.rootSpan || trace.spans.find((s: any) => 
      !s['span.parent_id'] || s['span.parent_id'] === s['span.id']
    );
    
    if (!rootSpan) {
      return {
        traceId: trace.traceId,
        path: [],
        duration: 0,
        error: 'No root span found'
      };
    }
    
    // Calculate critical path
    const criticalPath = this.findCriticalPath(rootSpan, spanMap, childrenMap, minDuration);
    
    // Calculate path statistics
    const pathStats = this.calculatePathStatistics(criticalPath);
    
    return {
      traceId: trace.traceId,
      path: criticalPath,
      duration: pathStats.totalDuration,
      selfTime: pathStats.totalSelfTime,
      waitTime: pathStats.totalWaitTime,
      services: pathStats.services,
      operations: pathStats.operations,
      depth: criticalPath.length,
      pattern: criticalPath.map(s => `${s.service}:${s['span.name']}`).join(' → ')
    };
  }
  
  private findCriticalPath(
    span: any,
    spanMap: Map<string, any>,
    childrenMap: Map<string, any[]>,
    minDuration: number
  ): any[] {
    const children = childrenMap.get(span['span.id']) || [];
    
    if (children.length === 0) {
      // Leaf node
      return span.duration >= minDuration ? [span] : [];
    }
    
    // Find the child with the longest critical path
    let longestPath: any[] = [];
    let longestDuration = 0;
    
    for (const child of children) {
      const childPath = this.findCriticalPath(child, spanMap, childrenMap, minDuration);
      const childDuration = childPath.reduce((sum, s) => sum + (s.duration || 0), 0);
      
      if (childDuration > longestDuration) {
        longestDuration = childDuration;
        longestPath = childPath;
      }
    }
    
    // Include this span if it meets the minimum duration
    if (span.duration >= minDuration) {
      return [span, ...longestPath];
    }
    
    return longestPath;
  }
  
  private calculatePathStatistics(path: any[]): any {
    const services = new Set<string>();
    const operations = new Set<string>();
    let totalDuration = 0;
    let totalSelfTime = 0;
    let totalWaitTime = 0;
    
    for (let i = 0; i < path.length; i++) {
      const span = path[i];
      services.add(span.service);
      operations.add(span['span.name']);
      
      const duration = span.duration || 0;
      totalDuration += duration;
      
      // Calculate self time (time not spent in child spans)
      if (i < path.length - 1) {
        const childDuration = path[i + 1].duration || 0;
        const selfTime = duration - childDuration;
        totalSelfTime += Math.max(0, selfTime);
      } else {
        totalSelfTime += duration;
      }
    }
    
    // Wait time is the difference between total path time and sum of durations
    totalWaitTime = Math.max(0, totalDuration - totalSelfTime);
    
    return {
      totalDuration,
      totalSelfTime,
      totalWaitTime,
      services: Array.from(services),
      operations: Array.from(operations)
    };
  }
  
  private aggregateCriticalPathStats(criticalPaths: any[]): any {
    const durations = criticalPaths.map(p => p.duration);
    const lengths = criticalPaths.map(p => p.path.length);
    const patterns = criticalPaths.map(p => p.pattern);
    
    // Count pattern frequency
    const patternCounts = new Map<string, number>();
    patterns.forEach(pattern => {
      patternCounts.set(pattern, (patternCounts.get(pattern) || 0) + 1);
    });
    
    // Find most common pattern
    const mostCommonPattern = Array.from(patternCounts.entries())
      .sort(([, a], [, b]) => b - a)[0];
    
    return {
      avgDuration: this.calculateAverage(durations),
      p50Duration: this.calculatePercentile(durations, 50),
      p95Duration: this.calculatePercentile(durations, 95),
      p99Duration: this.calculatePercentile(durations, 99),
      avgLength: this.calculateAverage(lengths),
      mostCommonPath: mostCommonPattern ? {
        pattern: mostCommonPattern[0],
        frequency: mostCommonPattern[1],
        percentage: (mostCommonPattern[1] / criticalPaths.length) * 100
      } : null
    };
  }
  
  private identifyBottlenecks(criticalPaths: any[]): any {
    const serviceTimes = new Map<string, number[]>();
    const operationTimes = new Map<string, number[]>();
    const dependencyTimes = new Map<string, number[]>();
    
    // Aggregate times by service, operation, and dependency
    criticalPaths.forEach(cp => {
      cp.path.forEach((span: any, index: number) => {
        const service = span.service;
        const operation = span['span.name'];
        const duration = span.duration || 0;
        
        // Service times
        if (!serviceTimes.has(service)) {
          serviceTimes.set(service, []);
        }
        serviceTimes.get(service)?.push(duration);
        
        // Operation times
        const opKey = `${service}:${operation}`;
        if (!operationTimes.has(opKey)) {
          operationTimes.set(opKey, []);
        }
        operationTimes.get(opKey)?.push(duration);
        
        // Dependency times (between consecutive spans)
        if (index > 0) {
          const prevSpan = cp.path[index - 1];
          const depKey = `${prevSpan.service} → ${service}`;
          if (!dependencyTimes.has(depKey)) {
            dependencyTimes.set(depKey, []);
          }
          // Calculate time between spans
          const prevEnd = new Date(prevSpan['@timestamp']).getTime() + (prevSpan.duration || 0);
          const currentStart = new Date(span['@timestamp']).getTime();
          const gapTime = Math.max(0, currentStart - prevEnd);
          dependencyTimes.get(depKey)?.push(gapTime);
        }
      });
    });
    
    // Calculate bottleneck scores
    const serviceBottlenecks = this.calculateBottleneckScores(serviceTimes, 'service');
    const operationBottlenecks = this.calculateBottleneckScores(operationTimes, 'operation');
    const dependencyBottlenecks = this.calculateBottleneckScores(dependencyTimes, 'dependency');
    
    return {
      services: serviceBottlenecks,
      operations: operationBottlenecks,
      dependencies: dependencyBottlenecks
    };
  }
  
  private calculateBottleneckScores(timesMap: Map<string, number[]>, type: string): any[] {
    const scores: any[] = [];
    
    for (const [key, times] of timesMap) {
      const avgTime = this.calculateAverage(times);
      const p95Time = this.calculatePercentile(times, 95);
      const frequency = times.length;
      
      // Calculate bottleneck score
      const score = (avgTime * 0.5 + p95Time * 0.3) * Math.log(frequency + 1);
      
      scores.push({
        [type]: key,
        avgDuration: avgTime,
        p95Duration: p95Time,
        frequency,
        impact: score,
        contribution: 0 // Will be calculated after sorting
      });
    }
    
    // Sort by impact and calculate contribution percentage
    scores.sort((a, b) => b.impact - a.impact);
    const totalImpact = scores.reduce((sum, s) => sum + s.impact, 0);
    
    scores.forEach(s => {
      s.contribution = totalImpact > 0 ? (s.impact / totalImpact) * 100 : 0;
    });
    
    return scores.slice(0, 10); // Top 10 bottlenecks
  }
  
  private calculateOptimizationOpportunities(
    criticalPaths: any[],
    bottlenecks: any
  ): any {
    const opportunities: any[] = [];
    let totalSaving = 0;
    
    // Service optimization opportunities
    bottlenecks.services.forEach((bottleneck: any) => {
      const potentialSaving = bottleneck.avgDuration * 0.3; // Assume 30% improvement possible
      opportunities.push({
        type: 'service_optimization',
        target: bottleneck.service,
        currentAvgDuration: bottleneck.avgDuration,
        potentialSaving,
        estimatedNewDuration: bottleneck.avgDuration - potentialSaving,
        impact: bottleneck.contribution,
        effort: this.estimateOptimizationEffort(bottleneck.avgDuration)
      });
      totalSaving += potentialSaving * bottleneck.frequency;
    });
    
    // Operation optimization opportunities
    bottlenecks.operations.slice(0, 5).forEach((bottleneck: any) => {
      const potentialSaving = bottleneck.avgDuration * 0.4; // Assume 40% improvement possible
      opportunities.push({
        type: 'operation_optimization',
        target: bottleneck.operation,
        currentAvgDuration: bottleneck.avgDuration,
        potentialSaving,
        estimatedNewDuration: bottleneck.avgDuration - potentialSaving,
        impact: bottleneck.contribution,
        effort: this.estimateOptimizationEffort(bottleneck.avgDuration)
      });
      totalSaving += potentialSaving * bottleneck.frequency;
    });
    
    // Dependency optimization opportunities
    bottlenecks.dependencies.slice(0, 3).forEach((bottleneck: any) => {
      if (bottleneck.avgDuration > 10) { // Only consider significant gaps
        const potentialSaving = bottleneck.avgDuration * 0.5; // Assume 50% improvement possible
        opportunities.push({
          type: 'dependency_optimization',
          target: bottleneck.dependency,
          currentAvgDuration: bottleneck.avgDuration,
          potentialSaving,
          estimatedNewDuration: bottleneck.avgDuration - potentialSaving,
          impact: bottleneck.contribution,
          effort: 'medium',
          suggestion: 'Consider connection pooling, caching, or service colocation'
        });
        totalSaving += potentialSaving * bottleneck.frequency;
      }
    });
    
    // Prioritize opportunities by ROI (impact / effort)
    const prioritizedActions = opportunities
      .map(opp => ({
        ...opp,
        roi: opp.impact / this.effortToNumber(opp.effort)
      }))
      .sort((a, b) => b.roi - a.roi)
      .slice(0, 10);
    
    return {
      opportunities,
      totalSaving,
      prioritizedActions
    };
  }
  
  private estimateOptimizationEffort(duration: number): string {
    if (duration > 1000) return 'high';
    if (duration > 500) return 'medium';
    return 'low';
  }
  
  private effortToNumber(effort: string): number {
    switch (effort) {
      case 'low': return 1;
      case 'medium': return 2;
      case 'high': return 3;
      default: return 2;
    }
  }
  
  private generatePathBreakdown(criticalPaths: any[]): any {
    const breakdown = {
      byService: new Map<string, any>(),
      byOperation: new Map<string, any>(),
      pathComplexity: {
        simple: 0,  // <= 3 services
        moderate: 0, // 4-6 services
        complex: 0   // > 6 services
      }
    };
    
    criticalPaths.forEach(cp => {
      // Path complexity
      const serviceCount = cp.services.length;
      if (serviceCount <= 3) breakdown.pathComplexity.simple++;
      else if (serviceCount <= 6) breakdown.pathComplexity.moderate++;
      else breakdown.pathComplexity.complex++;
      
      // Service breakdown
      cp.services.forEach((service: string) => {
        if (!breakdown.byService.has(service)) {
          breakdown.byService.set(service, {
            frequency: 0,
            avgTimeInPath: 0,
            totalTime: 0
          });
        }
        const serviceStats = breakdown.byService.get(service);
        serviceStats.frequency++;
        
        // Calculate time spent in this service
        const serviceTime = cp.path
          .filter((s: any) => s.service === service)
          .reduce((sum: number, s: any) => sum + (s.duration || 0), 0);
        serviceStats.totalTime += serviceTime;
        serviceStats.avgTimeInPath = serviceStats.totalTime / serviceStats.frequency;
      });
    });
    
    return {
      serviceInvolvement: Array.from(breakdown.byService.entries())
        .map(([service, stats]) => ({ service, ...stats }))
        .sort((a, b) => b.frequency - a.frequency),
      pathComplexity: breakdown.pathComplexity,
      avgPathComplexity: criticalPaths.reduce((sum, cp) => sum + cp.services.length, 0) / criticalPaths.length
    };
  }
  
  private generatePerformanceInsights(
    aggregatedStats: any,
    bottlenecks: any,
    optimizationOpportunities: any
  ): any[] {
    const insights: any[] = [];
    
    // Critical path duration insight
    if (aggregatedStats.p95Duration > 1000) {
      insights.push({
        type: 'high_latency',
        severity: aggregatedStats.p95Duration > 3000 ? 'high' : 'medium',
        description: `P95 critical path duration is ${aggregatedStats.p95Duration.toFixed(0)}ms`,
        recommendation: 'Focus on optimizing the most time-consuming operations'
      });
    }
    
    // Bottleneck concentration insight
    const topBottleneck = bottlenecks.services[0];
    if (topBottleneck && topBottleneck.contribution > 30) {
      insights.push({
        type: 'bottleneck_concentration',
        severity: 'high',
        description: `${topBottleneck.service} accounts for ${topBottleneck.contribution.toFixed(1)}% of critical path time`,
        recommendation: `Prioritize optimization efforts on ${topBottleneck.service}`
      });
    }
    
    // Path complexity insight
    if (aggregatedStats.avgLength > 10) {
      insights.push({
        type: 'complex_paths',
        severity: 'medium',
        description: `Average critical path length is ${aggregatedStats.avgLength.toFixed(1)} spans`,
        recommendation: 'Consider service consolidation or caching to reduce path complexity'
      });
    }
    
    // Optimization potential insight
    if (optimizationOpportunities.totalSaving > 500) {
      insights.push({
        type: 'optimization_potential',
        severity: 'info',
        description: `Potential to save ${optimizationOpportunities.totalSaving.toFixed(0)}ms through optimizations`,
        recommendation: 'Implement prioritized optimization actions'
      });
    }
    
    return insights;
  }
  
  private generateRecommendations(
    bottlenecks: any,
    optimizationOpportunities: any,
    aggregatedStats: any
  ): any[] {
    const recommendations: any[] = [];
    
    // Top service optimization
    const topService = bottlenecks.services[0];
    if (topService) {
      recommendations.push({
        priority: 'high',
        category: 'performance',
        action: `Optimize ${topService.service} service performance`,
        impact: `Could reduce critical path duration by up to ${(topService.contribution * 0.3).toFixed(1)}%`,
        implementation: [
          'Profile the service to identify hot spots',
          'Optimize database queries',
          'Implement caching where appropriate',
          'Consider async processing for non-critical operations'
        ]
      });
    }
    
    // Top operation optimization
    const topOperation = bottlenecks.operations[0];
    if (topOperation && topOperation.avgDuration > 500) {
      recommendations.push({
        priority: 'high',
        category: 'performance',
        action: `Optimize ${topOperation.operation} operation`,
        impact: `Average duration of ${topOperation.avgDuration.toFixed(0)}ms can be reduced`,
        implementation: [
          'Review algorithm efficiency',
          'Add appropriate indexes',
          'Implement request batching',
          'Use parallel processing where possible'
        ]
      });
    }
    
    // Dependency optimization
    const topDependency = bottlenecks.dependencies[0];
    if (topDependency && topDependency.avgDuration > 50) {
      recommendations.push({
        priority: 'medium',
        category: 'architecture',
        action: `Optimize communication between ${topDependency.dependency}`,
        impact: `Reduce network latency of ${topDependency.avgDuration.toFixed(0)}ms`,
        implementation: [
          'Implement connection pooling',
          'Use keep-alive connections',
          'Consider service mesh for better routing',
          'Evaluate service colocation options'
        ]
      });
    }
    
    // Path complexity recommendation
    if (aggregatedStats.avgLength > 8) {
      recommendations.push({
        priority: 'medium',
        category: 'architecture',
        action: 'Reduce critical path complexity',
        impact: 'Simplify service interactions and reduce failure points',
        implementation: [
          'Consolidate closely related services',
          'Implement API gateways for common patterns',
          'Use event-driven architecture for non-critical flows',
          'Cache frequently accessed data'
        ]
      });
    }
    
    return recommendations;
  }
  
  private generateCriticalPathSummary(
    aggregatedStats: any,
    bottlenecks: any,
    optimizationOpportunities: any
  ): string {
    const parts: string[] = [];
    
    parts.push(`Average critical path duration: ${aggregatedStats.avgDuration.toFixed(0)}ms.`);
    
    if (bottlenecks.services.length > 0) {
      const topService = bottlenecks.services[0];
      parts.push(`${topService.service} is the primary bottleneck (${topService.contribution.toFixed(1)}%).`);
    }
    
    if (optimizationOpportunities.totalSaving > 100) {
      parts.push(`Optimization potential: ${optimizationOpportunities.totalSaving.toFixed(0)}ms.`);
    }
    
    return parts.join(' ');
  }
  
  // Helper methods
  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }
  
  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
}