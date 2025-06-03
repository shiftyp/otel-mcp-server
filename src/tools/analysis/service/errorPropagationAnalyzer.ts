import { z } from 'zod';
import { BaseTool, ToolCategory } from '../../base/tool.js';
import { BaseSearchAdapter } from '../../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../../config/index.js';
import { MCPToolSchema } from '../../../types.js';
import { TraceDocument } from '../../../types/opensearch-types.js';

// Define the Zod schema
const ErrorPropagationAnalyzerArgsSchema = {
  traceId: z.string().optional().describe('Specific trace ID to analyze error propagation'),
  service: z.string().optional().describe('Service to analyze error propagation from'),
  from: z.string().describe('Start time for analysis (ISO 8601 format or relative like "now-1h")'),
  to: z.string().describe('End time for analysis (ISO 8601 format or relative like "now")'),
  errorType: z.string().optional().describe('Specific error type to analyze'),
  includeDownstream: z.boolean().optional().describe('Include downstream error propagation analysis (default: true)'),
  includeUpstream: z.boolean().optional().describe('Include upstream error propagation analysis (default: true)')
};

type ErrorPropagationAnalyzerArgs = MCPToolSchema<typeof ErrorPropagationAnalyzerArgsSchema>;

/**
 * Tool for analyzing how errors propagate through service dependencies
 */
