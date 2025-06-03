import { z } from 'zod';
import { BaseTool, ToolCategory } from '../../base/tool.js';
import { BaseSearchAdapter } from '../../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../../config/index.js';
import { MCPToolSchema } from '../../../types.js';

// Define the Zod schema
const SystemHealthSummaryArgsSchema = {
  from: z.string().optional().describe('Start time (e.g., "now-1h" or ISO timestamp), defaults to "now-1h"'),
  to: z.string().optional().describe('End time (e.g., "now" or ISO timestamp), defaults to "now"'),
  services: z.array(z.string()).optional().describe('Specific services to analyze (analyzes all if not specified)')
};

type SystemHealthSummaryArgs = MCPToolSchema<typeof SystemHealthSummaryArgsSchema>;

/**
 * Tool for analyzing overall system health
 */
export class SystemHealthSummaryTool extends BaseTool<typeof SystemHealthSummaryArgsSchema> {
  // Static schema property
  static readonly schema = SystemHealthSummaryArgsSchema;
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'getSystemHealthSummary',
      category: ToolCategory.ANALYSIS,
      description: 'Provide high-level system health overview with bottleneck detection',
      requiredCapabilities: []
    });
  }
  
  protected getSchema() {
    return SystemHealthSummaryArgsSchema;
  }
  
  protected async executeImpl(args: SystemHealthSummaryArgs): Promise<any> {
    const config = ConfigLoader.get();
    
    // Default to last hour if no time range specified
    const timeRange = {
      from: args.from || 'now-1h',
      to: args.to || 'now'
    };
    
    // Get all services if none specified
    let services = args.services;
    if (!services || services.length === 0) {
      const serviceInfo = await this.adapter.getServices();
      services = serviceInfo.map(s => s.name);
    }
    
    // Analyze traces for latency and error rates
    const traceAnalysis = await this.adapter.analyzeTraces({
      timeRange,
      includeErrors: true
    });
    
    // Analyze service dependencies
    const dependencies = await this.adapter.getServiceDependencies(timeRange);
    
    // Analyze logs for errors and warnings
    const logAnalysis = await this.analyzeLogHealth(timeRange, services);
    
    // Analyze key metrics
    const metricAnalysis = await this.analyzeMetricHealth(timeRange, services);
    
    // Identify bottlenecks
    const bottlenecks = this.identifyBottlenecks(
      traceAnalysis,
      dependencies.dependencies,
      services
    );
    
    // Calculate health score
    const healthScore = this.calculateHealthScore(
      traceAnalysis.errorRate,
      logAnalysis.errorRate,
      bottlenecks.length
    );
    
    return this.formatJsonOutput({
      summary: {
        healthScore,
        healthStatus: this.getHealthStatus(healthScore),
        timeRange,
        servicesAnalyzed: services.length
      },
      traces: {
        totalTraces: traceAnalysis.totalTraces,
        errorRate: traceAnalysis.errorRate,
        latency: traceAnalysis.latency,
        topOperations: traceAnalysis.topOperations.slice(0, 5)
      },
      logs: logAnalysis,
      metrics: metricAnalysis,
      bottlenecks,
      recommendations: this.generateRecommendations(
        healthScore,
        traceAnalysis,
        logAnalysis,
        bottlenecks
      )
    });
  }
  
  private async analyzeLogHealth(timeRange: any, services: string[]): Promise<any> {
    const config = ConfigLoader.get();
    
    const query = {
      bool: {
        must: [
          { range: { [config.telemetry.fields.timestamp]: timeRange } }
        ],
        should: services.map(s => ({ term: { [config.telemetry.fields.service]: s } })),
        minimum_should_match: 1
      }
    };
    
    const result = await this.adapter.query(
      config.telemetry.indices.logs,
      query,
      {
        size: 0,
        aggregations: {
          by_level: {
            terms: {
              field: 'level.keyword',
              size: 10
            }
          },
          errors_over_time: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '5m'
            },
            aggs: {
              error_count: {
                filter: {
                  terms: { level: ['error', 'ERROR', 'fatal', 'FATAL'] }
                }
              }
            }
          }
        }
      }
    );
    
    const levelBuckets = result.aggregations?.by_level?.buckets || [];
    const totalLogs = result.hits.total.value;
    const errorLogs = levelBuckets
      .filter((b: any) => ['error', 'ERROR', 'fatal', 'FATAL'].includes(b.key))
      .reduce((sum: number, b: any) => sum + b.doc_count, 0);
    
    return {
      totalLogs,
      errorLogs,
      errorRate: totalLogs > 0 ? (errorLogs / totalLogs) * 100 : 0,
      logsByLevel: levelBuckets.reduce((acc: any, b: any) => {
        acc[b.key] = b.doc_count;
        return acc;
      }, {})
    };
  }
  
  private async analyzeMetricHealth(timeRange: any, services: string[]): Promise<any> {
    const config = ConfigLoader.get();
    
    // Analyze CPU and memory metrics
    const cpuQuery = {
      bool: {
        must: [
          { range: { [config.telemetry.fields.timestamp]: timeRange } },
          { exists: { field: 'system.cpu.total.norm.pct' } }
        ]
      }
    };
    
    const cpuResult = await this.adapter.query(
      config.telemetry.indices.metrics,
      cpuQuery,
      {
        size: 0,
        aggregations: {
          avg_cpu: { avg: { field: 'system.cpu.total.norm.pct' } },
          max_cpu: { max: { field: 'system.cpu.total.norm.pct' } }
        }
      }
    );
    
    const memoryQuery = {
      bool: {
        must: [
          { range: { [config.telemetry.fields.timestamp]: timeRange } },
          { exists: { field: 'system.memory.actual.used.pct' } }
        ]
      }
    };
    
    const memoryResult = await this.adapter.query(
      config.telemetry.indices.metrics,
      memoryQuery,
      {
        size: 0,
        aggregations: {
          avg_memory: { avg: { field: 'system.memory.actual.used.pct' } },
          max_memory: { max: { field: 'system.memory.actual.used.pct' } }
        }
      }
    );
    
    return {
      cpu: {
        average: cpuResult.aggregations?.avg_cpu?.value || 0,
        max: cpuResult.aggregations?.max_cpu?.value || 0
      },
      memory: {
        average: memoryResult.aggregations?.avg_memory?.value || 0,
        max: memoryResult.aggregations?.max_memory?.value || 0
      }
    };
  }
  
  private identifyBottlenecks(traceAnalysis: any, dependencies: any[], services: string[]): any[] {
    const bottlenecks = [];
    
    // High latency operations
    const highLatencyOps = traceAnalysis.topOperations.filter((op: any) => 
      op.avgDuration > traceAnalysis.latency.p95
    );
    
    for (const op of highLatencyOps) {
      bottlenecks.push({
        type: 'high_latency',
        operation: op.operation,
        avgDuration: op.avgDuration,
        impact: 'high',
        recommendation: `Optimize operation ${op.operation} - average duration ${op.avgDuration}ms exceeds p95 latency`
      });
    }
    
    // High error rate dependencies
    const errorDeps = dependencies.filter(dep => (dep.errorRate || 0) > 5);
    for (const dep of errorDeps) {
      bottlenecks.push({
        type: 'high_error_rate',
        source: dep.source,
        target: dep.target,
        errorRate: dep.errorRate,
        impact: 'high',
        recommendation: `Investigate errors between ${dep.source} -> ${dep.target} (${dep.errorRate}% error rate)`
      });
    }
    
    // Service dependencies with high call volume
    const highVolumeDeps = dependencies
      .sort((a, b) => b.callCount - a.callCount)
      .slice(0, 3);
    
    for (const dep of highVolumeDeps) {
      if (dep.callCount > 10000) {
        bottlenecks.push({
          type: 'high_volume',
          source: dep.source,
          target: dep.target,
          callCount: dep.callCount,
          impact: 'medium',
          recommendation: `Consider caching or optimizing high-volume calls: ${dep.source} -> ${dep.target}`
        });
      }
    }
    
    return bottlenecks;
  }
  
  private calculateHealthScore(errorRate: number, logErrorRate: number, bottleneckCount: number): number {
    let score = 100;
    
    // Deduct for error rates
    score -= Math.min(errorRate * 2, 40); // Max 40 point deduction for errors
    score -= Math.min(logErrorRate, 20); // Max 20 point deduction for log errors
    
    // Deduct for bottlenecks
    score -= Math.min(bottleneckCount * 5, 20); // Max 20 point deduction for bottlenecks
    
    return Math.max(0, Math.round(score));
  }
  
  private getHealthStatus(score: number): string {
    if (score >= 90) return 'healthy';
    if (score >= 70) return 'degraded';
    if (score >= 50) return 'unhealthy';
    return 'critical';
  }
  
  private generateRecommendations(score: number, traceAnalysis: any, logAnalysis: any, bottlenecks: any[]): string[] {
    const recommendations = [];
    
    if (traceAnalysis.errorRate > 5) {
      recommendations.push(`High error rate detected (${traceAnalysis.errorRate.toFixed(2)}%). Investigate failing operations.`);
    }
    
    if (logAnalysis.errorRate > 1) {
      recommendations.push(`Elevated error logs (${logAnalysis.errorRate.toFixed(2)}%). Check application logs for root causes.`);
    }
    
    if (bottlenecks.length > 0) {
      recommendations.push(`${bottlenecks.length} performance bottlenecks identified. Address high-impact issues first.`);
    }
    
    if (traceAnalysis.latency.p99 > 1000) {
      recommendations.push(`High p99 latency (${traceAnalysis.latency.p99}ms). Consider performance optimization.`);
    }
    
    if (score < 70) {
      recommendations.push('System health is degraded. Immediate attention recommended.');
    }
    
    return recommendations;
  }
}