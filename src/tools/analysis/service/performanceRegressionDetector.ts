import { z } from 'zod';
import { BaseTool, ToolCategory } from '../../base/tool.js';
import { BaseSearchAdapter } from '../../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../../config/index.js';
import { MCPToolSchema } from '../../../types.js';

// Define the Zod schema
const PerformanceRegressionDetectorArgsSchema = {
  service: z.string().describe('Service name to analyze'),
  from: z.string().describe('Start time for analysis (ISO 8601 format or relative like "now-1h")'),
  to: z.string().describe('End time for analysis (ISO 8601 format or relative like "now")'),
  baselineWindow: z.string().optional().describe('Time window for baseline comparison relative to analysis period (e.g., "7d" for 7 days before). Default: "7d"'),
  sensitivityThreshold: z.number().optional().describe('Statistical threshold for regression detection (higher = fewer false positives). Default: 2.5'),
  operations: z.array(z.string()).optional().describe('Specific operations to analyze (e.g., ["GET /api/users", "POST /api/orders"]). Default: all operations')
};

type PerformanceRegressionDetectorArgs = MCPToolSchema<typeof PerformanceRegressionDetectorArgsSchema>;

/**
 * Tool for detecting performance regressions by comparing current performance to historical baselines
 */
export class PerformanceRegressionDetectorTool extends BaseTool<typeof PerformanceRegressionDetectorArgsSchema> {
  // Static schema property
  static readonly schema = PerformanceRegressionDetectorArgsSchema;
  
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'detectPerformanceRegression',
      category: ToolCategory.ANALYSIS,
      description: 'Detect performance regressions by comparing current metrics to historical baselines',
      requiredCapabilities: []
    });
  }
  
  protected getSchema() {
    return PerformanceRegressionDetectorArgsSchema;
  }
  
  protected async executeImpl(args: PerformanceRegressionDetectorArgs): Promise<any> {
    const baselineWindow = args.baselineWindow || '7d';
    const sensitivityThreshold = args.sensitivityThreshold || 2.5;
    const timeRange = { from: args.from, to: args.to };
    
    // Analyze current performance
    const currentPerformance = await this.analyzeCurrentPerformance(
      args.service,
      timeRange,
      args.operations
    );
    
    // Get baseline performance
    const baselinePerformance = await this.analyzeBaselinePerformance(
      args.service,
      timeRange,
      baselineWindow,
      args.operations
    );
    
    // Detect regressions
    const regressions = this.detectRegressions(
      currentPerformance,
      baselinePerformance,
      sensitivityThreshold
    );
    
    // Analyze regression patterns
    const regressionPatterns = await this.analyzeRegressionPatterns(
      args.service,
      timeRange,
      regressions
    );
    
    // Identify potential causes
    const potentialCauses = await this.identifyPotentialCauses(
      args.service,
      timeRange,
      regressions
    );
    
    // Generate impact analysis
    const impactAnalysis = this.analyzeRegressionImpact(regressions, currentPerformance);
    
    // Create remediation suggestions
    const remediationSuggestions = this.generateRemediationSuggestions(
      regressions,
      regressionPatterns,
      potentialCauses
    );
    
    return this.formatJsonOutput({
      service: args.service,
      timeRange,
      baselineWindow,
      sensitivityThreshold,
      performanceMetrics: {
        current: currentPerformance,
        baseline: baselinePerformance
      },
      regressions: {
        detected: regressions.length > 0,
        count: regressions.length,
        details: regressions,
        severity: this.calculateOverallSeverity(regressions)
      },
      patterns: regressionPatterns,
      potentialCauses,
      impact: impactAnalysis,
      remediation: remediationSuggestions,
      summary: this.generateRegressionSummary(regressions, impactAnalysis)
    });
  }
  
  private async analyzeCurrentPerformance(
    service: string,
    timeRange: any,
    operations?: string[]
  ): Promise<any> {
    const config = ConfigLoader.get();
    
    const query: any = {
      bool: {
        must: [
          { term: { [config.telemetry.fields.service]: service } },
          { range: { [config.telemetry.fields.timestamp]: timeRange } }
        ]
      }
    };
    
    if (operations && operations.length > 0) {
      query.bool.must.push({
        terms: { 'span.name.keyword': operations }
      });
    }
    
    const result = await this.adapter.query(
      config.telemetry.indices.traces,
      query,
      {
        size: 0,
        aggregations: {
          overall_stats: {
            stats: { field: 'duration' }
          },
          percentiles: {
            percentiles: {
              field: 'duration',
              percents: [50, 75, 90, 95, 99, 99.9]
            }
          },
          by_operation: {
            terms: { 
              field: 'span.name.keyword', 
              size: operations?.length || 50 
            },
            aggs: {
              latency_stats: {
                stats: { field: 'duration' }
              },
              percentiles: {
                percentiles: {
                  field: 'duration',
                  percents: [50, 95, 99]
                }
              },
              success_rate: {
                filters: {
                  filters: {
                    success: { term: { [config.telemetry.fields.status]: 'OK' } },
                    total: { match_all: {} }
                  }
                }
              },
              over_time: {
                date_histogram: {
                  field: config.telemetry.fields.timestamp,
                  fixed_interval: '5m'
                },
                aggs: {
                  avg_latency: { avg: { field: 'duration' } },
                  p95_latency: { percentiles: { field: 'duration', percents: [95] } }
                }
              }
            }
          },
          time_series: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '5m'
            },
            aggs: {
              avg_latency: { avg: { field: 'duration' } },
              p50_latency: { percentiles: { field: 'duration', percents: [50] } },
              p95_latency: { percentiles: { field: 'duration', percents: [95] } },
              p99_latency: { percentiles: { field: 'duration', percents: [99] } },
              throughput: { value_count: { field: config.telemetry.fields.traceId } }
            }
          }
        }
      }
    );
    
    // Process operation metrics
    const operationMetrics = (result.aggregations?.by_operation?.buckets || []).map((bucket: any) => {
      const successCount = bucket.success_rate?.buckets?.success?.doc_count || 0;
      const totalCount = bucket.success_rate?.buckets?.total?.doc_count || 1;
      
      return {
        operation: bucket.key,
        requestCount: bucket.doc_count,
        latency: {
          avg: bucket.latency_stats?.avg || 0,
          min: bucket.latency_stats?.min || 0,
          max: bucket.latency_stats?.max || 0,
          p50: bucket.percentiles?.values?.['50.0'] || 0,
          p95: bucket.percentiles?.values?.['95.0'] || 0,
          p99: bucket.percentiles?.values?.['99.0'] || 0
        },
        successRate: (successCount / totalCount) * 100,
        timeline: bucket.over_time?.buckets || []
      };
    });
    
    return {
      overall: {
        stats: result.aggregations?.overall_stats || {},
        percentiles: result.aggregations?.percentiles?.values || {},
        requestCount: result.hits.total.value
      },
      operations: operationMetrics,
      timeSeries: result.aggregations?.time_series?.buckets || []
    };
  }
  
  private async analyzeBaselinePerformance(
    service: string,
    currentTimeRange: any,
    baselineWindow: string,
    operations?: string[]
  ): Promise<any> {
    
    // Calculate baseline time ranges
    const currentFrom = new Date(currentTimeRange.from).getTime();
    const currentTo = new Date(currentTimeRange.to).getTime();
    const windowMs = this.parseTimeWindow(baselineWindow);
    
    // Get multiple baseline periods for more robust comparison
    const baselinePeriods = [];
    const numPeriods = 7; // Compare against 7 historical periods
    
    for (let i = 1; i <= numPeriods; i++) {
      const offset = i * 24 * 60 * 60 * 1000; // Daily offsets
      baselinePeriods.push({
        from: new Date(currentFrom - offset - windowMs).toISOString(),
        to: new Date(currentFrom - offset).toISOString()
      });
    }
    
    // Aggregate baseline metrics
    const baselineMetrics = {
      operations: new Map(),
      overall: {
        latencies: {
          p50: [] as number[],
          p95: [] as number[],
          p99: [] as number[]
        },
        throughput: [] as number[]
      }
    };
    
    for (const period of baselinePeriods) {
      const periodPerformance = await this.analyzeCurrentPerformance(
        service,
        period,
        operations
      );
      
      // Aggregate overall metrics
      if (periodPerformance.overall.percentiles) {
        baselineMetrics.overall.latencies.p50.push(periodPerformance.overall.percentiles['50.0'] || 0);
        baselineMetrics.overall.latencies.p95.push(periodPerformance.overall.percentiles['95.0'] || 0);
        baselineMetrics.overall.latencies.p99.push(periodPerformance.overall.percentiles['99.0'] || 0);
      }
      
      // Calculate hourly throughput
      const duration = (new Date(period.to).getTime() - new Date(period.from).getTime()) / (60 * 60 * 1000);
      const hourlyThroughput = periodPerformance.overall.requestCount / duration;
      baselineMetrics.overall.throughput.push(hourlyThroughput);
      
      // Aggregate operation metrics
      periodPerformance.operations.forEach((op: any) => {
        if (!baselineMetrics.operations.has(op.operation)) {
          baselineMetrics.operations.set(op.operation, {
            latencies: { p50: [], p95: [], p99: [] },
            successRates: [],
            throughput: []
          });
        }
        
        const opMetrics = baselineMetrics.operations.get(op.operation);
        opMetrics.latencies.p50.push(op.latency.p50);
        opMetrics.latencies.p95.push(op.latency.p95);
        opMetrics.latencies.p99.push(op.latency.p99);
        opMetrics.successRates.push(op.successRate);
        opMetrics.throughput.push(op.requestCount / duration);
      });
    }
    
    // Calculate baseline statistics
    const baselineStats = {
      overall: {
        latency: {
          p50: this.calculateStats(baselineMetrics.overall.latencies.p50),
          p95: this.calculateStats(baselineMetrics.overall.latencies.p95),
          p99: this.calculateStats(baselineMetrics.overall.latencies.p99)
        },
        throughput: this.calculateStats(baselineMetrics.overall.throughput)
      },
      operations: new Map()
    };
    
    // Calculate per-operation baseline stats
    for (const [operation, metrics] of baselineMetrics.operations) {
      baselineStats.operations.set(operation, {
        latency: {
          p50: this.calculateStats(metrics.latencies.p50),
          p95: this.calculateStats(metrics.latencies.p95),
          p99: this.calculateStats(metrics.latencies.p99)
        },
        successRate: this.calculateStats(metrics.successRates),
        throughput: this.calculateStats(metrics.throughput)
      });
    }
    
    return baselineStats;
  }
  
  private detectRegressions(
    current: any,
    baseline: any,
    threshold: number
  ): any[] {
    const regressions = [];
    
    // Check overall latency regressions
    const percentiles = ['p50', 'p95', 'p99'];
    for (const percentile of percentiles) {
      const currentValue = current.overall.percentiles?.[percentile.replace('p', '') + '.0'] || 0;
      const baselineStats = baseline.overall.latency[percentile];
      
      if (baselineStats && baselineStats.stdDev > 0) {
        const zScore = (currentValue - baselineStats.mean) / baselineStats.stdDev;
        
        if (zScore > threshold) {
          regressions.push({
            type: 'latency',
            metric: `overall_${percentile}`,
            operation: null,
            current: currentValue,
            baseline: baselineStats.mean,
            zScore,
            deviation: ((currentValue - baselineStats.mean) / baselineStats.mean) * 100,
            severity: this.calculateRegressionSeverity(zScore, percentile)
          });
        }
      }
    }
    
    // Check per-operation regressions
    current.operations.forEach((op: any) => {
      const baselineOp = baseline.operations.get(op.operation);
      if (!baselineOp) return;
      
      // Check latency regressions
      for (const percentile of percentiles) {
        const currentValue = op.latency[percentile];
        const baselineStats = baselineOp.latency[percentile];
        
        if (baselineStats && baselineStats.stdDev > 0) {
          const zScore = (currentValue - baselineStats.mean) / baselineStats.stdDev;
          
          if (zScore > threshold) {
            regressions.push({
              type: 'latency',
              metric: `operation_${percentile}`,
              operation: op.operation,
              current: currentValue,
              baseline: baselineStats.mean,
              zScore,
              deviation: ((currentValue - baselineStats.mean) / baselineStats.mean) * 100,
              severity: this.calculateRegressionSeverity(zScore, percentile)
            });
          }
        }
      }
      
      // Check success rate regressions
      const currentSuccessRate = op.successRate;
      const baselineSuccessRate = baselineOp.successRate;
      
      if (baselineSuccessRate && baselineSuccessRate.stdDev > 0) {
        const zScore = (baselineSuccessRate.mean - currentSuccessRate) / baselineSuccessRate.stdDev;
        
        if (zScore > threshold && currentSuccessRate < 99) {
          regressions.push({
            type: 'success_rate',
            metric: 'success_rate',
            operation: op.operation,
            current: currentSuccessRate,
            baseline: baselineSuccessRate.mean,
            zScore,
            deviation: ((baselineSuccessRate.mean - currentSuccessRate) / baselineSuccessRate.mean) * 100,
            severity: this.calculateSuccessRateSeverity(currentSuccessRate, baselineSuccessRate.mean)
          });
        }
      }
    });
    
    // Sort by severity and z-score
    return regressions.sort((a, b) => {
      if (a.severity !== b.severity) {
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return severityOrder[a.severity as keyof typeof severityOrder] - 
               severityOrder[b.severity as keyof typeof severityOrder];
      }
      return b.zScore - a.zScore;
    });
  }
  
  private async analyzeRegressionPatterns(
    service: string,
    timeRange: any,
    regressions: any[]
  ): Promise<any> {
    if (regressions.length === 0) {
      return { patterns: [], insights: [] };
    }
    
    const patterns = {
      temporal: await this.analyzeTemporalPatterns(service, timeRange, regressions),
      operational: this.analyzeOperationalPatterns(regressions),
      severity: this.analyzeSeverityPatterns(regressions)
    };
    
    const insights = [];
    
    // Temporal insights
    if (patterns.temporal.suddenSpike) {
      insights.push({
        type: 'sudden_degradation',
        description: 'Performance degraded suddenly at a specific time',
        timestamp: patterns.temporal.spikeTime,
        recommendation: 'Check for deployments or configuration changes around this time'
      });
    }
    
    if (patterns.temporal.gradual) {
      insights.push({
        type: 'gradual_degradation',
        description: 'Performance has been gradually degrading over time',
        trend: patterns.temporal.trendDirection,
        recommendation: 'Investigate resource leaks or data growth issues'
      });
    }
    
    // Operational insights
    if (patterns.operational.concentratedOperations.length > 0) {
      insights.push({
        type: 'operation_specific',
        description: 'Regressions concentrated in specific operations',
        operations: patterns.operational.concentratedOperations,
        recommendation: 'Focus optimization efforts on these specific operations'
      });
    }
    
    if (patterns.operational.widespread) {
      insights.push({
        type: 'service_wide',
        description: 'Regressions affecting multiple operations',
        affectedPercentage: patterns.operational.affectedPercentage,
        recommendation: 'Look for service-wide issues like resource constraints'
      });
    }
    
    return { patterns, insights };
  }
  
  private async analyzeTemporalPatterns(
    service: string,
    timeRange: any,
    _regressions: any[]
  ): Promise<any> {
    const config = ConfigLoader.get();
    
    // Get fine-grained performance timeline
    const query = {
      bool: {
        must: [
          { term: { [config.telemetry.fields.service]: service } },
          { range: { [config.telemetry.fields.timestamp]: timeRange } }
        ]
      }
    };
    
    const result = await this.adapter.query(
      config.telemetry.indices.traces,
      query,
      {
        size: 0,
        aggregations: {
          timeline: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '1m'
            },
            aggs: {
              p95_latency: { percentiles: { field: 'duration', percents: [95] } },
              p99_latency: { percentiles: { field: 'duration', percents: [99] } }
            }
          }
        }
      }
    );
    
    const timeline = result.aggregations?.timeline?.buckets || [];
    
    // Detect sudden spikes
    let suddenSpike = false;
    let spikeTime = null;
    let maxSpikeRatio = 0;
    
    for (let i = 1; i < timeline.length; i++) {
      const current = timeline[i].p95_latency?.values?.['95.0'] || 0;
      const previous = timeline[i - 1].p95_latency?.values?.['95.0'] || 0;
      
      if (previous > 0) {
        const ratio = current / previous;
        if (ratio > 2 && ratio > maxSpikeRatio) {
          suddenSpike = true;
          spikeTime = timeline[i].key_as_string;
          maxSpikeRatio = ratio;
        }
      }
    }
    
    // Detect gradual degradation
    const values = timeline.map((b: any) => b.p95_latency?.values?.['95.0'] || 0).filter((v: number) => v > 0);
    const trend = this.calculateTrend(values);
    
    return {
      suddenSpike,
      spikeTime,
      spikeRatio: maxSpikeRatio,
      gradual: trend.slope > 0 && trend.r2 > 0.5,
      trendDirection: trend.slope > 0 ? 'increasing' : 'decreasing',
      trendStrength: trend.r2
    };
  }
  
  private analyzeOperationalPatterns(regressions: any[]): any {
    const operationRegressions = regressions.filter(r => r.operation !== null);
    const uniqueOperations = new Set(operationRegressions.map(r => r.operation));
    
    // Count regressions per operation
    const operationCounts = new Map();
    operationRegressions.forEach(r => {
      const count = operationCounts.get(r.operation) || 0;
      operationCounts.set(r.operation, count + 1);
    });
    
    // Find operations with multiple regressions
    const concentratedOperations = Array.from(operationCounts.entries())
      .filter(([_, count]) => count >= 2)
      .map(([op, count]) => ({ operation: op, regressionCount: count }))
      .sort((a, b) => b.regressionCount - a.regressionCount);
    
    return {
      widespread: uniqueOperations.size > 3,
      concentratedOperations,
      affectedOperations: Array.from(uniqueOperations),
      affectedPercentage: operationRegressions.length / regressions.length * 100
    };
  }
  
  private analyzeSeverityPatterns(regressions: any[]): any {
    const severityCounts = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0
    };
    
    regressions.forEach(r => {
      severityCounts[r.severity as keyof typeof severityCounts]++;
    });
    
    const typeCounts = {
      latency: 0,
      success_rate: 0
    };
    
    regressions.forEach(r => {
      typeCounts[r.type as keyof typeof typeCounts]++;
    });
    
    return {
      bySeverity: severityCounts,
      byType: typeCounts,
      mostCommonSeverity: Object.entries(severityCounts)
        .sort(([_, a], [__, b]) => b - a)[0][0],
      mostCommonType: Object.entries(typeCounts)
        .sort(([_, a], [__, b]) => b - a)[0][0]
    };
  }
  
  private async identifyPotentialCauses(
    service: string,
    timeRange: any,
    regressions: any[]
  ): Promise<any[]> {
    const config = ConfigLoader.get();
    const causes = [];
    
    // Check for deployment events (would need deployment tracking)
    causes.push({
      type: 'deployment',
      confidence: 'medium',
      description: 'Recent deployment may have introduced performance changes',
      recommendation: 'Review recent deployments and code changes'
    });
    
    // Check for increased traffic
    const trafficQuery = {
      bool: {
        must: [
          { term: { [config.telemetry.fields.service]: service } },
          { range: { [config.telemetry.fields.timestamp]: timeRange } }
        ]
      }
    };
    
    const trafficResult = await this.adapter.query(
      config.telemetry.indices.traces,
      trafficQuery,
      {
        size: 0,
        aggregations: {
          request_rate: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '5m'
            }
          }
        }
      }
    );
    
    const requestRates = trafficResult.aggregations?.request_rate?.buckets || [];
    const avgRate = requestRates.reduce((sum: number, b: any) => sum + b.doc_count, 0) / requestRates.length;
    const maxRate = Math.max(...requestRates.map((b: any) => b.doc_count));
    
    if (maxRate > avgRate * 2) {
      causes.push({
        type: 'traffic_spike',
        confidence: 'high',
        description: 'Traffic spikes detected during regression period',
        metrics: {
          averageRate: avgRate,
          peakRate: maxRate,
          spikeRatio: maxRate / avgRate
        },
        recommendation: 'Consider implementing auto-scaling or rate limiting'
      });
    }
    
    // Check for resource constraints
    const resourceQuery = {
      bool: {
        must: [
          { term: { [config.telemetry.fields.service]: service } },
          { range: { [config.telemetry.fields.timestamp]: timeRange } }
        ]
      }
    };
    
    const cpuResult = await this.adapter.query(
      config.telemetry.indices.metrics,
      {
        ...resourceQuery,
        bool: {
          ...resourceQuery.bool,
          must: [...resourceQuery.bool.must, { exists: { field: 'system.cpu.total.norm.pct' } }]
        }
      },
      {
        size: 0,
        aggregations: {
          cpu_stats: { extended_stats: { field: 'system.cpu.total.norm.pct' } }
        }
      }
    );
    
    const cpuStats = cpuResult.aggregations?.cpu_stats;
    if (cpuStats && cpuStats.max > 0.8) {
      causes.push({
        type: 'resource_constraint',
        subtype: 'cpu',
        confidence: 'high',
        description: 'High CPU utilization detected',
        metrics: {
          maxCpu: (cpuStats.max * 100).toFixed(1) + '%',
          avgCpu: (cpuStats.avg * 100).toFixed(1) + '%'
        },
        recommendation: 'Optimize CPU-intensive operations or increase resources'
      });
    }
    
    // Check for dependency issues
    if (regressions.some(r => r.operation && r.operation.includes('external'))) {
      causes.push({
        type: 'dependency_degradation',
        confidence: 'medium',
        description: 'External dependency performance may have degraded',
        recommendation: 'Check health and performance of downstream services'
      });
    }
    
    // Check for data growth patterns
    if (regressions.some(r => r.type === 'latency' && r.deviation > 100)) {
      causes.push({
        type: 'data_growth',
        confidence: 'low',
        description: 'Increased data volume may be affecting query performance',
        recommendation: 'Review database query patterns and consider optimization'
      });
    }
    
    return causes.sort((a, b) => {
      const confidenceOrder = { high: 0, medium: 1, low: 2 };
      return confidenceOrder[a.confidence as keyof typeof confidenceOrder] - 
             confidenceOrder[b.confidence as keyof typeof confidenceOrder];
    });
  }
  
  private analyzeRegressionImpact(regressions: any[], _currentPerformance: any): any {
    // Calculate user impact
    const latencyRegressions = regressions.filter(r => r.type === 'latency');
    const successRateRegressions = regressions.filter(r => r.type === 'success_rate');
    
    let userImpact = 'low';
    let impactScore = 0;
    
    // High impact if p95/p99 latency regressions
    const highPercentileRegressions = latencyRegressions.filter(r => 
      r.metric.includes('p95') || r.metric.includes('p99')
    );
    
    if (highPercentileRegressions.some(r => r.severity === 'critical')) {
      userImpact = 'critical';
      impactScore = 100;
    } else if (highPercentileRegressions.some(r => r.severity === 'high')) {
      userImpact = 'high';
      impactScore = 75;
    } else if (latencyRegressions.length > 3) {
      userImpact = 'medium';
      impactScore = 50;
    }
    
    // Calculate affected users percentage
    const affectedUsersPercentage = highPercentileRegressions.length > 0
      ? highPercentileRegressions[0].metric.includes('p99') ? 1 : 5
      : 50;
    
    // Calculate business impact
    const businessMetrics = {
      estimatedRevenueImpact: impactScore > 50 ? 'high' : impactScore > 25 ? 'medium' : 'low',
      slaRisk: successRateRegressions.length > 0 || impactScore > 75,
      customerExperienceImpact: userImpact
    };
    
    // Technical impact
    const technicalMetrics = {
      affectedOperations: [...new Set(regressions.filter(r => r.operation).map(r => r.operation))],
      cascadingRisk: regressions.length > 5 ? 'high' : regressions.length > 2 ? 'medium' : 'low',
      scalabilityImpact: latencyRegressions.some(r => r.deviation > 200)
    };
    
    return {
      userImpact,
      impactScore,
      affectedUsersPercentage,
      businessMetrics,
      technicalMetrics,
      mitigationUrgency: this.calculateMitigationUrgency(impactScore, regressions)
    };
  }
  
  private generateRemediationSuggestions(
    regressions: any[],
    patterns: any,
    causes: any[]
  ): any[] {
    const suggestions = [];
    
    // Immediate actions
    const immediate = [];
    
    if (regressions.some(r => r.severity === 'critical')) {
      immediate.push({
        action: 'Roll back recent deployments if regression coincides with deployment',
        priority: 'critical',
        estimatedTime: '15 minutes'
      });
    }
    
    if (causes.some(c => c.type === 'traffic_spike')) {
      immediate.push({
        action: 'Enable auto-scaling or increase capacity',
        priority: 'high',
        estimatedTime: '30 minutes'
      });
    }
    
    if (causes.some(c => c.type === 'resource_constraint')) {
      immediate.push({
        action: 'Increase resource allocation (CPU/Memory)',
        priority: 'high',
        estimatedTime: '20 minutes'
      });
    }
    
    suggestions.push({
      phase: 'immediate',
      actions: immediate
    });
    
    // Short-term optimizations
    const shortTerm = [];
    
    if (patterns.patterns?.operational?.concentratedOperations?.length > 0) {
      const operations = patterns.patterns.operational.concentratedOperations
        .slice(0, 3)
        .map((op: any) => op.operation);
      
      shortTerm.push({
        action: `Optimize specific operations: ${operations.join(', ')}`,
        priority: 'medium',
        estimatedTime: '1-2 days',
        details: 'Profile and optimize database queries, add caching, or refactor algorithms'
      });
    }
    
    if (regressions.some(r => r.type === 'latency' && r.metric.includes('p99'))) {
      shortTerm.push({
        action: 'Implement request timeout and circuit breaker patterns',
        priority: 'medium',
        estimatedTime: '2-3 days'
      });
    }
    
    suggestions.push({
      phase: 'short_term',
      actions: shortTerm
    });
    
    // Long-term improvements
    const longTerm = [];
    
    if (patterns.patterns?.temporal?.gradual) {
      longTerm.push({
        action: 'Implement performance regression testing in CI/CD pipeline',
        priority: 'low',
        estimatedTime: '1-2 weeks'
      });
    }
    
    longTerm.push({
      action: 'Set up continuous performance monitoring and alerting',
      priority: 'low',
      estimatedTime: '1 week'
    });
    
    if (causes.some(c => c.type === 'data_growth')) {
      longTerm.push({
        action: 'Implement data archiving and partitioning strategies',
        priority: 'low',
        estimatedTime: '2-4 weeks'
      });
    }
    
    suggestions.push({
      phase: 'long_term',
      actions: longTerm
    });
    
    return suggestions;
  }
  
  private generateRegressionSummary(regressions: any[], impact: any): string {
    if (regressions.length === 0) {
      return 'No performance regressions detected. Service is performing within expected baselines.';
    }
    
    const criticalCount = regressions.filter(r => r.severity === 'critical').length;
    const highCount = regressions.filter(r => r.severity === 'high').length;
    
    let summary = `Detected ${regressions.length} performance regression${regressions.length > 1 ? 's' : ''}`;
    
    if (criticalCount > 0) {
      summary += ` (${criticalCount} critical)`;
    } else if (highCount > 0) {
      summary += ` (${highCount} high severity)`;
    }
    
    summary += `. User impact: ${impact.userImpact}.`;
    
    if (impact.impactScore > 75) {
      summary += ' Immediate action recommended.';
    } else if (impact.impactScore > 50) {
      summary += ' Investigation and optimization recommended.';
    }
    
    return summary;
  }
  
  // Helper methods
  private parseTimeWindow(window: string): number {
    const match = window.match(/^(\d+)([mhd])$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000; // Default 7 days
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 7 * 24 * 60 * 60 * 1000;
    }
  }
  
  private calculateStats(values: number[]): any {
    if (values.length === 0) {
      return { mean: 0, stdDev: 0, min: 0, max: 0 };
    }
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    return {
      mean,
      stdDev,
      min: Math.min(...values),
      max: Math.max(...values)
    };
  }
  
  private calculateRegressionSeverity(zScore: number, percentile: string): string {
    // Higher percentiles are more critical
    const percentileWeight = percentile === 'p99' ? 1.5 : percentile === 'p95' ? 1.2 : 1.0;
    const weightedScore = zScore * percentileWeight;
    
    if (weightedScore > 5) return 'critical';
    if (weightedScore > 3.5) return 'high';
    if (weightedScore > 2.5) return 'medium';
    return 'low';
  }
  
  private calculateSuccessRateSeverity(current: number, baseline: number): string {
    const drop = baseline - current;
    
    if (current < 95 || drop > 5) return 'critical';
    if (current < 98 || drop > 2) return 'high';
    if (current < 99 || drop > 1) return 'medium';
    return 'low';
  }
  
  private calculateTrend(values: number[]): any {
    if (values.length < 2) {
      return { slope: 0, r2: 0 };
    }
    
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * values[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    // const sumY2 = values.reduce((sum, yi) => sum + yi * yi, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    // Calculate R-squared
    const yMean = sumY / n;
    const ssTotal = values.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
    const ssResidual = values.reduce((sum, yi, i) => {
      const yPred = slope * i + intercept;
      return sum + Math.pow(yi - yPred, 2);
    }, 0);
    
    const r2 = 1 - (ssResidual / ssTotal);
    
    return { slope, r2 };
  }
  
  private calculateOverallSeverity(regressions: any[]): string {
    if (regressions.length === 0) return 'none';
    
    const criticalCount = regressions.filter(r => r.severity === 'critical').length;
    const highCount = regressions.filter(r => r.severity === 'high').length;
    
    if (criticalCount > 0) return 'critical';
    if (highCount > 2) return 'high';
    if (highCount > 0 || regressions.length > 5) return 'medium';
    return 'low';
  }
  
  private calculateMitigationUrgency(impactScore: number, regressions: any[]): string {
    if (impactScore > 75 || regressions.some(r => r.severity === 'critical')) {
      return 'immediate';
    }
    if (impactScore > 50 || regressions.some(r => r.severity === 'high')) {
      return 'urgent';
    }
    if (impactScore > 25) {
      return 'planned';
    }
    return 'low';
  }
}