export class ErrorPropagationAnalyzerTool extends BaseTool<typeof ErrorPropagationAnalyzerArgsSchema> {
  // Static schema property
  static readonly schema = ErrorPropagationAnalyzerArgsSchema;
  
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'analyzeErrorPropagation',
      category: ToolCategory.ANALYSIS,
      description: 'Analyze how errors propagate through service dependencies and identify root causes',
      requiredCapabilities: []
    });
  }
  
  protected getSchema() {
    return ErrorPropagationAnalyzerArgsSchema;
  }
  
  protected async executeImpl(args: ErrorPropagationAnalyzerArgs): Promise<any> {
    const config = ConfigLoader.get();
    const includeDownstream = args.includeDownstream ?? true;
    const includeUpstream = args.includeUpstream ?? true;
    const timeRange = { from: args.from, to: args.to };
    
    let errorTraces: any[] = [];
    
    // If specific trace ID provided, analyze that trace
    if (args.traceId) {
      const trace = await this.analyzeSpecificTrace(args.traceId);
      if (trace) {
        errorTraces = [trace];
      }
    } else {
      // Find error traces in the time range
      errorTraces = await this.findErrorTraces(timeRange, args.service, args.errorType);
    }
    
    if (errorTraces.length === 0) {
      return this.formatJsonOutput({
        message: 'No error traces found matching the criteria',
        criteria: {
          timeRange: timeRange,
          service: args.service,
          errorType: args.errorType
        }
      });
    }
    
    // Analyze error propagation patterns
    const propagationPatterns = await this.analyzeErrorPropagation(errorTraces);
    
    // Identify error sources
    const errorSources = this.identifyErrorSources(propagationPatterns);
    
    // Calculate propagation impact
    const propagationImpact = this.calculatePropagationImpact(propagationPatterns);
    
    // Analyze error cascades
    const errorCascades = this.analyzeErrorCascades(propagationPatterns);
    
    // Generate mitigation strategies
    const mitigationStrategies = this.generateMitigationStrategies(
      errorSources,
      propagationImpact,
      errorCascades
    );
    
    // Build service dependency error map
    const dependencyErrorMap = await this.buildDependencyErrorMap(
      errorTraces,
      includeDownstream,
      includeUpstream
    );
    
    return this.formatJsonOutput({
      analysis: {
        totalErrorTraces: errorTraces.length,
        timeRange: timeRange,
        service: args.service,
        errorType: args.errorType
      },
      errorSources: {
        primary: errorSources.primary,
        secondary: errorSources.secondary,
        distribution: errorSources.distribution
      },
      propagationPatterns: {
        patterns: propagationPatterns.patterns,
        frequency: propagationPatterns.frequency,
        avgPropagationDepth: propagationPatterns.avgDepth,
        maxPropagationDepth: propagationPatterns.maxDepth
      },
      propagationImpact: {
        affectedServices: propagationImpact.affectedServices,
        errorAmplification: propagationImpact.amplification,
        cascadeRisk: propagationImpact.cascadeRisk,
        impactScore: propagationImpact.score
      },
      errorCascades: {
        detected: errorCascades.length > 0,
        cascades: errorCascades,
        largestCascade: errorCascades[0] || null
      },
      dependencyErrorMap,
      mitigation: mitigationStrategies,
      insights: this.generateErrorPropagationInsights(
        errorSources,
        propagationPatterns,
        propagationImpact
      ),
      summary: this.generatePropagationSummary(
        errorTraces.length,
        errorSources,
        propagationImpact
      )
    });
  }
  
  private async analyzeSpecificTrace(traceId: string): Promise<any> {
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
    const errorSpans = spans.filter((span: any) => 
      span[config.telemetry.fields.status] === 'ERROR'
    );
    
    return {
      traceId,
      spans,
      errorSpans,
      services: [...new Set(spans.map((s: any) => s[config.telemetry.fields.service]))],
      errorServices: [...new Set(errorSpans.map((s: any) => s[config.telemetry.fields.service]))]
    };
  }
  
  private async findErrorTraces(
    timeRange: any,
    service?: string,
    errorType?: string
  ): Promise<any[]> {
    const config = ConfigLoader.get();
    
    const query: any = {
      bool: {
        must: [
          { term: { [config.telemetry.fields.status]: 'ERROR' } },
          { range: { [config.telemetry.fields.timestamp]: timeRange } }
        ]
      }
    };
    
    if (service) {
      query.bool.must.push({ term: { [config.telemetry.fields.service]: service } });
    }
    
    if (errorType) {
      query.bool.must.push({ term: { 'error.type.keyword': errorType } });
    }
    
    // First get unique trace IDs with errors
    const errorTracesResult = await this.adapter.query(
      config.telemetry.indices.traces,
      query,
      {
        size: 0,
        aggregations: {
          error_traces: {
            terms: {
              field: config.telemetry.fields.traceId,
              size: 100
            },
            aggs: {
              services: {
                terms: { field: config.telemetry.fields.service }
              },
              error_types: {
                terms: { field: 'error.type.keyword' }
              },
              first_error: {
                top_hits: {
                  size: 1,
                  sort: [{ [config.telemetry.fields.timestamp]: 'asc' }]
                }
              }
            }
          }
        }
      }
    );
    
    const errorTraceIds = errorTracesResult.aggregations?.error_traces?.buckets || [];
    
    // Get full trace data for each error trace
    const traces = [];
    for (const traceBucket of errorTraceIds.slice(0, 50)) { // Limit to 50 traces
      const trace = await this.analyzeSpecificTrace(traceBucket.key);
      if (trace) {
        trace.errorTypes = traceBucket.error_types?.buckets?.map((b: any) => b.key) || [];
        trace.firstError = traceBucket.first_error?.hits?.hits?.[0]?._source;
        traces.push(trace);
      }
    }
    
    return traces;
  }
  
  private async analyzeErrorPropagation(errorTraces: any[]): Promise<any> {
    const patterns: any[] = [];
    const patternFrequency = new Map<string, number>();
    let totalDepth = 0;
    let maxDepth = 0;
    
    for (const trace of errorTraces) {
      // Build span dependency graph
      const spanGraph = this.buildSpanDependencyGraph(trace.spans);
      
      // Find error propagation paths
      const errorPaths = this.findErrorPropagationPaths(trace.errorSpans, spanGraph);
      
      for (const path of errorPaths) {
        const pattern = this.identifyPropagationPattern(path, trace.spans);
        patterns.push(pattern);
        
        // Track pattern frequency
        const patternKey = `${pattern.type}_${pattern.direction}`;
        patternFrequency.set(patternKey, (patternFrequency.get(patternKey) || 0) + 1);
        
        // Track depth
        totalDepth += path.length;
        maxDepth = Math.max(maxDepth, path.length);
      }
    }
    
    return {
      patterns: this.consolidatePatterns(patterns),
      frequency: Array.from(patternFrequency.entries()).map(([pattern, count]) => ({
        pattern,
        count,
        percentage: (count / patterns.length) * 100
      })),
      avgDepth: patterns.length > 0 ? totalDepth / patterns.length : 0,
      maxDepth
    };
  }
  
  private buildSpanDependencyGraph(spans: any[]): Map<string, any> {
    const graph = new Map();
    
    for (const span of spans) {
      const spanId = span['span.id'];
      const parentId = span['span.parent_id'];
      
      if (!graph.has(spanId)) {
        graph.set(spanId, {
          span,
          children: [],
          parent: null
        });
      }
      
      if (parentId && parentId !== spanId) {
        if (!graph.has(parentId)) {
          graph.set(parentId, {
            span: null,
            children: [],
            parent: null
          });
        }
        
        graph.get(parentId).children.push(spanId);
        graph.get(spanId).parent = parentId;
      }
    }
    
    return graph;
  }
  
  private findErrorPropagationPaths(errorSpans: any[], spanGraph: Map<string, any>): any[] {
    const paths: any[] = [];
    
    for (const errorSpan of errorSpans) {
      const spanId = errorSpan['span.id'];
      const node = spanGraph.get(spanId);
      
      if (!node) continue;
      
      // Find downstream propagation
      const downstreamPath = this.findDownstreamErrors(spanId, spanGraph, new Set());
      if (downstreamPath.length > 1) {
        paths.push({
          type: 'downstream',
          path: downstreamPath,
          source: errorSpan
        });
      }
      
      // Find upstream propagation
      const upstreamPath = this.findUpstreamErrors(spanId, spanGraph, new Set());
      if (upstreamPath.length > 1) {
        paths.push({
          type: 'upstream',
          path: upstreamPath.reverse(),
          source: errorSpan
        });
      }
    }
    
    return paths;
  }
  
  private findDownstreamErrors(
    spanId: string,
    graph: Map<string, any>,
    visited: Set<string>
  ): any[] {
    if (visited.has(spanId)) return [];
    visited.add(spanId);
    
    const node = graph.get(spanId);
    if (!node || !node.span) return [];
    
    const path = [node.span];
    
    // Check children for errors
    for (const childId of node.children) {
      const childNode = graph.get(childId);
      if (childNode?.span?.status === 'ERROR') {
        const childPath = this.findDownstreamErrors(childId, graph, visited);
        if (childPath.length > 0) {
          path.push(...childPath);
        }
      }
    }
    
    return path;
  }
  
  private findUpstreamErrors(
    spanId: string,
    graph: Map<string, any>,
    visited: Set<string>
  ): any[] {
    if (visited.has(spanId)) return [];
    visited.add(spanId);
    
    const node = graph.get(spanId);
    if (!node || !node.span) return [];
    
    const path = [node.span];
    
    // Check parent for errors
    if (node.parent) {
      const parentNode = graph.get(node.parent);
      if (parentNode?.span?.status === 'ERROR') {
        const parentPath = this.findUpstreamErrors(node.parent, graph, visited);
        if (parentPath.length > 0) {
          path.push(...parentPath);
        }
      }
    }
    
    return path;
  }
  
  private identifyPropagationPattern(propagationPath: any, allSpans: any[]): any {
    const { path, type, source } = propagationPath;
    const services = path.map((span: any) => span.service);
    const uniqueServices = [...new Set(services)];
    
    // Identify pattern type
    let patternType = 'simple';
    if (uniqueServices.length !== services.length) {
      patternType = 'circular';
    } else if (services.length > 3) {
      patternType = 'cascade';
    }
    
    // Calculate timing
    const timestamps = path.map((span: any) => new Date(span['@timestamp']).getTime());
    const propagationTime = Math.max(...timestamps) - Math.min(...timestamps);
    
    // Identify error transformation
    const errorTypes = path
      .filter((span: any) => span.status === 'ERROR')
      .map((span: any) => span['error.type'] || 'unknown');
    const errorTransformation = new Set(errorTypes).size > 1;
    
    return {
      type: patternType,
      direction: type,
      sourceService: source.service,
      affectedServices: uniqueServices,
      propagationDepth: path.length,
      propagationTime,
      errorTransformation,
      errorTypes: [...new Set(errorTypes)],
      pattern: services.join(' → ')
    };
  }
  
  private consolidatePatterns(patterns: any[]): any[] {
    const consolidated = new Map<string, any>();
    
    for (const pattern of patterns) {
      const key = pattern.pattern;
      
      if (!consolidated.has(key)) {
        consolidated.set(key, {
          ...pattern,
          occurrences: 0,
          avgPropagationTime: 0,
          totalPropagationTime: 0
        });
      }
      
      const existing = consolidated.get(key);
      existing.occurrences++;
      existing.totalPropagationTime += pattern.propagationTime;
      existing.avgPropagationTime = existing.totalPropagationTime / existing.occurrences;
    }
    
    return Array.from(consolidated.values())
      .sort((a, b) => b.occurrences - a.occurrences);
  }
  
  private identifyErrorSources(propagationPatterns: any): any {
    const sourceCounts = new Map<string, number>();
    const sourceErrors = new Map<string, Set<string>>();
    
    // Count error sources
    for (const pattern of propagationPatterns.patterns) {
      const source = pattern.sourceService;
      sourceCounts.set(source, (sourceCounts.get(source) || 0) + pattern.occurrences);
      
      if (!sourceErrors.has(source)) {
        sourceErrors.set(source, new Set());
      }
      pattern.errorTypes.forEach((type: string) => sourceErrors.get(source)?.add(type));
    }
    
    // Sort by frequency
    const sortedSources = Array.from(sourceCounts.entries())
      .sort(([, a], [, b]) => b - a);
    
    // Identify primary and secondary sources
    const primary = sortedSources.slice(0, 3).map(([service, count]) => ({
      service,
      errorCount: count,
      errorTypes: Array.from(sourceErrors.get(service) || [])
    }));
    
    const secondary = sortedSources.slice(3, 10).map(([service, count]) => ({
      service,
      errorCount: count,
      errorTypes: Array.from(sourceErrors.get(service) || [])
    }));
    
    return {
      primary,
      secondary,
      distribution: sortedSources.map(([service, count]) => ({
        service,
        percentage: (count / propagationPatterns.patterns.reduce((sum: number, p: any) => sum + p.occurrences, 0)) * 100
      }))
    };
  }
  
  private calculatePropagationImpact(propagationPatterns: any): any {
    const affectedServices = new Set<string>();
    let totalAmplification = 0;
    let cascadeCount = 0;
    
    for (const pattern of propagationPatterns.patterns) {
      pattern.affectedServices.forEach((service: string) => affectedServices.add(service));
      
      // Calculate amplification (how many services affected per error)
      const amplification = pattern.affectedServices.length;
      totalAmplification += amplification * pattern.occurrences;
      
      // Count cascades
      if (pattern.type === 'cascade') {
        cascadeCount += pattern.occurrences;
      }
    }
    
    const totalErrors = propagationPatterns.patterns.reduce((sum: number, p: any) => sum + p.occurrences, 0);
    const avgAmplification = totalErrors > 0 ? totalAmplification / totalErrors : 0;
    
    // Calculate impact score
    const impactScore = Math.min(100, 
      (affectedServices.size * 10) + 
      (avgAmplification * 5) + 
      (cascadeCount * 2)
    );
    
    return {
      affectedServices: Array.from(affectedServices),
      totalAffectedServices: affectedServices.size,
      amplification: {
        average: avgAmplification,
        max: Math.max(...propagationPatterns.patterns.map((p: any) => p.affectedServices.length))
      },
      cascadeRisk: {
        cascadeCount,
        cascadePercentage: totalErrors > 0 ? (cascadeCount / totalErrors) * 100 : 0,
        risk: cascadeCount > 10 ? 'high' : cascadeCount > 5 ? 'medium' : 'low'
      },
      score: impactScore
    };
  }
  
  private analyzeErrorCascades(propagationPatterns: any): any[] {
    const cascades = propagationPatterns.patterns
      .filter((p: any) => p.type === 'cascade')
      .map((pattern: any) => ({
        pattern: pattern.pattern,
        depth: pattern.propagationDepth,
        affectedServices: pattern.affectedServices,
        occurrences: pattern.occurrences,
        avgPropagationTime: pattern.avgPropagationTime,
        errorTypes: pattern.errorTypes,
        severity: this.calculateCascadeSeverity(pattern)
      }))
      .sort((a: any, b: any) => b.severity - a.severity);
    
    return cascades;
  }
  
  private calculateCascadeSeverity(pattern: any): number {
    let severity = 0;
    
    // Depth factor
    severity += pattern.propagationDepth * 10;
    
    // Services affected factor
    severity += pattern.affectedServices.length * 5;
    
    // Frequency factor
    severity += Math.min(pattern.occurrences * 2, 20);
    
    // Error transformation factor
    if (pattern.errorTransformation) {
      severity += 10;
    }
    
    return severity;
  }
  
  private async buildDependencyErrorMap(
    errorTraces: any[],
    includeDownstream: boolean,
    includeUpstream: boolean
  ): Promise<any> {
    const dependencyMap = new Map<string, Map<string, any>>();
    
    for (const trace of errorTraces) {
      const services = trace.services;
      
      for (let i = 0; i < trace.spans.length; i++) {
        const span = trace.spans[i];
        const service = span.service;
        const parentSpan = trace.spans.find((s: any) => s['span.id'] === span['span.parent_id']);
        
        if (!dependencyMap.has(service)) {
          dependencyMap.set(service, new Map());
        }
        
        // Downstream errors
        if (includeDownstream && span.status === 'ERROR') {
          const childSpans = trace.spans.filter((s: any) => s['span.parent_id'] === span['span.id']);
          for (const child of childSpans) {
            const childService = child.service;
            if (childService !== service) {
              const key = `${service}->${childService}`;
              if (!dependencyMap.get(service)?.has(key)) {
                dependencyMap.get(service)?.set(key, {
                  type: 'downstream',
                  targetService: childService,
                  errorCount: 0,
                  errorTypes: new Set()
                });
              }
              const dep = dependencyMap.get(service)?.get(key);
              if (dep) {
                dep.errorCount++;
                if (child.status === 'ERROR' && child['error.type']) {
                  dep.errorTypes.add(child['error.type']);
                }
              }
            }
          }
        }
        
        // Upstream errors
        if (includeUpstream && parentSpan && parentSpan.status === 'ERROR') {
          const parentService = parentSpan.service;
          if (parentService !== service) {
            const key = `${parentService}->${service}`;
            if (!dependencyMap.has(parentService)) {
              dependencyMap.set(parentService, new Map());
            }
            if (!dependencyMap.get(parentService)?.has(key)) {
              dependencyMap.get(parentService)?.set(key, {
                type: 'upstream',
                targetService: service,
                errorCount: 0,
                errorTypes: new Set()
              });
            }
            const dep = dependencyMap.get(parentService)?.get(key);
            if (dep) {
              dep.errorCount++;
              if (parentSpan['error.type']) {
                dep.errorTypes.add(parentSpan['error.type']);
              }
            }
          }
        }
      }
    }
    
    // Convert to output format
    const output: any = {};
    for (const [service, deps] of dependencyMap) {
      output[service] = Array.from(deps.values()).map(dep => ({
        ...dep,
        errorTypes: Array.from(dep.errorTypes)
      }));
    }
    
    return output;
  }
  
  private generateMitigationStrategies(
    errorSources: any,
    propagationImpact: any,
    errorCascades: any[]
  ): any {
    const strategies = {
      immediate: [] as any[],
      shortTerm: [] as any[],
      longTerm: [] as any[]
    };
    
    // Immediate strategies for primary error sources
    for (const source of errorSources.primary) {
      strategies.immediate.push({
        action: `Investigate and fix errors in ${source.service}`,
        priority: 'critical',
        impact: `Reduces ${source.errorCount} error propagations`,
        errorTypes: source.errorTypes
      });
    }
    
    // Short-term strategies for cascades
    if (errorCascades.length > 0) {
      strategies.shortTerm.push({
        action: 'Implement circuit breakers to prevent error cascades',
        priority: 'high',
        services: errorCascades[0].affectedServices,
        impact: `Prevents cascades affecting ${errorCascades[0].affectedServices.length} services`
      });
    }
    
    // Error handling improvements
    if (propagationImpact.amplification.average > 2) {
      strategies.shortTerm.push({
        action: 'Improve error handling and fallback mechanisms',
        priority: 'high',
        impact: `Reduces error amplification from ${propagationImpact.amplification.average.toFixed(1)}x to 1x`
      });
    }
    
    // Long-term architectural improvements
    if (propagationImpact.totalAffectedServices > 5) {
      strategies.longTerm.push({
        action: 'Review service dependencies and reduce coupling',
        priority: 'medium',
        affectedServices: propagationImpact.affectedServices,
        impact: 'Reduces blast radius of errors'
      });
    }
    
    // Retry and timeout configurations
    strategies.shortTerm.push({
      action: 'Configure appropriate timeouts and retry policies',
      priority: 'medium',
      impact: 'Prevents error propagation due to timeouts'
    });
    
    return strategies;
  }
  
  private generateErrorPropagationInsights(
    errorSources: any,
    propagationPatterns: any,
    propagationImpact: any
  ): any[] {
    const insights: any[] = [];
    
    // Primary error source insight
    if (errorSources.primary.length > 0) {
      const topSource = errorSources.primary[0];
      insights.push({
        type: 'primary_error_source',
        severity: 'high',
        description: `${topSource.service} is the primary error source, causing ${topSource.errorCount} error propagations`,
        recommendation: `Focus debugging efforts on ${topSource.service}`
      });
    }
    
    // Cascade risk insight
    if (propagationImpact.cascadeRisk.risk === 'high') {
      insights.push({
        type: 'high_cascade_risk',
        severity: 'high',
        description: `High cascade risk detected with ${propagationImpact.cascadeRisk.cascadeCount} cascade events`,
        recommendation: 'Implement circuit breakers and bulkheads to isolate failures'
      });
    }
    
    // Error amplification insight
    if (propagationImpact.amplification.average > 3) {
      insights.push({
        type: 'error_amplification',
        severity: 'medium',
        description: `Errors amplify ${propagationImpact.amplification.average.toFixed(1)}x on average`,
        recommendation: 'Improve error handling to prevent amplification'
      });
    }
    
    // Pattern insights
    const topPattern = propagationPatterns.patterns[0];
    if (topPattern && topPattern.occurrences > 10) {
      insights.push({
        type: 'frequent_pattern',
        severity: 'medium',
        description: `Common error path: ${topPattern.pattern} (${topPattern.occurrences} occurrences)`,
        recommendation: 'Add specific handling for this error propagation path'
      });
    }
    
    return insights;
  }
  
  private generatePropagationSummary(
    totalTraces: number,
    errorSources: any,
    propagationImpact: any
  ): string {
    const parts: string[] = [];
    
    parts.push(`Analyzed ${totalTraces} error traces.`);
    
    if (errorSources.primary.length > 0) {
      const topSource = errorSources.primary[0];
      parts.push(`Primary error source: ${topSource.service} (${topSource.errorCount} errors).`);
    }
    
    parts.push(`Errors affected ${propagationImpact.totalAffectedServices} services.`);
    
    if (propagationImpact.cascadeRisk.risk === 'high') {
      parts.push('High cascade risk detected.');
    }
    
    return parts.join(' ');
  }
}