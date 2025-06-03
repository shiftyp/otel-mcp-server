import { z } from 'zod';
import { BaseTool, ToolCategory } from '../../base/tool.js';
import { BaseSearchAdapter } from '../../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../../config/index.js';
import { MCPToolSchema } from '../../../types.js';

// Define the Zod schema
const ServiceBehaviorProfileArgsSchema = {
  service: z.string().describe('Service name to analyze'),
  from: z.string().describe('Start time for analysis (ISO 8601 format or relative like "now-1h")'),
  to: z.string().describe('End time for analysis (ISO 8601 format or relative like "now")'),
  compareToBaseline: z.boolean().optional().describe('Compare current behavior to historical baseline for deviation detection (default: true)'),
  baselineDays: z.number().optional().describe('Number of days of historical data to use for baseline calculation (default: 7)'),
  includeAnomalies: z.boolean().optional().describe('Detect and include anomalous patterns in the behavior profile (default: true)')
};

type ServiceBehaviorProfileArgs = MCPToolSchema<typeof ServiceBehaviorProfileArgsSchema>;

/**
 * Tool for creating behavioral profiles of services including patterns, baselines, and anomalies
 */
export class ServiceBehaviorProfileTool extends BaseTool<typeof ServiceBehaviorProfileArgsSchema> {
  // Static schema property
  static readonly schema = ServiceBehaviorProfileArgsSchema;

  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'analyzeServiceBehavior',
      category: ToolCategory.ANALYSIS,
      description: 'Analyze service behavior patterns, compare to baselines, and detect anomalies',
      requiredCapabilities: []
    });
  }

  protected getSchema() {
    return ServiceBehaviorProfileArgsSchema;
  }

  protected async executeImpl(args: ServiceBehaviorProfileArgs): Promise<any> {
    const config = ConfigLoader.get();
    const compareToBaseline = args.compareToBaseline ?? true;
    const baselineDays = args.baselineDays ?? 7;
    const includeAnomalies = args.includeAnomalies ?? true;
    const timeRange = { from: args.from, to: args.to };

    // Get current behavior metrics
    const currentBehavior = await this.analyzeCurrentBehavior(args.service, timeRange);

    // Get baseline behavior if requested
    let baselineBehavior = null;
    let deviations = null;
    if (compareToBaseline) {
      baselineBehavior = await this.analyzeBaselineBehavior(args.service, timeRange, baselineDays);
      deviations = this.calculateDeviations(currentBehavior, baselineBehavior);
    }

    // Analyze traffic patterns
    const trafficPatterns = await this.analyzeTrafficPatterns(args.service, timeRange);

    // Analyze error patterns
    const errorPatterns = await this.analyzeErrorPatterns(args.service, timeRange);

    // Analyze dependencies behavior
    const dependencyBehavior = await this.analyzeDependencyBehavior(args.service, timeRange);

    // Analyze resource usage patterns
    const resourcePatterns = await this.analyzeResourcePatterns(args.service, timeRange);

    // Detect anomalies if requested
    let anomalies = null;
    if (includeAnomalies) {
      anomalies = await this.detectBehavioralAnomalies(
        currentBehavior,
        baselineBehavior,
        trafficPatterns,
        errorPatterns
      );
    }

    // Generate behavioral insights
    const insights = this.generateBehavioralInsights(
      currentBehavior,
      deviations,
      anomalies,
      trafficPatterns,
      errorPatterns
    );

    // Calculate behavior score
    const behaviorScore = this.calculateBehaviorScore(
      currentBehavior,
      deviations,
      anomalies
    );

    return this.formatJsonOutput({
      service: args.service,
      timeRange: timeRange,
      behaviorProfile: {
        current: currentBehavior,
        baseline: baselineBehavior,
        deviations,
        score: behaviorScore
      },
      patterns: {
        traffic: trafficPatterns,
        errors: errorPatterns,
        resources: resourcePatterns,
        dependencies: dependencyBehavior
      },
      anomalies,
      insights,
      recommendations: this.generateRecommendations(insights, anomalies, behaviorScore),
      summary: this.generateBehaviorSummary(currentBehavior, deviations, behaviorScore)
    });
  }

  private async analyzeCurrentBehavior(service: string, timeRange: { from: string; to: string }): Promise<any> {
    const config = ConfigLoader.get();

    // Query for service metrics
    const metricsQuery = {
      bool: {
        must: [
          { term: { [config.telemetry.fields.service]: service } },
          { range: { [config.telemetry.fields.timestamp]: timeRange } }
        ]
      }
    };

    // Get request patterns
    const requestMetrics = await this.adapter.query(
      config.telemetry.indices.traces,
      metricsQuery,
      {
        size: 0,
        aggregations: {
          total_requests: { value_count: { field: config.telemetry.fields.traceId } },
          unique_operations: { cardinality: { field: 'span.name.keyword' } },
          requests_over_time: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '5m'
            },
            aggs: {
              count: { value_count: { field: config.telemetry.fields.traceId } },
              latency_p50: { percentiles: { field: 'duration', percents: [50] } },
              latency_p95: { percentiles: { field: 'duration', percents: [95] } },
              latency_p99: { percentiles: { field: 'duration', percents: [99] } }
            }
          },
          error_rate: {
            filters: {
              filters: {
                errors: { term: { [config.telemetry.fields.status]: 'ERROR' } },
                success: { term: { [config.telemetry.fields.status]: 'OK' } }
              }
            }
          },
          operations_breakdown: {
            terms: { field: 'span.name.keyword', size: 20 },
            aggs: {
              avg_duration: { avg: { field: 'duration' } },
              error_count: {
                filter: { term: { [config.telemetry.fields.status]: 'ERROR' } }
              }
            }
          }
        }
      }
    );

    // Get log patterns
    const logMetrics = await this.adapter.query(
      config.telemetry.indices.logs,
      metricsQuery,
      {
        size: 0,
        aggregations: {
          log_levels: {
            terms: { field: 'level.keyword', size: 10 }
          },
          logs_over_time: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '5m'
            },
            aggs: {
              by_level: {
                terms: { field: 'level.keyword', size: 5 }
              }
            }
          }
        }
      }
    );

    return {
      requests: {
        total: requestMetrics.aggregations?.total_requests?.value || 0,
        uniqueOperations: requestMetrics.aggregations?.unique_operations?.value || 0,
        errorCount: requestMetrics.aggregations?.error_rate?.buckets?.errors?.doc_count || 0,
        successCount: requestMetrics.aggregations?.error_rate?.buckets?.success?.doc_count || 0,
        errorRate: this.calculateErrorRate(requestMetrics.aggregations?.error_rate?.buckets),
        timeline: requestMetrics.aggregations?.requests_over_time?.buckets || []
      },
      operations: requestMetrics.aggregations?.operations_breakdown?.buckets || [],
      logs: {
        levels: logMetrics.aggregations?.log_levels?.buckets || [],
        timeline: logMetrics.aggregations?.logs_over_time?.buckets || []
      }
    };
  }

  private async analyzeBaselineBehavior(
    service: string,
    currentTimeRange: {
      from: string;
      to: string
    },
    baselineDays: number
  ): Promise<any> {
    const config = ConfigLoader.get();

    // Calculate baseline time range
    const currentFrom = new Date(currentTimeRange.from).getTime();
    const currentTo = new Date(currentTimeRange.to).getTime();
    const duration = currentTo - currentFrom;

    // Create multiple baseline periods
    const baselinePeriods = [];
    for (let i = 1; i <= baselineDays; i++) {
      const dayOffset = i * 24 * 60 * 60 * 1000;
      baselinePeriods.push({
        from: new Date(currentFrom - dayOffset).toISOString(),
        to: new Date(currentTo - dayOffset).toISOString()
      });
    }

    // Aggregate baseline metrics
    const baselineMetrics = {
      requestRate: [] as number[],
      errorRate: [] as number[],
      latencyP50: [] as number[],
      latencyP95: [] as number[],
      latencyP99: [] as number[],
      operationDistribution: new Map<string, number[]>()
    };

    for (const period of baselinePeriods) {
      const behavior = await this.analyzeCurrentBehavior(service, period);

      // Calculate hourly request rate
      const totalRequests = behavior.requests.total;
      const hourlyRate = totalRequests / (duration / (60 * 60 * 1000));
      baselineMetrics.requestRate.push(hourlyRate);

      // Track error rate
      baselineMetrics.errorRate.push(behavior.requests.errorRate);

      // Track latencies from timeline
      behavior.requests.timeline.forEach((bucket: any) => {
        if (bucket.latency_p50?.values) {
          baselineMetrics.latencyP50.push(bucket.latency_p50.values['50.0']);
        }
        if (bucket.latency_p95?.values) {
          baselineMetrics.latencyP95.push(bucket.latency_p95.values['95.0']);
        }
        if (bucket.latency_p99?.values) {
          baselineMetrics.latencyP99.push(bucket.latency_p99.values['99.0']);
        }
      });

      // Track operation distribution
      behavior.operations.forEach((op: any) => {
        const current = baselineMetrics.operationDistribution.get(op.key) || [];
        current.push(op.doc_count);
        baselineMetrics.operationDistribution.set(op.key, current);
      });
    }

    // Calculate baseline statistics
    return {
      requestRate: {
        mean: this.calculateMean(baselineMetrics.requestRate),
        stdDev: this.calculateStdDev(baselineMetrics.requestRate),
        p95: this.calculatePercentile(baselineMetrics.requestRate, 95)
      },
      errorRate: {
        mean: this.calculateMean(baselineMetrics.errorRate),
        stdDev: this.calculateStdDev(baselineMetrics.errorRate),
        p95: this.calculatePercentile(baselineMetrics.errorRate, 95)
      },
      latency: {
        p50: {
          mean: this.calculateMean(baselineMetrics.latencyP50),
          stdDev: this.calculateStdDev(baselineMetrics.latencyP50)
        },
        p95: {
          mean: this.calculateMean(baselineMetrics.latencyP95),
          stdDev: this.calculateStdDev(baselineMetrics.latencyP95)
        },
        p99: {
          mean: this.calculateMean(baselineMetrics.latencyP99),
          stdDev: this.calculateStdDev(baselineMetrics.latencyP99)
        }
      },
      operationDistribution: Array.from(baselineMetrics.operationDistribution.entries()).map(([op, counts]) => ({
        operation: op,
        mean: this.calculateMean(counts),
        stdDev: this.calculateStdDev(counts)
      })),
      sampleSize: baselineDays
    };
  }

  private calculateDeviations(current: any, baseline: any): any {
    if (!baseline) return null;

    // Calculate current metrics
    const currentRequests = current.requests.total;
    const currentDuration = current.requests.timeline.length * 5; // 5 minutes per bucket
    const currentRequestRate = currentRequests / (currentDuration / 60); // per hour

    // Calculate latency averages
    const currentLatencies = {
      p50: [] as number[],
      p95: [] as number[],
      p99: [] as number[]
    };

    current.requests.timeline.forEach((bucket: any) => {
      if (bucket.latency_p50?.values) currentLatencies.p50.push(bucket.latency_p50.values['50.0']);
      if (bucket.latency_p95?.values) currentLatencies.p95.push(bucket.latency_p95.values['95.0']);
      if (bucket.latency_p99?.values) currentLatencies.p99.push(bucket.latency_p99.values['99.0']);
    });

    const deviations = {
      requestRate: {
        current: currentRequestRate,
        baseline: baseline.requestRate.mean,
        deviation: currentRequestRate - baseline.requestRate.mean,
        zScore: baseline.requestRate.stdDev > 0
          ? (currentRequestRate - baseline.requestRate.mean) / baseline.requestRate.stdDev
          : 0,
        percentChange: baseline.requestRate.mean > 0
          ? ((currentRequestRate - baseline.requestRate.mean) / baseline.requestRate.mean) * 100
          : 0
      },
      errorRate: {
        current: current.requests.errorRate,
        baseline: baseline.errorRate.mean,
        deviation: current.requests.errorRate - baseline.errorRate.mean,
        zScore: baseline.errorRate.stdDev > 0
          ? (current.requests.errorRate - baseline.errorRate.mean) / baseline.errorRate.stdDev
          : 0,
        percentChange: baseline.errorRate.mean > 0
          ? ((current.requests.errorRate - baseline.errorRate.mean) / baseline.errorRate.mean) * 100
          : 0
      },
      latency: {
        p50: this.calculateLatencyDeviation(currentLatencies.p50, baseline.latency.p50),
        p95: this.calculateLatencyDeviation(currentLatencies.p95, baseline.latency.p95),
        p99: this.calculateLatencyDeviation(currentLatencies.p99, baseline.latency.p99)
      },
      significantDeviations: []
    };

    // Identify significant deviations (|z-score| > 2)
    if (Math.abs(deviations.requestRate.zScore) > 2) {
(deviations.significantDeviations as any[]).push({
        metric: 'requestRate',
        zScore: deviations.requestRate.zScore,
        severity: Math.abs(deviations.requestRate.zScore) > 3 ? 'high' : 'medium',
        direction: deviations.requestRate.zScore > 0 ? 'increase' : 'decrease'
      });
    }

    if (Math.abs(deviations.errorRate.zScore) > 2) {
(deviations.significantDeviations as any[]).push({
        metric: 'errorRate',
        zScore: deviations.errorRate.zScore,
        severity: Math.abs(deviations.errorRate.zScore) > 3 ? 'high' : 'medium',
        direction: deviations.errorRate.zScore > 0 ? 'increase' : 'decrease'
      });
    }

    return deviations;
  }

  private calculateLatencyDeviation(currentValues: number[], baselineStats: any): any {
    const currentMean = this.calculateMean(currentValues);

    return {
      current: currentMean,
      baseline: baselineStats.mean,
      deviation: currentMean - baselineStats.mean,
      zScore: baselineStats.stdDev > 0
        ? (currentMean - baselineStats.mean) / baselineStats.stdDev
        : 0,
      percentChange: baselineStats.mean > 0
        ? ((currentMean - baselineStats.mean) / baselineStats.mean) * 100
        : 0
    };
  }

  private async analyzeTrafficPatterns(service: string, timeRange: any): Promise<any> {
    const config = ConfigLoader.get();

    // Analyze traffic patterns
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
          by_hour: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              calendar_interval: 'hour'
            },
            aggs: {
              request_count: { value_count: { field: config.telemetry.fields.traceId } }
            }
          },
          by_operation: {
            terms: { field: 'span.name.keyword', size: 20 },
            aggs: {
              over_time: {
                date_histogram: {
                  field: config.telemetry.fields.timestamp,
                  fixed_interval: '30m'
                }
              }
            }
          },
          by_client: {
            terms: { field: 'http.client_ip.keyword', size: 20 },
            aggs: {
              request_count: { value_count: { field: config.telemetry.fields.traceId } }
            }
          },
          request_patterns: {
            significant_terms: {
              field: 'http.url.keyword',
              size: 10
            }
          }
        }
      }
    );

    // Analyze periodicity
    const hourlyData = trafficResult.aggregations?.by_hour?.buckets || [];
    const periodicity = this.detectPeriodicity(hourlyData.map((b: any) => b.request_count?.value || 0));

    return {
      hourlyDistribution: hourlyData,
      operationDistribution: trafficResult.aggregations?.by_operation?.buckets || [],
      topClients: trafficResult.aggregations?.by_client?.buckets || [],
      significantPatterns: trafficResult.aggregations?.request_patterns?.buckets || [],
      periodicity,
      peakHours: this.identifyPeakHours(hourlyData),
      trafficClassification: this.classifyTrafficPattern(hourlyData, periodicity)
    };
  }

  private async analyzeErrorPatterns(service: string, timeRange: any): Promise<any> {
    const config = ConfigLoader.get();

    // Query for error patterns
    const errorQuery = {
      bool: {
        must: [
          { term: { [config.telemetry.fields.service]: service } },
          { range: { [config.telemetry.fields.timestamp]: timeRange } },
          { term: { [config.telemetry.fields.status]: 'ERROR' } }
        ]
      }
    };

    const errorResult = await this.adapter.query(
      config.telemetry.indices.traces,
      errorQuery,
      {
        size: 100,
        sort: [{ [config.telemetry.fields.timestamp]: 'desc' }],
        aggregations: {
          error_types: {
            terms: { field: 'error.type.keyword', size: 20 }
          },
          error_timeline: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '10m'
            },
            aggs: {
              by_type: {
                terms: { field: 'error.type.keyword', size: 5 }
              }
            }
          },
          error_operations: {
            terms: { field: 'span.name.keyword', size: 20 },
            aggs: {
              error_types: {
                terms: { field: 'error.type.keyword', size: 5 }
              }
            }
          },
          error_correlation: {
            significant_terms: {
              field: 'attributes.keyword',
              size: 10
            }
          }
        }
      }
    );

    // Analyze error logs
    const errorLogQuery = {
      bool: {
        must: [
          { term: { [config.telemetry.fields.service]: service } },
          { range: { [config.telemetry.fields.timestamp]: timeRange } },
          { terms: { 'level.keyword': ['error', 'ERROR', 'fatal', 'FATAL'] } }
        ]
      }
    };

    const errorLogs = await this.adapter.query(
      config.telemetry.indices.logs,
      errorLogQuery,
      {
        size: 0,
        aggregations: {
          error_messages: {
            terms: { field: 'message.keyword', size: 20 }
          }
        }
      }
    );

    return {
      errorTypes: errorResult.aggregations?.error_types?.buckets || [],
      errorTimeline: errorResult.aggregations?.error_timeline?.buckets || [],
      errorsByOperation: errorResult.aggregations?.error_operations?.buckets || [],
      errorCorrelations: errorResult.aggregations?.error_correlation?.buckets || [],
      topErrorMessages: errorLogs.aggregations?.error_messages?.buckets || [],
      errorClusters: this.clusterErrors(errorResult.hits.hits),
      errorTrends: this.analyzeErrorTrends(errorResult.aggregations?.error_timeline?.buckets || [])
    };
  }

  private async analyzeDependencyBehavior(service: string, timeRange: any): Promise<any> {
    const config = ConfigLoader.get();

    // Query for service dependencies
    const dependencyQuery = {
      bool: {
        must: [
          { term: { [config.telemetry.fields.service]: service } },
          { range: { [config.telemetry.fields.timestamp]: timeRange } },
          { exists: { field: 'span.parent_id' } }
        ]
      }
    };

    const dependencyResult = await this.adapter.query(
      config.telemetry.indices.traces,
      dependencyQuery,
      {
        size: 0,
        aggregations: {
          downstream_services: {
            terms: { field: 'downstream.service.keyword', size: 30 },
            aggs: {
              avg_latency: { avg: { field: 'duration' } },
              error_rate: {
                filters: {
                  filters: {
                    errors: { term: { [config.telemetry.fields.status]: 'ERROR' } },
                    total: { match_all: {} }
                  }
                }
              },
              latency_timeline: {
                date_histogram: {
                  field: config.telemetry.fields.timestamp,
                  fixed_interval: '10m'
                },
                aggs: {
                  avg_latency: { avg: { field: 'duration' } }
                }
              }
            }
          },
          upstream_services: {
            terms: { field: 'upstream.service.keyword', size: 30 },
            aggs: {
              request_count: { value_count: { field: config.telemetry.fields.traceId } }
            }
          }
        }
      }
    );

    const dependencies = {
      downstream: [] as any[],
      upstream: [] as any[]
    };

    // Process downstream dependencies
    const downstreamBuckets = dependencyResult.aggregations?.downstream_services?.buckets || [];
    for (const bucket of downstreamBuckets) {
      const errorCount = bucket.error_rate?.buckets?.errors?.doc_count || 0;
      const totalCount = bucket.error_rate?.buckets?.total?.doc_count || 1;

      dependencies.downstream.push({
        service: bucket.key,
        callCount: bucket.doc_count,
        avgLatency: bucket.avg_latency?.value || 0,
        errorRate: (errorCount / totalCount) * 100,
        latencyTrend: bucket.latency_timeline?.buckets || [],
        reliability: this.calculateReliability(errorCount, totalCount, bucket.avg_latency?.value)
      });
    }

    // Process upstream dependencies
    const upstreamBuckets = dependencyResult.aggregations?.upstream_services?.buckets || [];
    dependencies.upstream = upstreamBuckets.map((bucket: any) => ({
      service: bucket.key,
      requestCount: bucket.request_count?.value || 0
    }));

    return {
      dependencies,
      criticalDependencies: this.identifyCriticalDependencies(dependencies.downstream),
      dependencyHealth: this.assessDependencyHealth(dependencies.downstream),
      communicationPatterns: this.analyzeCommunicationPatterns(dependencies)
    };
  }

  private async analyzeResourcePatterns(service: string, timeRange: any): Promise<any> {
    const config = ConfigLoader.get();

    // Query for resource metrics
    const resourceQuery = {
      bool: {
        must: [
          { term: { [config.telemetry.fields.service]: service } },
          { range: { [config.telemetry.fields.timestamp]: timeRange } }
        ]
      }
    };

    // CPU metrics
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
          cpu_over_time: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '5m'
            },
            aggs: {
              avg_cpu: { avg: { field: 'system.cpu.total.norm.pct' } },
              max_cpu: { max: { field: 'system.cpu.total.norm.pct' } }
            }
          },
          cpu_stats: { extended_stats: { field: 'system.cpu.total.norm.pct' } }
        }
      }
    );

    // Memory metrics
    const memoryResult = await this.adapter.query(
      config.telemetry.indices.metrics,
      {
        ...resourceQuery,
        bool: {
          ...resourceQuery.bool,
          must: [...resourceQuery.bool.must, { exists: { field: 'system.memory.actual.used.pct' } }]
        }
      },
      {
        size: 0,
        aggregations: {
          memory_over_time: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '5m'
            },
            aggs: {
              avg_memory: { avg: { field: 'system.memory.actual.used.pct' } },
              max_memory: { max: { field: 'system.memory.actual.used.pct' } }
            }
          },
          memory_stats: { extended_stats: { field: 'system.memory.actual.used.pct' } }
        }
      }
    );

    return {
      cpu: {
        timeline: cpuResult.aggregations?.cpu_over_time?.buckets || [],
        stats: cpuResult.aggregations?.cpu_stats || {},
        utilization: this.calculateResourceUtilization(cpuResult.aggregations?.cpu_stats)
      },
      memory: {
        timeline: memoryResult.aggregations?.memory_over_time?.buckets || [],
        stats: memoryResult.aggregations?.memory_stats || {},
        utilization: this.calculateResourceUtilization(memoryResult.aggregations?.memory_stats)
      },
      resourceEfficiency: this.calculateResourceEfficiency(
        cpuResult.aggregations?.cpu_stats,
        memoryResult.aggregations?.memory_stats
      ),
      scalingRecommendations: this.generateScalingRecommendations(
        cpuResult.aggregations?.cpu_stats,
        memoryResult.aggregations?.memory_stats
      )
    };
  }

  private async detectBehavioralAnomalies(
    current: any,
    baseline: any,
    trafficPatterns: any,
    errorPatterns: any
  ): Promise<any> {
    const anomalies: any[] = [];

    // Traffic volume anomalies
    if (baseline && current.requests.total > 0) {
      const expectedRequests = baseline.requestRate.mean * (current.requests.timeline.length * 5 / 60);
      const deviation = Math.abs(current.requests.total - expectedRequests) / expectedRequests;

      if (deviation > 0.5) {
        anomalies.push({
          type: 'traffic_volume',
          severity: deviation > 1 ? 'high' : 'medium',
          description: `Traffic volume ${deviation > 1 ? 'significantly' : 'moderately'} different from baseline`,
          metrics: {
            current: current.requests.total,
            expected: expectedRequests,
            deviation: `${(deviation * 100).toFixed(1)}%`
          }
        });
      }
    }

    // Latency anomalies
    current.requests.timeline.forEach((bucket: any, index: number) => {
      if (bucket.latency_p99?.values?.['99.0']) {
        const p99 = bucket.latency_p99.values['99.0'];
        if (baseline && baseline.latency.p99.mean > 0) {
          const zScore = (p99 - baseline.latency.p99.mean) / baseline.latency.p99.stdDev;
          if (Math.abs(zScore) > 3) {
            anomalies.push({
              type: 'latency_spike',
              severity: Math.abs(zScore) > 4 ? 'high' : 'medium',
              timestamp: bucket.key_as_string,
              description: `P99 latency ${zScore > 0 ? 'spike' : 'drop'} detected`,
              metrics: {
                value: p99,
                baseline: baseline.latency.p99.mean,
                zScore: zScore.toFixed(2)
              }
            });
          }
        }
      }
    });

    // Error pattern anomalies
    if (errorPatterns.errorTypes.length > 0) {
      const newErrorTypes = errorPatterns.errorTypes.filter((et: any) =>
        !baseline || et.doc_count > baseline.errorRate.mean * 2
      );

      if (newErrorTypes.length > 0) {
        anomalies.push({
          type: 'new_error_types',
          severity: 'medium',
          description: 'New or increased error types detected',
          errorTypes: newErrorTypes.map((et: any) => ({
            type: et.key,
            count: et.doc_count
          }))
        });
      }
    }

    // Operation distribution anomalies
    const operationAnomalies = this.detectOperationAnomalies(current.operations, baseline);
    anomalies.push(...operationAnomalies);

    return {
      detected: anomalies.length > 0,
      count: anomalies.length,
      anomalies,
      severitySummary: this.summarizeAnomalySeverity(anomalies)
    };
  }

  private detectOperationAnomalies(currentOps: any[], baseline: any): any[] {
    const anomalies: any[] = [];

    if (!baseline || !baseline.operationDistribution) return anomalies;

    // Create baseline map
    const baselineMap = new Map();
    baseline.operationDistribution.forEach((op: any) => {
      baselineMap.set(op.operation, op);
    });

    // Check for anomalies in current operations
    currentOps.forEach((op: any) => {
      const baselineOp = baselineMap.get(op.key);

      if (!baselineOp) {
        // New operation
        if (op.doc_count > 10) {
          anomalies.push({
            type: 'new_operation',
            severity: 'low',
            operation: op.key,
            description: 'New operation detected',
            count: op.doc_count
          });
        }
      } else {
        // Check for significant changes
        const zScore = baselineOp.stdDev > 0
          ? (op.doc_count - baselineOp.mean) / baselineOp.stdDev
          : 0;

        if (Math.abs(zScore) > 3) {
          anomalies.push({
            type: 'operation_volume_change',
            severity: Math.abs(zScore) > 4 ? 'medium' : 'low',
            operation: op.key,
            description: `Operation volume ${zScore > 0 ? 'increased' : 'decreased'} significantly`,
            metrics: {
              current: op.doc_count,
              baseline: baselineOp.mean,
              zScore: zScore.toFixed(2)
            }
          });
        }
      }
    });

    return anomalies;
  }

  private generateBehavioralInsights(
    current: any,
    deviations: any,
    anomalies: any,
    trafficPatterns: any,
    errorPatterns: any
  ): any {
    const insights = {
      summary: [] as any[],
      patterns: [] as any[],
      risks: [] as any[],
      opportunities: [] as any[]
    };

    // Traffic insights
    if (trafficPatterns.periodicity.isPeriodic) {
      insights.patterns.push({
        type: 'traffic_periodicity',
        description: `Traffic shows ${trafficPatterns.periodicity.period}-hour periodic pattern`,
        confidence: trafficPatterns.periodicity.confidence
      });
    }

    // Deviation insights
    if (deviations && deviations.significantDeviations.length > 0) {
      deviations.significantDeviations.forEach((dev: any) => {
        insights.summary.push({
          type: 'significant_deviation',
          metric: dev.metric,
          description: `${dev.metric} shows ${dev.severity} ${dev.direction} from baseline`,
          impact: this.assessDeviationImpact(dev)
        });
      });
    }

    // Error insights
    if (errorPatterns.errorTrends.increasing) {
(insights.risks as any[]).push({
        type: 'increasing_errors',
        description: 'Error rate showing increasing trend',
        severity: 'medium',
        recommendation: 'Investigate recent changes and monitor error patterns'
      });
    }

    // Performance insights
    const avgLatency = this.calculateMean(
      current.requests.timeline
        .filter((b: any) => b.latency_p95?.values)
        .map((b: any) => b.latency_p95.values['95.0'])
    );

    if (avgLatency > 1000) {
(insights.risks as any[]).push({
        type: 'high_latency',
        description: `Average P95 latency is ${avgLatency.toFixed(0)}ms`,
        severity: avgLatency > 2000 ? 'high' : 'medium',
        recommendation: 'Consider performance optimization'
      });
    }

    // Opportunity insights
    if (trafficPatterns.peakHours.length > 0) {
      insights.opportunities.push({
        type: 'predictable_scaling',
        description: 'Traffic has predictable peak hours',
        peakHours: trafficPatterns.peakHours,
        recommendation: 'Implement scheduled auto-scaling'
      });
    }

    return insights;
  }

  private calculateBehaviorScore(current: any, deviations: any, anomalies: any): any {
    let score = 100;
    const factors = [];

    // Error rate impact
    const errorRate = current.requests.errorRate;
    if (errorRate > 0.05) {
      const penalty = Math.min(errorRate * 100, 30);
      score -= penalty;
      factors.push({
        factor: 'error_rate',
        impact: -penalty,
        value: `${(errorRate * 100).toFixed(2)}%`
      });
    }

    // Deviation impact
    if (deviations && deviations.significantDeviations.length > 0) {
      const deviationPenalty = deviations.significantDeviations.length * 5;
      score -= deviationPenalty;
      factors.push({
        factor: 'baseline_deviations',
        impact: -deviationPenalty,
        count: deviations.significantDeviations.length
      });
    }

    // Anomaly impact
    if (anomalies && anomalies.anomalies) {
      const highSeverityCount = anomalies.anomalies.filter((a: any) => a.severity === 'high').length;
      const mediumSeverityCount = anomalies.anomalies.filter((a: any) => a.severity === 'medium').length;

      const anomalyPenalty = (highSeverityCount * 10) + (mediumSeverityCount * 5);
      score -= anomalyPenalty;

      if (anomalyPenalty > 0) {
        factors.push({
          factor: 'anomalies',
          impact: -anomalyPenalty,
          high: highSeverityCount,
          medium: mediumSeverityCount
        });
      }
    }

    // Ensure score is between 0 and 100
    score = Math.max(0, Math.min(100, score));

    return {
      score,
      grade: this.getScoreGrade(score),
      factors,
      interpretation: this.interpretScore(score)
    };
  }

  private getScoreGrade(score: number): string {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  private interpretScore(score: number): string {
    if (score >= 90) return 'Excellent - Service is behaving normally with minimal issues';
    if (score >= 80) return 'Good - Service is mostly healthy with minor concerns';
    if (score >= 70) return 'Fair - Service has some issues that need attention';
    if (score >= 60) return 'Poor - Service has significant issues requiring immediate attention';
    return 'Critical - Service is experiencing severe issues';
  }

  private generateRecommendations(insights: any, anomalies: any, behaviorScore: any): any[] {
    const recommendations = [];

    // Score-based recommendations
    if (behaviorScore.score < 70) {
      recommendations.push({
        priority: 'high',
        category: 'reliability',
        action: 'Investigate and address the factors contributing to low behavior score',
        rationale: `Behavior score of ${behaviorScore.score} indicates significant issues`
      });
    }

    // Insight-based recommendations
    insights.risks?.forEach((risk: any) => {
      if (risk.recommendation) {
        recommendations.push({
          priority: risk.severity === 'high' ? 'high' : 'medium',
          category: 'performance',
          action: risk.recommendation,
          rationale: risk.description
        });
      }
    });

    insights.opportunities?.forEach((opp: any) => {
      if (opp.recommendation) {
        recommendations.push({
          priority: 'low',
          category: 'optimization',
          action: opp.recommendation,
          rationale: opp.description
        });
      }
    });

    // Anomaly-based recommendations
    if (anomalies && anomalies.detected) {
      const highSeverityAnomalies = anomalies.anomalies.filter((a: any) => a.severity === 'high');
      if (highSeverityAnomalies.length > 0) {
        recommendations.push({
          priority: 'high',
          category: 'investigation',
          action: 'Investigate high-severity anomalies immediately',
          anomalies: highSeverityAnomalies.map((a: any) => a.type)
        });
      }
    }

    return recommendations.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority as keyof typeof priorityOrder] - priorityOrder[b.priority as keyof typeof priorityOrder];
    });
  }

  private generateBehaviorSummary(current: any, deviations: any, behaviorScore: any): string {
    const parts = [];

    // Overall health
    parts.push(`Service behavior score: ${behaviorScore.score}/100 (${behaviorScore.grade})`);

    // Traffic summary
    const requestRate = current.requests.total / (current.requests.timeline.length * 5 / 60);
    parts.push(`Current request rate: ${requestRate.toFixed(1)}/hour`);

    // Error summary
    parts.push(`Error rate: ${(current.requests.errorRate * 100).toFixed(2)}%`);

    // Deviation summary
    if (deviations && deviations.significantDeviations.length > 0) {
      parts.push(`${deviations.significantDeviations.length} significant deviations from baseline`);
    }

    return parts.join('. ');
  }

  // Helper methods
  private calculateErrorRate(buckets: any): number {
    if (!buckets) return 0;
    const errors = buckets.errors?.doc_count || 0;
    const success = buckets.success?.doc_count || 0;
    const total = errors + success;
    return total > 0 ? errors / total : 0;
  }

  private calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  private calculateStdDev(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = this.calculateMean(values);
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    const variance = this.calculateMean(squaredDiffs);
    return Math.sqrt(variance);
  }

  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private detectPeriodicity(values: number[]): any {
    if (values.length < 24) {
      return { isPeriodic: false, reason: 'Insufficient data' };
    }

    // Simple periodicity detection using autocorrelation
    const periods = [24, 12, 8, 6]; // Check for daily, half-day, 8-hour, 6-hour patterns
    let bestPeriod = 0;
    let bestCorrelation = 0;

    for (const period of periods) {
      if (values.length < period * 2) continue;

      let correlation = 0;
      let count = 0;

      for (let i = period; i < values.length; i++) {
        correlation += values[i] * values[i - period];
        count++;
      }

      correlation = correlation / count;

      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestPeriod = period;
      }
    }

    const threshold = 0.7;
    return {
      isPeriodic: bestCorrelation > threshold,
      period: bestPeriod,
      confidence: bestCorrelation
    };
  }

  private identifyPeakHours(hourlyData: any[]): any[] {
    if (hourlyData.length === 0) return [];

    const threshold = this.calculatePercentile(
      hourlyData.map(h => h.request_count?.value || 0),
      75
    );

    return hourlyData
      .filter(h => (h.request_count?.value || 0) > threshold)
      .map(h => ({
        hour: new Date(h.key).getHours(),
        volume: h.request_count?.value || 0
      }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5);
  }

  private classifyTrafficPattern(hourlyData: any[], periodicity: any): string {
    if (periodicity.isPeriodic) {
      if (periodicity.period === 24) return 'Daily periodic';
      if (periodicity.period === 12) return 'Bi-daily periodic';
      return `${periodicity.period}-hour periodic`;
    }

    // Check for other patterns
    const values = hourlyData.map(h => h.request_count?.value || 0);
    const cv = this.calculateStdDev(values) / this.calculateMean(values);

    if (cv < 0.2) return 'Steady';
    if (cv < 0.5) return 'Variable';
    return 'Highly variable';
  }

  private clusterErrors(errorHits: any[]): any[] {
    // Simple error clustering based on error type and message
    const clusters = new Map();

    errorHits.forEach(hit => {
      const error = hit._source;
      const key = `${error['error.type'] || 'unknown'}_${error['error.message']?.substring(0, 50) || 'no_message'}`;

      if (!clusters.has(key)) {
        clusters.set(key, {
          type: error['error.type'] || 'unknown',
          sampleMessage: error['error.message'] || 'No message',
          count: 0,
          samples: []
        });
      }

      const cluster = clusters.get(key);
      cluster.count++;
      if (cluster.samples.length < 3) {
        cluster.samples.push({
          timestamp: error['@timestamp'],
          traceId: error['trace.id']
        });
      }
    });

    return Array.from(clusters.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  private analyzeErrorTrends(errorTimeline: any[]): any {
    if (errorTimeline.length < 3) {
      return { increasing: false, decreasing: false, stable: true };
    }

    // Simple trend detection using linear regression
    const values = errorTimeline.map((b, i) => ({
      x: i,
      y: b.doc_count
    }));

    const n = values.length;
    const sumX = values.reduce((sum, v) => sum + v.x, 0);
    const sumY = values.reduce((sum, v) => sum + v.y, 0);
    const sumXY = values.reduce((sum, v) => sum + v.x * v.y, 0);
    const sumX2 = values.reduce((sum, v) => sum + v.x * v.x, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const avgY = sumY / n;

    // Determine trend based on slope relative to average
    const slopeRatio = Math.abs(slope) / avgY;

    return {
      increasing: slope > 0 && slopeRatio > 0.1,
      decreasing: slope < 0 && slopeRatio > 0.1,
      stable: slopeRatio <= 0.1,
      slope,
      slopeRatio
    };
  }

  private calculateReliability(errorCount: number, totalCount: number, avgLatency: number): number {
    const successRate = 1 - (errorCount / totalCount);
    const latencyPenalty = avgLatency > 1000 ? 0.9 : 1.0;
    return successRate * latencyPenalty;
  }

  private identifyCriticalDependencies(dependencies: any[]): any[] {
    return dependencies
      .filter(dep =>
        dep.callCount > 100 ||
        dep.errorRate > 5 ||
        dep.reliability < 0.95
      )
      .map(dep => ({
        service: dep.service,
        criticality: this.calculateCriticality(dep),
        reasons: this.getCriticalityReasons(dep)
      }))
      .sort((a, b) => b.criticality - a.criticality);
  }

  private calculateCriticality(dep: any): number {
    let score = 0;

    // Volume impact
    if (dep.callCount > 1000) score += 3;
    else if (dep.callCount > 100) score += 2;
    else if (dep.callCount > 10) score += 1;

    // Error impact
    if (dep.errorRate > 10) score += 3;
    else if (dep.errorRate > 5) score += 2;
    else if (dep.errorRate > 1) score += 1;

    // Latency impact
    if (dep.avgLatency > 2000) score += 2;
    else if (dep.avgLatency > 1000) score += 1;

    return score;
  }

  private getCriticalityReasons(dep: any): string[] {
    const reasons = [];

    if (dep.callCount > 1000) reasons.push('High call volume');
    if (dep.errorRate > 5) reasons.push('High error rate');
    if (dep.avgLatency > 1000) reasons.push('High latency');
    if (dep.reliability < 0.95) reasons.push('Low reliability');

    return reasons;
  }

  private assessDependencyHealth(dependencies: any[]): any {
    const healthyCount = dependencies.filter(d => d.reliability > 0.98).length;
    const warningCount = dependencies.filter(d => d.reliability > 0.95 && d.reliability <= 0.98).length;
    const unhealthyCount = dependencies.filter(d => d.reliability <= 0.95).length;

    const overallHealth = dependencies.length > 0
      ? dependencies.reduce((sum, d) => sum + d.reliability, 0) / dependencies.length
      : 1;

    return {
      overall: overallHealth,
      status: overallHealth > 0.98 ? 'healthy' : overallHealth > 0.95 ? 'warning' : 'unhealthy',
      breakdown: {
        healthy: healthyCount,
        warning: warningCount,
        unhealthy: unhealthyCount
      }
    };
  }

  private analyzeCommunicationPatterns(dependencies: any): any {
    return {
      downstreamCount: dependencies.downstream.length,
      upstreamCount: dependencies.upstream.length,
      fanOut: dependencies.downstream.length,
      fanIn: dependencies.upstream.length,
      pattern: this.identifyCommunicationPattern(dependencies)
    };
  }

  private identifyCommunicationPattern(dependencies: any): string {
    const fanOut = dependencies.downstream.length;
    const fanIn = dependencies.upstream.length;

    if (fanOut > 5 && fanIn <= 2) return 'Gateway/Aggregator';
    if (fanOut <= 2 && fanIn > 5) return 'Shared Service';
    if (fanOut > 5 && fanIn > 5) return 'Central Hub';
    if (fanOut === 1 && fanIn === 1) return 'Pipeline Component';
    return 'Standard Service';
  }

  private calculateResourceUtilization(stats: any): string {
    if (!stats) return 'unknown';

    const avg = stats.avg || 0;
    const max = stats.max || 0;

    if (max > 0.9) return 'critical';
    if (max > 0.8) return 'high';
    if (avg > 0.6) return 'moderate';
    if (avg > 0.3) return 'normal';
    return 'low';
  }

  private calculateResourceEfficiency(cpuStats: any, memoryStats: any): any {
    const cpuAvg = cpuStats?.avg || 0;
    const memAvg = memoryStats?.avg || 0;

    // Simple efficiency score based on resource usage balance
    const balance = 1 - Math.abs(cpuAvg - memAvg);
    const efficiency = (1 - (cpuAvg + memAvg) / 2) * balance;

    return {
      score: efficiency,
      interpretation: efficiency > 0.7 ? 'efficient' : efficiency > 0.4 ? 'moderate' : 'inefficient',
      cpuUtilization: (cpuAvg * 100).toFixed(1) + '%',
      memoryUtilization: (memAvg * 100).toFixed(1) + '%'
    };
  }

  private generateScalingRecommendations(cpuStats: any, memoryStats: any): any[] {
    const recommendations = [];

    if (cpuStats?.max > 0.8) {
      recommendations.push({
        type: 'vertical_scaling',
        resource: 'CPU',
        action: 'Increase CPU allocation',
        rationale: `Max CPU usage ${(cpuStats.max * 100).toFixed(1)}% exceeds threshold`
      });
    }

    if (memoryStats?.max > 0.85) {
      recommendations.push({
        type: 'vertical_scaling',
        resource: 'Memory',
        action: 'Increase memory allocation',
        rationale: `Max memory usage ${(memoryStats.max * 100).toFixed(1)}% exceeds threshold`
      });
    }

    if (cpuStats?.std_deviation > 0.2) {
      recommendations.push({
        type: 'horizontal_scaling',
        action: 'Implement auto-scaling',
        rationale: 'High CPU usage variability suggests need for elastic scaling'
      });
    }

    return recommendations;
  }

  private assessDeviationImpact(deviation: any): string {
    if (deviation.metric === 'errorRate' && deviation.direction === 'increase') {
      return 'High - Increased errors affect user experience';
    }
    if (deviation.metric === 'requestRate' && Math.abs(deviation.zScore) > 3) {
      return 'Medium - Significant traffic change may impact capacity';
    }
    return 'Low - Within acceptable variation';
  }

  private summarizeAnomalySeverity(anomalies: any[]): any {
    const severityCounts = {
      high: 0,
      medium: 0,
      low: 0
    };

    anomalies.forEach(a => {
      severityCounts[a.severity as keyof typeof severityCounts]++;
    });

    return severityCounts;
  }
}