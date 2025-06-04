import { z } from 'zod';
import { BaseTool, ToolCategory } from '../../base/tool.js';
import { BaseSearchAdapter } from '../../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../../config/index.js';
import { MCPToolSchema } from '../../../types.js';

/**
 * Zod schema for trace clustering arguments
 */
const TraceClusteringSchema = {
  from: z.string().describe('Start time (ISO 8601 or relative format like "now-1h")'),
  to: z.string().describe('End time (ISO 8601 or relative format like "now")'),
  features: z.array(z.string()).optional().describe('Features to use for clustering (e.g., duration, span.name)'),
  numClusters: z.number().min(2).max(20).optional().describe('Number of clusters to create (default: 5)'),
  service: z.string().optional().describe('Service name to filter results (optional)')
};

type TraceClusteringArgs = MCPToolSchema<typeof TraceClusteringSchema>;

/**
 * ML-powered trace clustering tool
 */
export class TraceClusteringTool extends BaseTool<typeof TraceClusteringSchema> {
  // Static schema property
  static readonly schema = TraceClusteringSchema;
  
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'clusterTraces',
      category: ToolCategory.ANALYSIS,
      description: 'Group similar traces using ML clustering to identify common patterns and outliers',
      requiredCapabilities: ['ml'],
      backendSpecific: null // Available for any backend with ML
    });
  }
  
  protected getSchema() {
    return TraceClusteringSchema;
  }
  
  protected async executeImpl(args: TraceClusteringArgs): Promise<any> {
    const config = ConfigLoader.get();
    
    const result = await this.adapter.clusterTraces({
      index: config.telemetry.indices.traces,
      timeRange: { from: args.from, to: args.to },
      features: args.features || ['duration', 'span.name', 'service.name'],
      numClusters: args.numClusters || 5
    });
    
    // Analyze cluster characteristics
    const totalSize = result.clusters.reduce((sum: number, c: any) => sum + c.size, 0);
    const clusterAnalysis = result.clusters.map((cluster: any) => ({
      id: cluster.id,
      size: cluster.size,
      percentage: (cluster.size / totalSize) * 100,
      characteristics: this.analyzeClusterCharacteristics(cluster),
      samples: cluster.samples.slice(0, 3)
    }));
    
    // Generate actionable insights
    const insights = this.generateActionableInsights(clusterAnalysis);
    
    return this.formatJsonOutput({
      from: args.from,
      to: args.to,
      features: args.features,
      numClusters: result.clusters.length,
      clusters: clusterAnalysis,
      summary: {
        totalTraces: result.clusters.reduce((sum: number, c: any) => sum + c.size, 0),
        largestCluster: clusterAnalysis.reduce((max: any, c: any) => c.size > max.size ? c : max, { size: 0 }),
        smallestCluster: clusterAnalysis.reduce((min: any, c: any) => c.size < min.size ? c : min, { size: Infinity })
      },
      insights,
      recommendations: this.generateRecommendations(clusterAnalysis)
    });
  }
  
  private analyzeClusterCharacteristics(cluster: any): any {
    const centroid = cluster.centroid;
    const characteristics: any = {};
    
    // Analyze centroid values
    if (centroid.duration) {
      characteristics.avgDuration = centroid.duration;
      characteristics.durationCategory = this.categorizeDuration(centroid.duration);
    }
    
    if (centroid['span.name']) {
      characteristics.primaryOperation = centroid['span.name'];
    }
    
    if (centroid['service.name']) {
      characteristics.primaryService = centroid['service.name'];
    }
    
    // Analyze variance within cluster
    if (cluster.samples && cluster.samples.length > 0) {
      const durations = cluster.samples.map((s: any) => s.duration || 0);
      characteristics.durationVariance = this.calculateVariance(durations);
      characteristics.consistencyScore = this.calculateConsistencyScore(cluster);
      
      // Add pattern explanation
      characteristics.pattern = this.explainClusterPattern(cluster);
      
      // Detect anomalies within cluster
      characteristics.anomalies = this.detectIntraClusterAnomalies(cluster);
      
      // Add root cause hints
      characteristics.rootCauseHints = this.generateRootCauseHints(cluster);
    }
    
    return characteristics;
  }
  
  private categorizeDuration(duration: number): string {
    if (duration < 100) return 'fast';
    if (duration < 500) return 'normal';
    if (duration < 2000) return 'slow';
    return 'very_slow';
  }
  
  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }
  
  private calculateConsistencyScore(cluster: any): number {
    // Simple consistency score based on how similar samples are
    if (!cluster.samples || cluster.samples.length < 2) return 1;
    
    // Check consistency of span names
    const spanNames = cluster.samples.map((s: any) => s['span.name']);
    const uniqueSpanNames = new Set(spanNames).size;
    const spanConsistency = 1 - (uniqueSpanNames - 1) / cluster.samples.length;
    
    // Check consistency of services
    const services = cluster.samples.map((s: any) => s['service.name']);
    const uniqueServices = new Set(services).size;
    const serviceConsistency = 1 - (uniqueServices - 1) / cluster.samples.length;
    
    // Average consistency
    return (spanConsistency + serviceConsistency) / 2;
  }
  
  private explainClusterPattern(cluster: any): string {
    const samples = cluster.samples || [];
    if (samples.length === 0) return 'No pattern detected';
    
    const patterns: string[] = [];
    
    // Analyze duration patterns
    const durations = samples.map((s: any) => s.duration || 0);
    const avgDuration = durations.reduce((sum: number, d: number) => sum + d, 0) / durations.length;
    const maxDuration = Math.max(...durations);
    const minDuration = Math.min(...durations);
    
    if (maxDuration > avgDuration * 2) {
      patterns.push(`High latency variance (${minDuration}ms - ${maxDuration}ms)`);
    }
    
    // Analyze service patterns
    const serviceCounts: Record<string, number> = {};
    samples.forEach((s: any) => {
      const service = s['service.name'] || 'unknown';
      serviceCounts[service] = (serviceCounts[service] || 0) + 1;
    });
    
    const dominantService = Object.entries(serviceCounts)
      .sort(([, a], [, b]) => b - a)[0];
    
    if (dominantService && dominantService[1] > samples.length * 0.7) {
      patterns.push(`Primarily from ${dominantService[0]} service (${Math.round(dominantService[1] / samples.length * 100)}%)`);
    }
    
    // Analyze operation patterns
    const operations = samples.map((s: any) => s['span.name']).filter(Boolean);
    const uniqueOps = new Set(operations);
    
    if (uniqueOps.size === 1) {
      patterns.push(`All traces for '${operations[0]}' operation`);
    } else if (uniqueOps.size < 3) {
      patterns.push(`Limited to ${uniqueOps.size} operations: ${Array.from(uniqueOps).join(', ')}`);
    }
    
    // Check for error patterns
    const errorCount = samples.filter((s: any) => s.status === 'ERROR' || s.error).length;
    if (errorCount > 0) {
      patterns.push(`Contains ${errorCount} errors (${Math.round(errorCount / samples.length * 100)}%)`);
    }
    
    return patterns.length > 0 ? patterns.join('; ') : 'Normal operation pattern';
  }
  
  private detectIntraClusterAnomalies(cluster: any): any[] {
    const samples = cluster.samples || [];
    if (samples.length < 5) return [];
    
    const anomalies: any[] = [];
    
    // Detect duration outliers
    const durations = samples.map((s: any) => s.duration || 0);
    const avgDuration = durations.reduce((sum: number, d: number) => sum + d, 0) / durations.length;
    const stdDev = this.calculateVariance(durations);
    
    samples.forEach((sample: any) => {
      const duration = sample.duration || 0;
      
      // Check if duration is an outlier (> 3 standard deviations)
      if (Math.abs(duration - avgDuration) > stdDev * 3) {
        anomalies.push({
          type: 'duration_outlier',
          traceId: sample.trace_id || sample.id,
          value: duration,
          deviation: Math.round((duration - avgDuration) / stdDev * 10) / 10,
          description: `Duration ${duration}ms is ${Math.round(duration / avgDuration * 100)}% of cluster average`
        });
      }
      
      // Check for error traces in mostly successful cluster
      if (sample.status === 'ERROR' && cluster.samples.filter((s: any) => s.status === 'ERROR').length < samples.length * 0.1) {
        anomalies.push({
          type: 'rare_error',
          traceId: sample.trace_id || sample.id,
          error: sample.error_message || 'Unknown error',
          description: 'Error trace in mostly successful cluster'
        });
      }
    });
    
    return anomalies.slice(0, 5); // Limit to top 5 anomalies
  }
  
  private generateRootCauseHints(cluster: any): string[] {
    const hints: string[] = [];
    const samples = cluster.samples || [];
    
    if (samples.length === 0) return hints;
    
    // Analyze common attributes for hints
    const avgDuration = samples.reduce((sum: number, s: any) => sum + (s.duration || 0), 0) / samples.length;
    
    // Duration-based hints
    if (avgDuration > 5000) {
      hints.push('Check for database query optimization or connection pool exhaustion');
    } else if (avgDuration > 2000) {
      hints.push('Investigate external API calls or network latency');
    }
    
    // Error-based hints
    const errorSamples = samples.filter((s: any) => s.status === 'ERROR' || s.error);
    if (errorSamples.length > samples.length * 0.5) {
      const errorMessages = errorSamples
        .map((s: any) => {
          // Prioritize string error_message, then string s.error, otherwise null
          if (typeof s.error_message === 'string' && s.error_message.trim() !== '') {
            return s.error_message;
          }
          // Check if s.error is a string and not just a boolean true
          if (typeof s.error === 'string' && s.error.trim() !== '') {
            return s.error;
          }
          return null; // Explicitly return null if no suitable string message is found
        })
        .filter((msg: unknown): msg is string => typeof msg === 'string'); // Ensure only actual strings proceed
      
      if (errorMessages.some((msg: string) => msg.toLowerCase().includes('timeout'))) {
        hints.push('Timeout errors detected - check service timeouts and circuit breakers');
      }
      if (errorMessages.some((msg: string) => msg.toLowerCase().includes('connection'))) {
        hints.push('Connection errors - verify service discovery and network configuration');
      }
    }
    
    // Service-specific hints
    const services = samples.map((s: any) => s['service.name']).filter(Boolean);
    const serviceSet = new Set(services);
    
    if (serviceSet.size === 1) {
      hints.push(`All traces from ${services[0]} - check service-specific logs and metrics`);
    } else if (serviceSet.size > 5) {
      hints.push('Multiple services affected - possible cascading failure or shared dependency issue');
    }
    
    // Operation-specific hints
    const operations = samples.map((s: any) => s['span.name']).filter(Boolean);
    const uniqueOps = new Set(operations);
    
    if (uniqueOps.size === 1 && operations[0]) {
      hints.push(`Specific to '${operations[0]}' operation - review recent code changes to this endpoint`);
    }
    
    return hints;
  }
  
  private generateActionableInsights(clusterAnalysis: any[]): any {
    const insights: any = {
      criticalFindings: [],
      performanceIssues: [],
      errorPatterns: [],
      recommendations: []
    };
    
    // Analyze each cluster for insights
    clusterAnalysis.forEach((cluster, index) => {
      const characteristics = cluster.characteristics;
      
      // Check for performance issues
      if (characteristics.avgDuration > 5000) {
        insights.performanceIssues.push({
          cluster: index,
          issue: 'Very slow operations',
          avgDuration: characteristics.avgDuration,
          impact: `${cluster.percentage.toFixed(1)}% of traces affected`,
          action: 'Immediate investigation required'
        });
      }
      
      // Check for error clusters
      if (characteristics.pattern && characteristics.pattern.includes('errors')) {
        const errorMatch = characteristics.pattern.match(/(\d+) errors/);
        if (errorMatch) {
          insights.errorPatterns.push({
            cluster: index,
            errorCount: parseInt(errorMatch[1]),
            percentage: cluster.percentage.toFixed(1),
            service: characteristics.primaryService,
            operation: characteristics.primaryOperation
          });
        }
      }
      
      // Check for anomalies
      if (characteristics.anomalies && characteristics.anomalies.length > 0) {
        insights.criticalFindings.push({
          cluster: index,
          finding: `${characteristics.anomalies.length} anomalies detected`,
          anomalies: characteristics.anomalies.slice(0, 3),
          recommendation: 'Review anomalous traces for root cause'
        });
      }
    });
    
    // Generate overall insights
    const totalClusters = clusterAnalysis.length;
    const errorClusters = insights.errorPatterns.length;
    const slowClusters = insights.performanceIssues.length;
    
    if (errorClusters > totalClusters * 0.3) {
      insights.criticalFindings.push({
        finding: 'High error rate across multiple clusters',
        impact: `${errorClusters} out of ${totalClusters} clusters contain errors`,
        recommendation: 'System-wide issue likely - check shared dependencies'
      });
    }
    
    if (slowClusters > totalClusters * 0.5) {
      insights.criticalFindings.push({
        finding: 'Widespread performance degradation',
        impact: `${slowClusters} out of ${totalClusters} clusters show high latency`,
        recommendation: 'Check resource availability and scaling'
      });
    }
    
    return insights;
  }
  
  private generateRecommendations(clusterAnalysis: any[]): string[] {
    const recommendations: string[] = [];
    const addedRecommendations = new Set<string>();
    
    // Helper to avoid duplicate recommendations
    const addRecommendation = (rec: string) => {
      if (!addedRecommendations.has(rec)) {
        recommendations.push(rec);
        addedRecommendations.add(rec);
      }
    };
    
    // Analyze all clusters for patterns
    let hasHighLatency = false;
    let hasErrors = false;
    let affectedServices = new Set<string>();
    
    clusterAnalysis.forEach(cluster => {
      const chars = cluster.characteristics;
      
      if (chars.avgDuration > 2000) hasHighLatency = true;
      if (chars.pattern && chars.pattern.includes('errors')) hasErrors = true;
      if (chars.primaryService) affectedServices.add(chars.primaryService);
      
      // Add cluster-specific recommendations
      if (chars.rootCauseHints) {
        chars.rootCauseHints.forEach((hint: string) => addRecommendation(hint));
      }
    });
    
    // Add general recommendations based on patterns
    if (hasHighLatency && hasErrors) {
      addRecommendation('Performance issues coinciding with errors - likely cascading failure');
    }
    
    if (affectedServices.size > 3) {
      addRecommendation('Multiple services affected - review shared infrastructure and dependencies');
    }
    
    if (hasHighLatency) {
      addRecommendation('Enable distributed tracing for slow operations to identify bottlenecks');
    }
    
    if (hasErrors) {
      addRecommendation('Implement better error handling and retry logic with exponential backoff');
    }
    
    // Add proactive recommendations
    addRecommendation('Set up alerts for similar patterns to catch issues early');
    addRecommendation('Consider implementing canary deployments to detect issues before full rollout');
    
    return recommendations.slice(0, 10); // Limit to top 10 recommendations
  }
}