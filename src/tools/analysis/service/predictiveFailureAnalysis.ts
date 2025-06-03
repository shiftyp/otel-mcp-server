import { z } from 'zod';
import { BaseTool, ToolCategory } from '../../base/tool.js';
import { BaseSearchAdapter } from '../../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../../config/index.js';
import { MCPToolSchema } from '../../../types.js';

// Define the Zod schema
const PredictiveFailureAnalysisArgsSchema = {
  service: z.string().optional().describe('Specific service to analyze for failure prediction'),
  from: z.string().describe('Start time for analysis (ISO 8601 format or relative like "now-1h")'),
  to: z.string().describe('End time for analysis (ISO 8601 format or relative like "now")'),
  predictionWindow: z.number().optional().describe('Hours to predict ahead (default: 24)'),
  sensitivity: z.enum(['low', 'medium', 'high']).optional().describe('Prediction sensitivity (default: medium)'),
  includeRootCause: z.boolean().optional().describe('Include root cause analysis (default: true)')
};

type PredictiveFailureAnalysisArgs = MCPToolSchema<typeof PredictiveFailureAnalysisArgsSchema>;

/**
 * Tool for predicting potential failures based on historical patterns and current trends
 */
export class PredictiveFailureAnalysisTool extends BaseTool<typeof PredictiveFailureAnalysisArgsSchema> {
  // Static schema property
  static readonly schema = PredictiveFailureAnalysisArgsSchema;
  
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'predictFailures',
      category: ToolCategory.ANALYSIS,
      description: 'Predict potential system failures using historical patterns and current trends',
      requiredCapabilities: []
    });
  }
  
  protected getSchema() {
    return PredictiveFailureAnalysisArgsSchema;
  }
  
  protected async executeImpl(args: PredictiveFailureAnalysisArgs): Promise<any> {
    const config = ConfigLoader.get();
    const predictionWindow = args.predictionWindow || 24;
    const sensitivity = args.sensitivity || 'medium';
    const includeRootCause = args.includeRootCause ?? true;
    const timeRange = { from: args.from, to: args.to };
    
    // Get historical failure patterns
    const historicalPatterns = await this.analyzeHistoricalFailures(
      timeRange,
      args.service
    );
    
    // Analyze current system state
    const currentState = await this.analyzeCurrentState(args.service);
    
    // Detect early warning signals
    const warningSignals = await this.detectEarlyWarningSignals(
      timeRange,
      args.service,
      sensitivity
    );
    
    // Analyze resource trends
    const resourceTrends = await this.analyzeResourceTrends(
      timeRange,
      args.service
    );
    
    // Perform predictive analysis
    const predictions = this.generateFailurePredictions(
      historicalPatterns,
      currentState,
      warningSignals,
      resourceTrends,
      predictionWindow,
      sensitivity
    );
    
    // Calculate failure probabilities
    const failureProbabilities = this.calculateFailureProbabilities(
      predictions,
      historicalPatterns,
      currentState
    );
    
    // Root cause analysis
    let rootCauseAnalysis = null;
    if (includeRootCause && predictions.length > 0) {
      rootCauseAnalysis = await this.performRootCauseAnalysis(
        predictions,
        historicalPatterns,
        warningSignals
      );
    }
    
    // Generate preventive actions
    const preventiveActions = this.generatePreventiveActions(
      predictions,
      failureProbabilities,
      rootCauseAnalysis
    );
    
    // Calculate risk timeline
    const riskTimeline = this.calculateRiskTimeline(
      predictions,
      failureProbabilities,
      predictionWindow
    );
    
    return this.formatJsonOutput({
      analysis: {
        timeRange: timeRange,
        service: args.service || 'all_services',
        predictionWindow: `${predictionWindow} hours`,
        sensitivity,
        historicalDataPoints: historicalPatterns.totalFailures
      },
      predictions: predictions.map(pred => ({
        type: pred.type,
        service: pred.service,
        probability: pred.probability,
        timeframe: pred.timeframe,
        severity: pred.severity,
        confidence: pred.confidence,
        indicators: pred.indicators,
        similarHistoricalEvents: pred.similarEvents
      })),
      failureProbabilities: {
        immediate: failureProbabilities.immediate,
        shortTerm: failureProbabilities.shortTerm,
        mediumTerm: failureProbabilities.mediumTerm,
        byService: failureProbabilities.byService,
        byType: failureProbabilities.byType
      },
      earlyWarningSignals: {
        detected: warningSignals.length,
        signals: warningSignals.map(signal => ({
          type: signal.type,
          severity: signal.severity,
          service: signal.service,
          indicator: signal.indicator,
          trend: signal.trend,
          anomalyScore: signal.anomalyScore
        }))
      },
      resourceTrends: {
        concerning: resourceTrends.concerning,
        projections: resourceTrends.projections,
        exhaustionRisks: resourceTrends.exhaustionRisks
      },
      rootCauseAnalysis: rootCauseAnalysis ? {
        primaryCauses: rootCauseAnalysis.primaryCauses,
        contributingFactors: rootCauseAnalysis.contributingFactors,
        correlations: rootCauseAnalysis.correlations
      } : null,
      riskTimeline,
      preventiveActions: {
        immediate: preventiveActions.immediate,
        scheduled: preventiveActions.scheduled,
        monitoring: preventiveActions.monitoring
      },
      insights: this.generatePredictiveInsights(
        predictions,
        warningSignals,
        resourceTrends
      ),
      summary: this.generatePredictiveSummary(
        predictions,
        failureProbabilities,
        preventiveActions
      )
    });
  }
  
  private async analyzeHistoricalFailures(
    timeRange: any,
    service?: string
  ): Promise<any> {
    const config = ConfigLoader.get();
    
    const query: any = {
      bool: {
        must: [
          { range: { [config.telemetry.fields.timestamp]: timeRange } },
          {
            bool: {
              should: [
                { term: { [config.telemetry.fields.status]: 'ERROR' } },
                { exists: { field: 'error.type' } },
                { range: { 'http.status_code': { gte: 500 } } }
              ]
            }
          }
        ]
      }
    };
    
    if (service) {
      query.bool.must.push({ term: { [config.telemetry.fields.service]: service } });
    }
    
    const result = await this.adapter.query(
      config.telemetry.indices.traces,
      query,
      {
        size: 0,
        aggregations: {
          failure_timeline: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '1h'
            },
            aggs: {
              services: {
                terms: { field: config.telemetry.fields.service, size: 20 }
              },
              error_types: {
                terms: { field: 'error.type.keyword', size: 10 }
              },
              failure_rate: {
                bucket_script: {
                  buckets_path: {
                    errors: '_count'
                  },
                  script: 'params.errors'
                }
              }
            }
          },
          failure_patterns: {
            significant_terms: {
              field: 'error.message.keyword',
              size: 20
            }
          },
          periodic_failures: {
            auto_date_histogram: {
              field: config.telemetry.fields.timestamp,
              buckets: 168 // One week of hours
            },
            aggs: {
              hour_of_day: {
                terms: {
                  script: {
                    source: "doc['" + config.telemetry.fields.timestamp + "'].value.hourOfDay"
                  },
                  size: 24
                }
              },
              day_of_week: {
                terms: {
                  script: {
                    source: "doc['" + config.telemetry.fields.timestamp + "'].value.dayOfWeek"
                  },
                  size: 7
                }
              }
            }
          }
        }
      }
    );
    
    // Analyze patterns
    const patterns = this.extractFailurePatterns(result.aggregations);
    
    return {
      totalFailures: result.hits.total.value,
      timeline: result.aggregations?.failure_timeline?.buckets || [],
      patterns,
      periodicPatterns: this.analyzePeriodicPatterns(
        result.aggregations?.periodic_failures?.buckets || []
      )
    };
  }
  
  private extractFailurePatterns(aggregations: any): any[] {
    const patterns: any[] = [];
    const timeline = aggregations?.failure_timeline?.buckets || [];
    
    // Detect increasing failure trends
    const failureRates = timeline.map((b: any) => b.doc_count);
    const trend = this.calculateTrend(failureRates);
    
    if (trend > 0.2) {
      patterns.push({
        type: 'increasing_failures',
        severity: trend > 0.5 ? 'high' : 'medium',
        trendStrength: trend,
        description: 'Failure rate showing upward trend'
      });
    }
    
    // Detect burst patterns
    const burstIndices = this.detectBursts(failureRates);
    if (burstIndices.length > 0) {
      patterns.push({
        type: 'failure_bursts',
        severity: 'high',
        occurrences: burstIndices.length,
        description: 'Periodic failure bursts detected'
      });
    }
    
    // Detect service-specific patterns
    const serviceFailures = new Map<string, number>();
    timeline.forEach((bucket: any) => {
      const services = bucket.services?.buckets || [];
      services.forEach((service: any) => {
        serviceFailures.set(
          service.key,
          (serviceFailures.get(service.key) || 0) + service.doc_count
        );
      });
    });
    
    const problematicServices = Array.from(serviceFailures.entries())
      .filter(([_, count]) => count > timeline.length * 10) // More than 10 failures per hour avg
      .map(([service, count]) => ({ service, failureCount: count }));
    
    if (problematicServices.length > 0) {
      patterns.push({
        type: 'service_specific',
        severity: 'medium',
        services: problematicServices,
        description: 'Specific services showing high failure rates'
      });
    }
    
    return patterns;
  }
  
  private analyzePeriodicPatterns(buckets: any[]): any {
    const hourlyFailures = new Map<number, number>();
    const dailyFailures = new Map<number, number>();
    
    buckets.forEach(bucket => {
      const hourBuckets = bucket.hour_of_day?.buckets || [];
      const dayBuckets = bucket.day_of_week?.buckets || [];
      
      hourBuckets.forEach((h: any) => {
        hourlyFailures.set(h.key, (hourlyFailures.get(h.key) || 0) + h.doc_count);
      });
      
      dayBuckets.forEach((d: any) => {
        dailyFailures.set(d.key, (dailyFailures.get(d.key) || 0) + d.doc_count);
      });
    });
    
    // Find peak failure times
    const peakHours = Array.from(hourlyFailures.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([hour, count]) => ({ hour, count }));
    
    const peakDays = Array.from(dailyFailures.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 2)
      .map(([day, count]) => ({ day, count }));
    
    return { peakHours, peakDays };
  }
  
  private async analyzeCurrentState(service?: string): Promise<any> {
    const config = ConfigLoader.get();
    const recentWindow = { from: 'now-1h', to: 'now' };
    
    const query: any = {
      bool: {
        must: [
          { range: { [config.telemetry.fields.timestamp]: recentWindow } }
        ]
      }
    };
    
    if (service) {
      query.bool.must.push({ term: { [config.telemetry.fields.service]: service } });
    }
    
    const result = await this.adapter.query(
      config.telemetry.indices.traces,
      query,
      {
        size: 0,
        aggregations: {
          services: {
            terms: { field: config.telemetry.fields.service, size: 50 },
            aggs: {
              error_rate: {
                filters: {
                  filters: {
                    errors: { term: { [config.telemetry.fields.status]: 'ERROR' } },
                    total: { match_all: {} }
                  }
                }
              },
              latency_stats: {
                percentiles: { field: 'duration', percents: [50, 95, 99] }
              },
              recent_trend: {
                date_histogram: {
                  field: config.telemetry.fields.timestamp,
                  fixed_interval: '5m'
                }
              }
            }
          },
          system_load: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '5m'
            },
            aggs: {
              request_rate: { value_count: { field: config.telemetry.fields.traceId } }
            }
          }
        }
      }
    );
    
    // Calculate system health metrics
    const services = result.aggregations?.services?.buckets || [];
    const systemLoad = result.aggregations?.system_load?.buckets || [];
    
    const currentMetrics = services.map((svc: any) => {
      const errorCount = svc.error_rate?.buckets?.errors?.doc_count || 0;
      const totalCount = svc.error_rate?.buckets?.total?.doc_count || 1;
      
      return {
        service: svc.key,
        errorRate: (errorCount / totalCount) * 100,
        latencyP95: svc.latency_stats?.values?.['95.0'] || 0,
        requestCount: totalCount,
        trend: this.calculateServiceTrend(svc.recent_trend?.buckets || [])
      };
    });
    
    return {
      services: currentMetrics,
      systemLoad: {
        current: systemLoad.length > 0 ? systemLoad[systemLoad.length - 1].request_rate?.value || 0 : 0,
        trend: this.calculateLoadTrend(systemLoad)
      },
      overallHealth: this.calculateOverallHealth(currentMetrics)
    };
  }
  
  private calculateServiceTrend(buckets: any[]): string {
    if (buckets.length < 3) return 'stable';
    
    const counts = buckets.map(b => b.doc_count);
    const trend = this.calculateTrend(counts);
    
    if (trend > 0.3) return 'increasing';
    if (trend < -0.3) return 'decreasing';
    return 'stable';
  }
  
  private calculateLoadTrend(buckets: any[]): string {
    const rates = buckets.map(b => b.request_rate?.value || 0);
    const trend = this.calculateTrend(rates);
    
    if (trend > 0.5) return 'spiking';
    if (trend > 0.2) return 'increasing';
    if (trend < -0.2) return 'decreasing';
    return 'stable';
  }
  
  private calculateOverallHealth(services: any[]): number {
    if (services.length === 0) return 100;
    
    let healthScore = 100;
    
    // Penalize for high error rates
    const avgErrorRate = services.reduce((sum, s) => sum + s.errorRate, 0) / services.length;
    if (avgErrorRate > 1) healthScore -= Math.min(30, avgErrorRate * 5);
    
    // Penalize for high latencies
    const highLatencyServices = services.filter(s => s.latencyP95 > 2000).length;
    healthScore -= Math.min(20, highLatencyServices * 5);
    
    // Penalize for concerning trends
    const concerningTrends = services.filter(s => s.trend === 'increasing' && s.errorRate > 0.5).length;
    healthScore -= Math.min(20, concerningTrends * 10);
    
    return Math.max(0, healthScore);
  }
  
  private async detectEarlyWarningSignals(
    timeRange: any,
    service: string | undefined,
    sensitivity: string
  ): Promise<any[]> {
    const config = ConfigLoader.get();
    const signals: any[] = [];
    
    // Define sensitivity thresholds
    const thresholds = {
      low: { errorRate: 5, latencyIncrease: 100, anomalyScore: 0.8 },
      medium: { errorRate: 2, latencyIncrease: 50, anomalyScore: 0.6 },
      high: { errorRate: 1, latencyIncrease: 25, anomalyScore: 0.4 }
    }[sensitivity] || { errorRate: 2, latencyIncrease: 50, anomalyScore: 0.6 };
    
    // Query for anomalous patterns
    const anomalyQuery: any = {
      bool: {
        must: [
          { range: { [config.telemetry.fields.timestamp]: { from: 'now-6h', to: 'now' } } }
        ]
      }
    };
    
    if (service) {
      anomalyQuery.bool.must.push({ term: { [config.telemetry.fields.service]: service } });
    }
    
    const anomalyResult = await this.adapter.query(
      config.telemetry.indices.traces,
      anomalyQuery,
      {
        size: 0,
        aggregations: {
          services: {
            terms: { field: config.telemetry.fields.service, size: 50 },
            aggs: {
              time_buckets: {
                date_histogram: {
                  field: config.telemetry.fields.timestamp,
                  fixed_interval: '10m'
                },
                aggs: {
                  error_rate: {
                    filters: {
                      filters: {
                        errors: { term: { [config.telemetry.fields.status]: 'ERROR' } }
                      }
                    }
                  },
                  latency_stats: {
                    stats: { field: 'duration' }
                  }
                }
              }
            }
          }
        }
      }
    );
    
    // Analyze each service for warning signals
    const serviceBuckets = anomalyResult.aggregations?.services?.buckets || [];
    
    serviceBuckets.forEach((svcBucket: any) => {
      const serviceName = svcBucket.key;
      const timeBuckets = svcBucket.time_buckets?.buckets || [];
      
      // Detect error rate anomalies
      const errorRates = timeBuckets.map((b: any) => {
        const errors = b.error_rate?.buckets?.errors?.doc_count || 0;
        const total = b.doc_count;
        return total > 0 ? (errors / total) * 100 : 0;
      });
      
      const errorAnomaly = this.detectAnomaly(errorRates);
      if (errorAnomaly.score > thresholds.anomalyScore && errorRates[errorRates.length - 1] > thresholds.errorRate) {
        signals.push({
          type: 'error_rate_anomaly',
          severity: errorAnomaly.score > 0.8 ? 'high' : 'medium',
          service: serviceName,
          indicator: `Error rate: ${errorRates[errorRates.length - 1].toFixed(2)}%`,
          trend: 'increasing',
          anomalyScore: errorAnomaly.score
        });
      }
      
      // Detect latency anomalies
      const latencies = timeBuckets.map((b: any) => b.latency_stats?.avg || 0);
      const latencyAnomaly = this.detectAnomaly(latencies);
      
      if (latencyAnomaly.score > thresholds.anomalyScore) {
        const latencyIncrease = latencies[latencies.length - 1] - latencyAnomaly.baseline;
        if (latencyIncrease > thresholds.latencyIncrease) {
          signals.push({
            type: 'latency_anomaly',
            severity: latencyIncrease > thresholds.latencyIncrease * 2 ? 'high' : 'medium',
            service: serviceName,
            indicator: `Latency increased by ${latencyIncrease.toFixed(0)}ms`,
            trend: 'increasing',
            anomalyScore: latencyAnomaly.score
          });
        }
      }
      
      // Detect request pattern anomalies
      const requestCounts = timeBuckets.map((b: any) => b.doc_count);
      const requestAnomaly = this.detectAnomaly(requestCounts);
      
      if (requestAnomaly.score > thresholds.anomalyScore) {
        const currentRate = requestCounts[requestCounts.length - 1];
        const change = ((currentRate - requestAnomaly.baseline) / requestAnomaly.baseline) * 100;
        
        if (Math.abs(change) > 50) {
          signals.push({
            type: 'traffic_anomaly',
            severity: Math.abs(change) > 100 ? 'high' : 'medium',
            service: serviceName,
            indicator: `Traffic ${change > 0 ? 'spike' : 'drop'}: ${Math.abs(change).toFixed(0)}%`,
            trend: change > 0 ? 'spiking' : 'dropping',
            anomalyScore: requestAnomaly.score
          });
        }
      }
    });
    
    return signals;
  }
  
  private detectAnomaly(values: number[]): any {
    if (values.length < 5) return { score: 0, baseline: 0 };
    
    // Simple anomaly detection using z-score
    const baseline = values.slice(0, -2); // Exclude last 2 points
    const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
    const stdDev = Math.sqrt(
      baseline.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / baseline.length
    );
    
    const current = values[values.length - 1];
    const zScore = stdDev > 0 ? Math.abs((current - mean) / stdDev) : 0;
    
    // Convert z-score to anomaly score (0-1)
    const anomalyScore = Math.min(1, zScore / 3);
    
    return {
      score: anomalyScore,
      baseline: mean,
      stdDev,
      zScore
    };
  }
  
  private async analyzeResourceTrends(
    timeRange: any,
    service?: string
  ): Promise<any> {
    const config = ConfigLoader.get();
    
    // Query for resource metrics
    const resourceQuery: any = {
      bool: {
        must: [
          { range: { [config.telemetry.fields.timestamp]: timeRange } }
        ],
        should: [
          { exists: { field: 'system.cpu.usage' } },
          { exists: { field: 'system.memory.usage' } },
          { exists: { field: 'system.disk.usage' } }
        ],
        minimum_should_match: 1
      }
    };
    
    if (service) {
      resourceQuery.bool.must.push({ term: { [config.telemetry.fields.service]: service } });
    }
    
    const resourceResult = await this.adapter.query(
      config.telemetry.indices.metrics,
      resourceQuery,
      {
        size: 0,
        aggregations: {
          resource_timeline: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '30m'
            },
            aggs: {
              cpu_usage: { avg: { field: 'system.cpu.usage' } },
              memory_usage: { avg: { field: 'system.memory.usage' } },
              disk_usage: { avg: { field: 'system.disk.usage' } }
            }
          }
        }
      }
    );
    
    const timeline = resourceResult.aggregations?.resource_timeline?.buckets || [];
    
    // Analyze trends
    const cpuTrend = this.analyzeResourceTrend(timeline, 'cpu_usage');
    const memoryTrend = this.analyzeResourceTrend(timeline, 'memory_usage');
    const diskTrend = this.analyzeResourceTrend(timeline, 'disk_usage');
    
    // Identify concerning trends
    const concerning: any[] = [];
    if (cpuTrend.projected > 80) {
      concerning.push({
        resource: 'CPU',
        current: cpuTrend.current,
        projected: cpuTrend.projected,
        timeToThreshold: cpuTrend.timeToThreshold
      });
    }
    
    if (memoryTrend.projected > 85) {
      concerning.push({
        resource: 'Memory',
        current: memoryTrend.current,
        projected: memoryTrend.projected,
        timeToThreshold: memoryTrend.timeToThreshold
      });
    }
    
    if (diskTrend.projected > 90) {
      concerning.push({
        resource: 'Disk',
        current: diskTrend.current,
        projected: diskTrend.projected,
        timeToThreshold: diskTrend.timeToThreshold
      });
    }
    
    return {
      concerning,
      projections: {
        cpu: cpuTrend,
        memory: memoryTrend,
        disk: diskTrend
      },
      exhaustionRisks: this.calculateExhaustionRisks(cpuTrend, memoryTrend, diskTrend)
    };
  }
  
  private analyzeResourceTrend(timeline: any[], field: string): any {
    const values = timeline.map(b => b[field]?.value || 0).filter(v => v > 0);
    
    if (values.length < 3) {
      return { current: 0, projected: 0, trend: 'stable', timeToThreshold: null };
    }
    
    const current = values[values.length - 1];
    const trend = this.calculateTrend(values);
    
    // Simple linear projection
    const avgIncrease = values.length > 1 ? 
      (values[values.length - 1] - values[0]) / (values.length - 1) : 0;
    
    const hoursAhead = 24;
    const projected = current + (avgIncrease * hoursAhead * 2); // 30min buckets
    
    // Calculate time to threshold
    let timeToThreshold = null;
    const threshold = field.includes('cpu') ? 80 : field.includes('memory') ? 85 : 90;
    
    if (avgIncrease > 0 && current < threshold) {
      const hoursToThreshold = (threshold - current) / (avgIncrease * 2);
      timeToThreshold = hoursToThreshold;
    }
    
    return {
      current,
      projected: Math.min(100, projected),
      trend: trend > 0.2 ? 'increasing' : trend < -0.2 ? 'decreasing' : 'stable',
      timeToThreshold
    };
  }
  
  private calculateExhaustionRisks(cpu: any, memory: any, disk: any): any[] {
    const risks: any[] = [];
    
    if (cpu.timeToThreshold !== null && cpu.timeToThreshold < 24) {
      risks.push({
        resource: 'CPU',
        hoursUntilExhaustion: cpu.timeToThreshold,
        severity: cpu.timeToThreshold < 6 ? 'critical' : 'high'
      });
    }
    
    if (memory.timeToThreshold !== null && memory.timeToThreshold < 24) {
      risks.push({
        resource: 'Memory',
        hoursUntilExhaustion: memory.timeToThreshold,
        severity: memory.timeToThreshold < 6 ? 'critical' : 'high'
      });
    }
    
    if (disk.timeToThreshold !== null && disk.timeToThreshold < 48) {
      risks.push({
        resource: 'Disk',
        hoursUntilExhaustion: disk.timeToThreshold,
        severity: disk.timeToThreshold < 12 ? 'critical' : 'high'
      });
    }
    
    return risks;
  }
  
  private generateFailurePredictions(
    historicalPatterns: any,
    currentState: any,
    warningSignals: any[],
    resourceTrends: any,
    predictionWindow: number,
    sensitivity: string
  ): any[] {
    const predictions: any[] = [];
    
    // Service-based predictions
    currentState.services.forEach((service: any) => {
      const serviceSignals = warningSignals.filter(s => s.service === service.service);
      const historicalFailures = this.getServiceHistoricalFailures(
        service.service,
        historicalPatterns
      );
      
      // Calculate failure probability
      const probability = this.calculateServiceFailureProbability(
        service,
        serviceSignals,
        historicalFailures,
        sensitivity
      );
      
      if (probability > 0.3) {
        predictions.push({
          type: 'service_failure',
          service: service.service,
          probability,
          timeframe: this.estimateTimeframe(probability, serviceSignals),
          severity: probability > 0.7 ? 'critical' : probability > 0.5 ? 'high' : 'medium',
          confidence: this.calculateConfidence(serviceSignals, historicalFailures),
          indicators: serviceSignals.map(s => s.indicator),
          similarEvents: historicalFailures.slice(0, 3)
        });
      }
    });
    
    // Resource exhaustion predictions
    resourceTrends.exhaustionRisks.forEach((risk: any) => {
      if (risk.hoursUntilExhaustion < predictionWindow) {
        predictions.push({
          type: 'resource_exhaustion',
          service: 'system',
          resource: risk.resource,
          probability: risk.hoursUntilExhaustion < 6 ? 0.9 : 0.7,
          timeframe: `${risk.hoursUntilExhaustion.toFixed(1)} hours`,
          severity: risk.severity,
          confidence: 'high',
          indicators: [`${risk.resource} usage trending toward exhaustion`],
          similarEvents: []
        });
      }
    });
    
    // Pattern-based predictions
    historicalPatterns.patterns.forEach((pattern: any) => {
      if (pattern.type === 'increasing_failures' && pattern.trendStrength > 0.5) {
        predictions.push({
          type: 'cascading_failure',
          service: 'multiple',
          probability: 0.6,
          timeframe: '6-12 hours',
          severity: 'high',
          confidence: 'medium',
          indicators: ['Increasing failure trend detected'],
          similarEvents: []
        });
      }
    });
    
    // Periodic predictions
    const currentHour = new Date().getHours();
    const peakHours = historicalPatterns.periodicPatterns.peakHours;
    
    peakHours.forEach((peak: any) => {
      const hoursUntilPeak = (peak.hour - currentHour + 24) % 24;
      if (hoursUntilPeak < predictionWindow && hoursUntilPeak > 0) {
        predictions.push({
          type: 'periodic_failure',
          service: 'system',
          probability: 0.5,
          timeframe: `${hoursUntilPeak} hours (${peak.hour}:00)`,
          severity: 'medium',
          confidence: 'medium',
          indicators: [`Historical peak failure time at ${peak.hour}:00`],
          similarEvents: []
        });
      }
    });
    
    return predictions;
  }
  
  private getServiceHistoricalFailures(service: string, historicalPatterns: any): any[] {
    const failures: any[] = [];
    
    historicalPatterns.timeline.forEach((bucket: any) => {
      const serviceBucket = bucket.services?.buckets?.find((s: any) => s.key === service);
      if (serviceBucket && serviceBucket.doc_count > 0) {
        failures.push({
          time: bucket.key_as_string,
          count: serviceBucket.doc_count,
          errorTypes: bucket.error_types?.buckets || []
        });
      }
    });
    
    return failures;
  }
  
  private calculateServiceFailureProbability(
    service: any,
    signals: any[],
    historicalFailures: any[],
    sensitivity: string
  ): number {
    let probability = 0;
    
    // Base probability from current error rate
    if (service.errorRate > 5) probability += 0.3;
    else if (service.errorRate > 2) probability += 0.2;
    else if (service.errorRate > 1) probability += 0.1;
    
    // Adjust for warning signals
    signals.forEach(signal => {
      if (signal.severity === 'high') probability += 0.2;
      else if (signal.severity === 'medium') probability += 0.1;
    });
    
    // Adjust for trend
    if (service.trend === 'increasing') probability += 0.15;
    
    // Adjust for historical patterns
    const recentFailures = historicalFailures.slice(-6); // Last 6 hours
    const avgFailures = recentFailures.reduce((sum, f) => sum + f.count, 0) / (recentFailures.length || 1);
    if (avgFailures > 10) probability += 0.2;
    else if (avgFailures > 5) probability += 0.1;
    
    // Sensitivity adjustment
    const sensitivityMultiplier = {
      low: 0.7,
      medium: 1.0,
      high: 1.3
    }[sensitivity] || 1.0;
    
    probability *= sensitivityMultiplier;
    
    return Math.min(1, probability);
  }
  
  private estimateTimeframe(probability: number, signals: any[]): string {
    // Higher probability = sooner failure
    if (probability > 0.8) return '0-2 hours';
    if (probability > 0.6) return '2-6 hours';
    if (probability > 0.4) return '6-12 hours';
    return '12-24 hours';
  }
  
  private calculateConfidence(signals: any[], historicalData: any[]): string {
    const signalCount = signals.length;
    const historicalCount = historicalData.length;
    
    if (signalCount > 3 && historicalCount > 20) return 'high';
    if (signalCount > 1 && historicalCount > 10) return 'medium';
    return 'low';
  }
  
  private calculateFailureProbabilities(
    predictions: any[],
    historicalPatterns: any,
    currentState: any
  ): any {
    const now = Date.now();
    const immediate = predictions.filter(p => p.timeframe.includes('0-2')).length;
    const shortTerm = predictions.filter(p => p.timeframe.includes('2-6') || p.timeframe.includes('6-12')).length;
    const mediumTerm = predictions.filter(p => p.timeframe.includes('12-24')).length;
    
    // Calculate probabilities by service
    const byService = new Map<string, number>();
    predictions.forEach(pred => {
      if (pred.service !== 'system' && pred.service !== 'multiple') {
        byService.set(pred.service, Math.max(byService.get(pred.service) || 0, pred.probability));
      }
    });
    
    // Calculate probabilities by type
    const byType = new Map<string, number>();
    predictions.forEach(pred => {
      const current = byType.get(pred.type) || 0;
      byType.set(pred.type, Math.max(current, pred.probability));
    });
    
    return {
      immediate: immediate > 0 ? Math.max(...predictions.filter(p => p.timeframe.includes('0-2')).map(p => p.probability)) : 0,
      shortTerm: shortTerm > 0 ? Math.max(...predictions.filter(p => p.timeframe.includes('2-6') || p.timeframe.includes('6-12')).map(p => p.probability)) : 0,
      mediumTerm: mediumTerm > 0 ? Math.max(...predictions.filter(p => p.timeframe.includes('12-24')).map(p => p.probability)) : 0,
      byService: Array.from(byService.entries()).map(([service, prob]) => ({ service, probability: prob })),
      byType: Array.from(byType.entries()).map(([type, prob]) => ({ type, probability: prob }))
    };
  }
  
  private async performRootCauseAnalysis(
    predictions: any[],
    historicalPatterns: any,
    warningSignals: any[]
  ): Promise<any> {
    const primaryCauses: any[] = [];
    const contributingFactors: any[] = [];
    const correlations: any[] = [];
    
    // Analyze each prediction for root causes
    predictions.forEach(pred => {
      if (pred.type === 'service_failure') {
        // Service-specific root causes
        const serviceSignals = warningSignals.filter(s => s.service === pred.service);
        
        if (serviceSignals.some(s => s.type === 'error_rate_anomaly')) {
          primaryCauses.push({
            service: pred.service,
            cause: 'Error rate anomaly',
            evidence: serviceSignals.filter(s => s.type === 'error_rate_anomaly').map(s => s.indicator)
          });
        }
        
        if (serviceSignals.some(s => s.type === 'latency_anomaly')) {
          contributingFactors.push({
            service: pred.service,
            factor: 'Performance degradation',
            evidence: serviceSignals.filter(s => s.type === 'latency_anomaly').map(s => s.indicator)
          });
        }
      } else if (pred.type === 'resource_exhaustion') {
        primaryCauses.push({
          service: 'system',
          cause: `${pred.resource} exhaustion`,
          evidence: [`${pred.resource} usage trending toward 100%`]
        });
      }
    });
    
    // Find correlations
    if (warningSignals.length > 2) {
      const affectedServices = [...new Set(warningSignals.map(s => s.service))];
      if (affectedServices.length > 2) {
        correlations.push({
          type: 'multi_service_impact',
          services: affectedServices,
          correlation: 'Multiple services showing warning signals simultaneously'
        });
      }
    }
    
    return {
      primaryCauses,
      contributingFactors,
      correlations
    };
  }
  
  private generatePreventiveActions(
    predictions: any[],
    failureProbabilities: any,
    rootCauseAnalysis: any
  ): any {
    const immediate: any[] = [];
    const scheduled: any[] = [];
    const monitoring: any[] = [];
    
    // Immediate actions for high probability failures
    predictions.filter(p => p.probability > 0.7).forEach(pred => {
      if (pred.type === 'service_failure') {
        immediate.push({
          action: `Scale ${pred.service} service`,
          priority: 'critical',
          reason: `${(pred.probability * 100).toFixed(0)}% failure probability`,
          implementation: [
            'Increase instance count by 50%',
            'Enable auto-scaling if not already active',
            'Verify load balancer health'
          ]
        });
      } else if (pred.type === 'resource_exhaustion') {
        immediate.push({
          action: `Free ${pred.resource} resources`,
          priority: 'critical',
          reason: `${pred.resource} exhaustion in ${pred.timeframe}`,
          implementation: [
            pred.resource === 'Disk' ? 'Clean up logs and temporary files' : 
            pred.resource === 'Memory' ? 'Restart memory-intensive services' :
            'Optimize CPU-intensive processes'
          ]
        });
      }
    });
    
    // Scheduled actions for medium probability
    predictions.filter(p => p.probability > 0.4 && p.probability <= 0.7).forEach(pred => {
      scheduled.push({
        action: `Prepare ${pred.service} for potential failure`,
        timing: pred.timeframe,
        priority: 'high',
        preparation: [
          'Review and update runbooks',
          'Ensure backup services are ready',
          'Alert on-call team'
        ]
      });
    });
    
    // Enhanced monitoring for all predictions
    predictions.forEach(pred => {
      monitoring.push({
        target: pred.service,
        metrics: pred.type === 'service_failure' ? 
          ['error_rate', 'latency', 'throughput'] :
          ['cpu_usage', 'memory_usage', 'disk_usage'],
        threshold: pred.probability > 0.6 ? '1 minute' : '5 minutes',
        alerting: pred.probability > 0.6 ? 'page' : 'email'
      });
    });
    
    return { immediate, scheduled, monitoring };
  }
  
  private calculateRiskTimeline(
    predictions: any[],
    failureProbabilities: any,
    predictionWindow: number
  ): any[] {
    const timeline: any[] = [];
    const hourBuckets = new Map<number, any[]>();
    
    // Group predictions by hour
    predictions.forEach(pred => {
      let hour = 0;
      if (pred.timeframe.includes('0-2')) hour = 1;
      else if (pred.timeframe.includes('2-6')) hour = 4;
      else if (pred.timeframe.includes('6-12')) hour = 9;
      else if (pred.timeframe.includes('12-24')) hour = 18;
      else if (pred.timeframe.includes('hours')) {
        const match = pred.timeframe.match(/(\d+)/);
        if (match) hour = parseInt(match[1]);
      }
      
      if (!hourBuckets.has(hour)) {
        hourBuckets.set(hour, []);
      }
      hourBuckets.get(hour)?.push(pred);
    });
    
    // Build timeline
    for (let h = 0; h < predictionWindow; h += 6) {
      const risks = [];
      for (let i = h; i < h + 6; i++) {
        if (hourBuckets.has(i)) {
          risks.push(...(hourBuckets.get(i) || []));
        }
      }
      
      const maxRisk = risks.length > 0 ? 
        Math.max(...risks.map(r => r.probability)) : 0;
      
      timeline.push({
        period: `${h}-${h + 6} hours`,
        riskLevel: maxRisk > 0.7 ? 'critical' : maxRisk > 0.5 ? 'high' : maxRisk > 0.3 ? 'medium' : 'low',
        probability: maxRisk,
        predictions: risks.length,
        topRisks: risks.sort((a, b) => b.probability - a.probability).slice(0, 3)
      });
    }
    
    return timeline;
  }
  
  private generatePredictiveInsights(
    predictions: any[],
    warningSignals: any[],
    resourceTrends: any
  ): any[] {
    const insights: any[] = [];
    
    // Multiple failure prediction insight
    if (predictions.length > 3) {
      insights.push({
        type: 'multiple_risks',
        severity: 'high',
        description: `${predictions.length} potential failures predicted`,
        recommendation: 'Implement comprehensive preventive measures'
      });
    }
    
    // Cascading failure risk
    const affectedServices = [...new Set(predictions.map(p => p.service))];
    if (affectedServices.length > 3) {
      insights.push({
        type: 'cascade_risk',
        severity: 'high',
        description: 'Multiple services at risk of failure',
        services: affectedServices,
        recommendation: 'Review service dependencies and implement circuit breakers'
      });
    }
    
    // Resource constraint insight
    if (resourceTrends.exhaustionRisks.length > 0) {
      insights.push({
        type: 'resource_constraints',
        severity: 'critical',
        description: 'System resources approaching exhaustion',
        resources: resourceTrends.exhaustionRisks.map((r: any) => r.resource),
        recommendation: 'Immediate resource optimization required'
      });
    }
    
    // Pattern recognition insight
    const highConfidencePredictions = predictions.filter(p => p.confidence === 'high');
    if (highConfidencePredictions.length > 0) {
      insights.push({
        type: 'pattern_match',
        severity: 'medium',
        description: 'Historical failure patterns detected',
        count: highConfidencePredictions.length,
        recommendation: 'Review similar historical incidents for prevention strategies'
      });
    }
    
    return insights;
  }
  
  private generatePredictiveSummary(
    predictions: any[],
    failureProbabilities: any,
    preventiveActions: any
  ): string {
    const parts: string[] = [];
    
    if (predictions.length === 0) {
      parts.push('No significant failure risks detected.');
    } else {
      parts.push(`${predictions.length} potential failures predicted.`);
      
      const criticalCount = predictions.filter(p => p.severity === 'critical').length;
      if (criticalCount > 0) {
        parts.push(`${criticalCount} critical risks requiring immediate action.`);
      }
      
      if (failureProbabilities.immediate > 0.5) {
        parts.push('High probability of failure within 2 hours.');
      }
      
      if (preventiveActions.immediate.length > 0) {
        parts.push(`${preventiveActions.immediate.length} immediate actions required.`);
      }
    }
    
    return parts.join(' ');
  }
  
  // Helper methods
  private calculateTrend(values: number[]): number {
    if (values.length < 2) return 0;
    
    // Simple linear regression slope
    const n = values.length;
    const sumX = values.reduce((sum, _, i) => sum + i, 0);
    const sumY = values.reduce((sum, val) => sum + val, 0);
    const sumXY = values.reduce((sum, val, i) => sum + i * val, 0);
    const sumX2 = values.reduce((sum, _, i) => sum + i * i, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const avgY = sumY / n;
    
    // Normalize slope by average value
    return avgY > 0 ? slope / avgY : 0;
  }
  
  private detectBursts(values: number[]): number[] {
    const indices: number[] = [];
    const threshold = this.calculateAverage(values) + 2 * this.calculateStdDev(values);
    
    values.forEach((val, i) => {
      if (val > threshold) {
        indices.push(i);
      }
    });
    
    return indices;
  }
  
  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }
  
  private calculateStdDev(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = this.calculateAverage(values);
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    const variance = this.calculateAverage(squaredDiffs);
    return Math.sqrt(variance);
  }
}